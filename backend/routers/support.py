"""Seller support tickets / help-desk.

Sellers can raise tickets against the platform; admins reply through the
same thread. Mirrors a lightweight Zendesk / Freshdesk experience.

Routes:
  Seller-facing
    POST   /api/support/tickets                  create a ticket
    GET    /api/support/tickets                  list my tickets
    GET    /api/support/tickets/{id}             get a ticket + thread
    POST   /api/support/tickets/{id}/reply       add a reply
    POST   /api/support/tickets/{id}/rate        CSAT after resolved
    POST   /api/support/tickets/{id}/close       seller closes own ticket

  Admin-facing (x-admin-secret OR Bearer admin JWT)
    GET    /api/admin/tickets                    list / filter
    GET    /api/admin/tickets/{id}               full thread incl. notes
    POST   /api/admin/tickets/{id}/reply         visible reply
    POST   /api/admin/tickets/{id}/note          internal note
    PATCH  /api/admin/tickets/{id}/status        status transitions
    PATCH  /api/admin/tickets/{id}/assign        assign to an admin
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from config import ADMIN_SECRET
from db import db
from deps import get_current_user
from services.admin_auth import get_current_admin, log_admin_action
from services.notifications import create_notification
from utils import now_utc


router = APIRouter(tags=["support"])

VALID_CATEGORIES = {
    "payments",
    "orders",
    "kyc",
    "shipping",
    "account",
    "listings",
    "returns",
    "other",
}
VALID_PRIORITIES = {"low", "medium", "high", "urgent"}
# Status flow:  open → in_progress → awaiting_reply → resolved → closed
VALID_STATUSES = {
    "open",
    "in_progress",
    "awaiting_reply",
    "resolved",
    "closed",
}
SLA_HOURS = {"urgent": 4, "high": 24, "medium": 48, "low": 72}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TicketCreate(BaseModel):
    subject: str = Field(..., min_length=4, max_length=140)
    description: str = Field(..., min_length=10, max_length=4000)
    category: str = Field(..., description="One of VALID_CATEGORIES")
    priority: str = Field("medium", description="One of VALID_PRIORITIES")
    attachments: List[str] = Field(default_factory=list, max_length=4)

    @field_validator("category")
    @classmethod
    def _cat(cls, v):
        v = v.lower().strip()
        if v not in VALID_CATEGORIES:
            raise ValueError(f"Category must be one of {sorted(VALID_CATEGORIES)}")
        return v

    @field_validator("priority")
    @classmethod
    def _pri(cls, v):
        v = v.lower().strip()
        if v not in VALID_PRIORITIES:
            raise ValueError(f"Priority must be one of {sorted(VALID_PRIORITIES)}")
        return v


class TicketReply(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)
    attachments: List[str] = Field(default_factory=list, max_length=4)


class TicketRating(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=600)


class TicketStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def _ok(cls, v):
        v = v.lower().strip()
        if v not in VALID_STATUSES:
            raise ValueError(f"Status must be one of {sorted(VALID_STATUSES)}")
        return v


class TicketAssign(BaseModel):
    assignee_admin_id: Optional[str] = None


class TicketMessage(BaseModel):
    id: str
    ticket_id: str
    sender_id: str
    sender_role: str  # seller | admin | system
    sender_name: Optional[str] = None
    body: str
    attachments: List[str] = Field(default_factory=list)
    is_internal_note: bool = False
    created_at: datetime


class Ticket(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: Optional[str] = None
    user_role: str = "seller"
    subject: str
    category: str
    priority: str
    status: str
    assignee_admin_id: Optional[str] = None
    assignee_name: Optional[str] = None
    sla_due_at: Optional[datetime] = None
    sla_breached: bool = False
    last_reply_at: Optional[datetime] = None
    last_reply_by: Optional[str] = None  # seller | admin
    reply_count: int = 0
    csat_rating: Optional[int] = None
    csat_comment: Optional[str] = None
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class TicketDetail(BaseModel):
    ticket: Ticket
    messages: List[TicketMessage]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _short(tid: str) -> str:
    return tid.replace("tkt_", "")[:8].upper()


async def _admin_dep(
    authorization: Annotated[Optional[str], Header()] = None,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
) -> dict:
    """Allow either legacy `x-admin-secret` OR a Bearer admin JWT."""
    if x_admin_secret and x_admin_secret == ADMIN_SECRET:
        return {"id": "legacy_admin", "email": "system@allsale", "role": "owner"}
    if authorization:
        try:
            return await get_current_admin(authorization=authorization)
        except HTTPException:
            raise
    raise HTTPException(status_code=401, detail="Admin auth required")


def _sla_due(priority: str, created_at: datetime) -> datetime:
    hours = SLA_HOURS.get(priority, 48)
    return created_at + timedelta(hours=hours)


async def _doc_to_ticket(doc: dict) -> Ticket:
    """Hydrate ticket doc → Ticket model with derived `sla_breached`."""
    sla_due = doc.get("sla_due_at")
    breached = False
    if (
        sla_due
        and doc.get("status") in {"open", "in_progress", "awaiting_reply"}
    ):
        if sla_due.tzinfo is None:
            from datetime import timezone

            sla_due = sla_due.replace(tzinfo=timezone.utc)
        breached = sla_due < now_utc()
    return Ticket(
        id=doc["id"],
        user_id=doc["user_id"],
        user_email=doc.get("user_email") or "",
        user_name=doc.get("user_name"),
        user_role=doc.get("user_role") or "seller",
        subject=doc["subject"],
        category=doc["category"],
        priority=doc["priority"],
        status=doc["status"],
        assignee_admin_id=doc.get("assignee_admin_id"),
        assignee_name=doc.get("assignee_name"),
        sla_due_at=doc.get("sla_due_at"),
        sla_breached=breached,
        last_reply_at=doc.get("last_reply_at"),
        last_reply_by=doc.get("last_reply_by"),
        reply_count=int(doc.get("reply_count") or 0),
        csat_rating=doc.get("csat_rating"),
        csat_comment=doc.get("csat_comment"),
        resolved_at=doc.get("resolved_at"),
        created_at=doc["created_at"],
        updated_at=doc.get("updated_at") or doc["created_at"],
    )


# ---------------------------------------------------------------------------
# Seller endpoints
# ---------------------------------------------------------------------------
@router.post("/support/tickets", response_model=Ticket)
async def create_ticket(body: TicketCreate, current=Depends(get_current_user)):
    """Sellers (or any logged-in user) can raise a support ticket."""
    tid = f"tkt_{uuid.uuid4().hex[:12]}"
    created_at = now_utc()
    doc = {
        "id": tid,
        "user_id": current["id"],
        "user_email": current.get("email", ""),
        "user_name": current.get("full_name"),
        "user_role": "seller" if current.get("is_seller") else "buyer",
        "subject": body.subject.strip(),
        "category": body.category,
        "priority": body.priority,
        "status": "open",
        "assignee_admin_id": None,
        "assignee_name": None,
        "sla_due_at": _sla_due(body.priority, created_at),
        "last_reply_at": created_at,
        "last_reply_by": current.get("is_seller") and "seller" or "buyer",
        "reply_count": 0,
        "csat_rating": None,
        "csat_comment": None,
        "resolved_at": None,
        "created_at": created_at,
        "updated_at": created_at,
    }
    await db.support_tickets.insert_one(doc)
    # First message = the original description
    mid = f"msg_{uuid.uuid4().hex[:12]}"
    await db.support_messages.insert_one(
        {
            "id": mid,
            "ticket_id": tid,
            "sender_id": current["id"],
            "sender_role": doc["user_role"],
            "sender_name": current.get("full_name"),
            "body": body.description.strip(),
            "attachments": list(body.attachments or [])[:4],
            "is_internal_note": False,
            "created_at": created_at,
        }
    )
    # Notify admins
    try:
        await create_notification(
            user_id="admin",
            role="admin",
            n_type="support_ticket",
            title=f"New ticket #{_short(tid)} — {body.category}",
            body=f"{doc['user_email']}: {body.subject}",
        )
    except Exception:
        pass
    return await _doc_to_ticket(doc)


@router.get("/support/tickets", response_model=List[Ticket])
async def list_my_tickets(
    status: Optional[str] = Query(default=None),
    current=Depends(get_current_user),
):
    q: dict = {"user_id": current["id"]}
    if status and status in VALID_STATUSES:
        q["status"] = status
    out: list[Ticket] = []
    async for doc in db.support_tickets.find(q, {"_id": 0}).sort(
        [("updated_at", -1)]
    ):
        out.append(await _doc_to_ticket(doc))
    return out


@router.get("/support/tickets/{ticket_id}", response_model=TicketDetail)
async def get_my_ticket(ticket_id: str, current=Depends(get_current_user)):
    doc = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not doc or doc.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msgs: list[TicketMessage] = []
    async for m in db.support_messages.find(
        {"ticket_id": ticket_id, "is_internal_note": False}, {"_id": 0}
    ).sort([("created_at", 1)]):
        msgs.append(TicketMessage(**m))
    return TicketDetail(ticket=await _doc_to_ticket(doc), messages=msgs)


@router.post(
    "/support/tickets/{ticket_id}/reply", response_model=TicketMessage
)
async def reply_to_my_ticket(
    ticket_id: str, body: TicketReply, current=Depends(get_current_user)
):
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc or doc.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if doc.get("status") in {"closed"}:
        raise HTTPException(status_code=400, detail="This ticket is closed")
    now = now_utc()
    mid = f"msg_{uuid.uuid4().hex[:12]}"
    sender_role = "seller" if current.get("is_seller") else "buyer"
    await db.support_messages.insert_one(
        {
            "id": mid,
            "ticket_id": ticket_id,
            "sender_id": current["id"],
            "sender_role": sender_role,
            "sender_name": current.get("full_name"),
            "body": body.body.strip(),
            "attachments": list(body.attachments or [])[:4],
            "is_internal_note": False,
            "created_at": now,
        }
    )
    # If the ticket was resolved, re-open it on a new seller reply
    new_status = doc["status"]
    if doc["status"] in {"resolved", "awaiting_reply"}:
        new_status = "in_progress"
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {
            "$set": {
                "last_reply_at": now,
                "last_reply_by": sender_role,
                "status": new_status,
                "updated_at": now,
            },
            "$inc": {"reply_count": 1},
        },
    )
    try:
        await create_notification(
            user_id="admin",
            role="admin",
            n_type="support_reply",
            title=f"Seller replied — ticket #{_short(ticket_id)}",
            body=body.body[:140],
        )
    except Exception:
        pass
    return TicketMessage(
        id=mid,
        ticket_id=ticket_id,
        sender_id=current["id"],
        sender_role=sender_role,
        sender_name=current.get("full_name"),
        body=body.body.strip(),
        attachments=list(body.attachments or [])[:4],
        is_internal_note=False,
        created_at=now,
    )


@router.post("/support/tickets/{ticket_id}/rate", response_model=Ticket)
async def rate_my_ticket(
    ticket_id: str, body: TicketRating, current=Depends(get_current_user)
):
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc or doc.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if doc.get("status") not in {"resolved", "closed"}:
        raise HTTPException(
            status_code=400,
            detail="You can only rate a ticket after it has been resolved.",
        )
    if doc.get("csat_rating"):
        raise HTTPException(
            status_code=400, detail="You have already rated this ticket."
        )
    now = now_utc()
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {
            "$set": {
                "csat_rating": int(body.rating),
                "csat_comment": (body.comment or "").strip() or None,
                "updated_at": now,
            }
        },
    )
    fresh = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    return await _doc_to_ticket(fresh)


@router.post("/support/tickets/{ticket_id}/close", response_model=Ticket)
async def close_my_ticket(ticket_id: str, current=Depends(get_current_user)):
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc or doc.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Ticket not found")
    now = now_utc()
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$set": {"status": "closed", "updated_at": now}},
    )
    fresh = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    return await _doc_to_ticket(fresh)


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------
@router.get("/admin/tickets", response_model=List[Ticket])
async def admin_list_tickets(
    status: Optional[str] = Query(default=None),
    priority: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    breached_only: bool = Query(default=False),
    admin=Depends(_admin_dep),
):
    q: dict = {}
    if status and status in VALID_STATUSES:
        q["status"] = status
    if priority and priority in VALID_PRIORITIES:
        q["priority"] = priority
    if category and category in VALID_CATEGORIES:
        q["category"] = category
    out: list[Ticket] = []
    async for doc in db.support_tickets.find(q, {"_id": 0}).sort(
        [("updated_at", -1)]
    ):
        t = await _doc_to_ticket(doc)
        if breached_only and not t.sla_breached:
            continue
        out.append(t)
    return out


@router.get("/admin/tickets/{ticket_id}", response_model=TicketDetail)
async def admin_get_ticket(ticket_id: str, admin=Depends(_admin_dep)):
    doc = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    msgs: list[TicketMessage] = []
    async for m in db.support_messages.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort([("created_at", 1)]):
        msgs.append(TicketMessage(**m))
    return TicketDetail(ticket=await _doc_to_ticket(doc), messages=msgs)


@router.post(
    "/admin/tickets/{ticket_id}/reply", response_model=TicketMessage
)
async def admin_reply(
    ticket_id: str, body: TicketReply, admin=Depends(_admin_dep)
):
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    now = now_utc()
    mid = f"msg_{uuid.uuid4().hex[:12]}"
    admin_name = admin.get("full_name") or "Allsale support"
    await db.support_messages.insert_one(
        {
            "id": mid,
            "ticket_id": ticket_id,
            "sender_id": admin["id"],
            "sender_role": "admin",
            "sender_name": admin_name,
            "body": body.body.strip(),
            "attachments": list(body.attachments or [])[:4],
            "is_internal_note": False,
            "created_at": now,
        }
    )
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {
            "$set": {
                "status": "awaiting_reply",
                "last_reply_at": now,
                "last_reply_by": "admin",
                "updated_at": now,
            },
            "$inc": {"reply_count": 1},
        },
    )
    # Notify the seller (in-app)
    try:
        await create_notification(
            user_id=doc["user_id"],
            role=doc.get("user_role") or "seller",
            n_type="support_reply",
            title=f"Allsale support replied — #{_short(ticket_id)}",
            body=body.body[:140],
        )
    except Exception:
        pass
    if admin["id"] != "legacy_admin":
        await log_admin_action(
            admin["id"], "support_reply", target=ticket_id, meta={"msg_id": mid}
        )
    return TicketMessage(
        id=mid,
        ticket_id=ticket_id,
        sender_id=admin["id"],
        sender_role="admin",
        sender_name=admin_name,
        body=body.body.strip(),
        attachments=list(body.attachments or [])[:4],
        is_internal_note=False,
        created_at=now,
    )


@router.post(
    "/admin/tickets/{ticket_id}/note", response_model=TicketMessage
)
async def admin_internal_note(
    ticket_id: str, body: TicketReply, admin=Depends(_admin_dep)
):
    """Admin-only note, never shown to the seller."""
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    now = now_utc()
    mid = f"msg_{uuid.uuid4().hex[:12]}"
    admin_name = admin.get("full_name") or "Allsale support"
    await db.support_messages.insert_one(
        {
            "id": mid,
            "ticket_id": ticket_id,
            "sender_id": admin["id"],
            "sender_role": "admin",
            "sender_name": admin_name,
            "body": body.body.strip(),
            "attachments": list(body.attachments or [])[:4],
            "is_internal_note": True,
            "created_at": now,
        }
    )
    await db.support_tickets.update_one(
        {"id": ticket_id}, {"$set": {"updated_at": now}}
    )
    return TicketMessage(
        id=mid,
        ticket_id=ticket_id,
        sender_id=admin["id"],
        sender_role="admin",
        sender_name=admin_name,
        body=body.body.strip(),
        attachments=list(body.attachments or [])[:4],
        is_internal_note=True,
        created_at=now,
    )


@router.patch(
    "/admin/tickets/{ticket_id}/status", response_model=Ticket
)
async def admin_set_status(
    ticket_id: str, body: TicketStatusUpdate, admin=Depends(_admin_dep)
):
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    now = now_utc()
    update: dict = {"status": body.status, "updated_at": now}
    if body.status == "resolved":
        update["resolved_at"] = now
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": update})
    if admin["id"] != "legacy_admin":
        await log_admin_action(
            admin["id"],
            "support_status",
            target=ticket_id,
            meta={"to": body.status, "from": doc.get("status")},
        )
    # If resolved, notify seller to leave CSAT
    if body.status == "resolved":
        try:
            await create_notification(
                user_id=doc["user_id"],
                role=doc.get("user_role") or "seller",
                n_type="support_resolved",
                title=f"Ticket resolved — #{_short(ticket_id)}",
                body="Tap to leave a rating for our support team.",
            )
        except Exception:
            pass
    fresh = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    return await _doc_to_ticket(fresh)


@router.patch(
    "/admin/tickets/{ticket_id}/assign", response_model=Ticket
)
async def admin_assign(
    ticket_id: str, body: TicketAssign, admin=Depends(_admin_dep)
):
    doc = await db.support_tickets.find_one({"id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    update: dict = {
        "assignee_admin_id": body.assignee_admin_id,
        "updated_at": now_utc(),
    }
    if body.assignee_admin_id:
        a = await db.admin_users.find_one(
            {"id": body.assignee_admin_id}, {"full_name": 1, "email": 1, "_id": 0}
        )
        update["assignee_name"] = (
            (a or {}).get("full_name") or (a or {}).get("email")
        )
        if doc.get("status") == "open":
            update["status"] = "in_progress"
    else:
        update["assignee_name"] = None
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": update})
    if admin["id"] != "legacy_admin":
        await log_admin_action(
            admin["id"],
            "support_assign",
            target=ticket_id,
            meta={"assignee": body.assignee_admin_id},
        )
    fresh = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    return await _doc_to_ticket(fresh)
