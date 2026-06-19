"""Notifications endpoints (buyer/seller in-app)."""
from __future__ import annotations

from typing import Annotated, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from config import ADMIN_SECRET
from db import db
from deps import get_current_user
from models import Notification
from services.notification_prefs import NOTIFICATION_CATEGORIES, default_prefs

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=List[Notification])
async def list_my_notifications(current=Depends(get_current_user)):
    cursor = (
        db.notifications.find({"user_id": current["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(100)
    )
    return [Notification(**n) async for n in cursor]


@router.get("/notifications/unread-count")
async def my_unread_count(current=Depends(get_current_user)):
    count = await db.notifications.count_documents(
        {"user_id": current["id"], "read": False}
    )
    return {"unread": int(count)}


@router.post("/notifications/{notification_id}/read", response_model=Notification)
async def mark_notification_read(
    notification_id: str, current=Depends(get_current_user)
):
    res = await db.notifications.find_one_and_update(
        {"id": notification_id, "user_id": current["id"]},
        {"$set": {"read": True}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Notification not found")
    res.pop("_id", None)
    return Notification(**res)


@router.post("/notifications/read-all")
async def mark_all_read(current=Depends(get_current_user)):
    res = await db.notifications.update_many(
        {"user_id": current["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"updated": res.modified_count}


# ---------------------------------------------------------------------------
# Per-category mute preferences
# ---------------------------------------------------------------------------
class PrefsUpdate(BaseModel):
    prefs: Dict[str, bool] = Field(default_factory=dict)


def _categories_for_role(role: str) -> list[dict]:
    """Filter the static category catalog to those that apply to the
    current user's role. Sellers don't see buyer-only categories like
    'promos' and vice-versa; mixed-role users (buyer + seller) see all.
    """
    roles = {role}
    # A user is both buyer & seller when they have is_seller=True — the
    # router exposes both buckets so the same prefs screen works in both
    # contexts without us having to maintain two screens.
    return [
        c for c in NOTIFICATION_CATEGORIES if set(c["roles"]) & roles
    ]


@router.get("/me/notification-prefs")
async def get_my_notification_prefs(current=Depends(get_current_user)):
    """Returns the buyer/seller's current per-category mute preferences,
    augmented with display metadata so the client only needs one call.
    Categories the user hasn't touched yet are returned with their
    default value (True = enabled).
    """
    role = "seller" if current.get("is_seller") else "buyer"
    doc = await db.notification_prefs.find_one(
        {"user_id": current["id"]}, {"_id": 0, "prefs": 1}
    )
    stored = (doc or {}).get("prefs") or {}
    merged = {**default_prefs(), **stored}

    # Always include buyer rows; include seller rows when the user is a
    # seller too. This way a user who later becomes a seller sees the new
    # seller_alerts row immediately.
    visible_roles = {"buyer"}
    if current.get("is_seller"):
        visible_roles.add("seller")

    categories = []
    for c in NOTIFICATION_CATEGORIES:
        if not set(c["roles"]) & visible_roles:
            continue
        categories.append(
            {
                "key": c["key"],
                "label": c["label"],
                "description": c["description"],
                "enabled": bool(merged.get(c["key"], c["default"])),
            }
        )
    return {"role": role, "categories": categories}


@router.put("/me/notification-prefs")
async def update_my_notification_prefs(
    body: PrefsUpdate, current=Depends(get_current_user)
):
    """Upsert a partial set of preferences (any keys not provided keep
    their previous value). Unknown keys are ignored to keep the contract
    forward-compatible if the client lags behind the server."""
    if not body.prefs:
        raise HTTPException(
            status_code=400, detail="No preferences provided"
        )
    valid_keys = {c["key"] for c in NOTIFICATION_CATEGORIES}
    clean = {k: bool(v) for k, v in body.prefs.items() if k in valid_keys}
    if not clean:
        raise HTTPException(
            status_code=400, detail="No valid preference keys provided"
        )

    # Build $set with dotted paths so existing keys aren't blown away.
    set_doc: dict[str, bool] = {f"prefs.{k}": v for k, v in clean.items()}
    await db.notification_prefs.update_one(
        {"user_id": current["id"]},
        {"$set": {"user_id": current["id"], **set_doc}},
        upsert=True,
    )

    # Echo the merged view back so the client can update its UI in one
    # round trip.
    doc = await db.notification_prefs.find_one(
        {"user_id": current["id"]}, {"_id": 0, "prefs": 1}
    )
    merged = {**default_prefs(), **((doc or {}).get("prefs") or {})}
    return {"prefs": merged}


@router.get("/admin/notifications", response_model=List[Notification])
async def admin_list_notifications(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    cursor = (
        db.notifications.find({"user_id": "admin"}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )
    return [Notification(**n) async for n in cursor]
