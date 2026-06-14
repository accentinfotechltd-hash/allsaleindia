"""Invoice-financing partner referrals.

Allsale doesn't lend its own money — instead we refer pre-qualified sellers
to NBFC / fintech partners (KredX, Cashinvoice, FlexiLoans) who advance
70-80% of confirmed payable invoices within 24h.

Endpoints:
  GET  /api/financing/partners        public — list partners + eligibility
  POST /api/financing/apply           authenticated seller — express interest
  GET  /api/financing/applications    authenticated seller — list own apps
  GET  /api/admin/financing           admin — all applications (filtered)
  PATCH /api/admin/financing/{id}     admin — update status / notes
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from config import ADMIN_SECRET
from db import db
from deps import get_current_user
from services.seller_tier import get_seller_tier_snapshot
from utils import now_utc


router = APIRouter(tags=["financing"])


# ---------------------------------------------------------------------------
# Partners catalogue (static — easy to expand later)
# ---------------------------------------------------------------------------
PARTNERS: list[dict] = [
    {
        "id": "kredx",
        "name": "KredX",
        "tagline": "India's largest invoice discounting platform",
        "website": "https://www.kredx.com/",
        "advance_pct_min": 80,
        "advance_pct_max": 90,
        "fee_pct_min": 0.8,
        "fee_pct_max": 1.5,
        "min_monthly_invoices_inr": 100000,  # ₹1L/month minimum
        "min_business_age_months": 6,
        "turnaround_hours": 24,
        "logo": "https://www.kredx.com/favicon.ico",
        "best_for": ["Mid-to-large sellers", "Bulk export orders", "Fast turnaround"],
    },
    {
        "id": "cashinvoice",
        "name": "Cashinvoice",
        "tagline": "Working capital against your buyer invoices",
        "website": "https://www.cashinvoice.in/",
        "advance_pct_min": 70,
        "advance_pct_max": 85,
        "fee_pct_min": 1.0,
        "fee_pct_max": 2.0,
        "min_monthly_invoices_inr": 50000,  # ₹50k/month
        "min_business_age_months": 3,
        "turnaround_hours": 48,
        "logo": "https://www.cashinvoice.in/favicon.ico",
        "best_for": ["Small / new sellers", "GST-registered", "Lower paperwork"],
    },
    {
        "id": "flexiloans",
        "name": "FlexiLoans",
        "tagline": "Quick MSME business loans up to ₹1Cr",
        "website": "https://flexiloans.com/",
        "advance_pct_min": 0,  # Loan, not invoice discounting
        "advance_pct_max": 100,
        "fee_pct_min": 1.5,
        "fee_pct_max": 2.5,
        "min_monthly_invoices_inr": 30000,
        "min_business_age_months": 6,
        "turnaround_hours": 72,
        "logo": "https://flexiloans.com/favicon.ico",
        "best_for": ["Term loans", "Marketing & inventory capex", "Quick KYC"],
    },
]


VALID_STATUSES = {"interest", "submitted_to_partner", "approved", "rejected", "withdrawn"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class FinancingApply(BaseModel):
    partner_id: str
    desired_advance_nzd: float = Field(..., gt=0, le=1_000_000)
    monthly_invoices_inr: Optional[float] = Field(default=None, ge=0)
    business_age_months: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=600)


class FinancingApplication(BaseModel):
    id: str
    user_id: str
    user_email: str
    partner_id: str
    partner_name: str
    desired_advance_nzd: float
    monthly_invoices_inr: Optional[float] = None
    business_age_months: Optional[int] = None
    notes: Optional[str] = None
    seller_tier: Optional[str] = None
    status: str
    admin_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class StatusUpdate(BaseModel):
    status: str
    admin_notes: Optional[str] = Field(default=None, max_length=600)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _eligibility_for_tier(tier_name: str) -> dict:
    """Allsale's recommendation — only Verified+ get nudged toward financing.

    Starter sellers are encouraged to build reputation first; financing fees
    can eat into already-thin margins.
    """
    if tier_name == "starter":
        return {
            "eligible": False,
            "reason": "Build to Verified tier (10+ delivered orders) first — financing fees can erode thin margins on early orders.",
        }
    return {
        "eligible": True,
        "reason": "Your account qualifies. Partners will run their own KYC + credit check.",
    }


async def _to_application(doc: dict) -> FinancingApplication:
    return FinancingApplication(
        id=doc["id"],
        user_id=doc["user_id"],
        user_email=doc.get("user_email") or "",
        partner_id=doc["partner_id"],
        partner_name=doc.get("partner_name") or doc["partner_id"],
        desired_advance_nzd=float(doc.get("desired_advance_nzd") or 0),
        monthly_invoices_inr=doc.get("monthly_invoices_inr"),
        business_age_months=doc.get("business_age_months"),
        notes=doc.get("notes"),
        seller_tier=doc.get("seller_tier"),
        status=doc.get("status") or "interest",
        admin_notes=doc.get("admin_notes"),
        created_at=doc["created_at"],
        updated_at=doc.get("updated_at") or doc["created_at"],
    )


# ---------------------------------------------------------------------------
# Public + seller endpoints
# ---------------------------------------------------------------------------
@router.get("/financing/partners")
async def list_partners(current=Depends(get_current_user)):
    """Returns the partner catalog + seller eligibility based on current tier."""
    snapshot = await get_seller_tier_snapshot(current["id"])
    tier_name = snapshot["tier"]["name"]
    elig = _eligibility_for_tier(tier_name)
    return {
        "tier": tier_name,
        "tier_label": snapshot["tier"]["label"],
        "eligibility": elig,
        "disclaimer": (
            "Allsale is a referrer, not a lender. Partners conduct their own KYC, "
            "credit checks, and set their own terms. Read partner terms before applying."
        ),
        "partners": PARTNERS,
    }


@router.post("/financing/apply", response_model=FinancingApplication)
async def express_interest(
    body: FinancingApply, current=Depends(get_current_user)
):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    # Validate partner
    partner = next((p for p in PARTNERS if p["id"] == body.partner_id), None)
    if not partner:
        raise HTTPException(status_code=400, detail="Unknown partner")

    # Tier gate
    snapshot = await get_seller_tier_snapshot(current["id"])
    tier_name = snapshot["tier"]["name"]
    elig = _eligibility_for_tier(tier_name)
    if not elig["eligible"]:
        raise HTTPException(status_code=400, detail=elig["reason"])

    # Don't allow double-active applications to the same partner
    existing = await db.financing_applications.find_one(
        {
            "user_id": current["id"],
            "partner_id": body.partner_id,
            "status": {"$in": ["interest", "submitted_to_partner"]},
        },
        {"_id": 0},
    )
    if existing:
        return await _to_application(existing)

    now = now_utc()
    doc = {
        "id": f"fin_{uuid.uuid4().hex[:12]}",
        "user_id": current["id"],
        "user_email": current.get("email") or "",
        "partner_id": partner["id"],
        "partner_name": partner["name"],
        "desired_advance_nzd": round(float(body.desired_advance_nzd), 2),
        "monthly_invoices_inr": body.monthly_invoices_inr,
        "business_age_months": body.business_age_months,
        "notes": (body.notes or "").strip() or None,
        "seller_tier": tier_name,
        "status": "interest",
        "admin_notes": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.financing_applications.insert_one(doc)

    # Notify admins
    try:
        from services.notifications import create_notification

        await create_notification(
            user_id="admin",
            role="admin",
            n_type="financing_application",
            title=f"New financing interest — {partner['name']}",
            body=f"{doc['user_email']} wants NZD {body.desired_advance_nzd:,.0f}",
        )
    except Exception:
        pass

    return await _to_application(doc)


@router.get("/financing/applications", response_model=List[FinancingApplication])
async def list_my_applications(current=Depends(get_current_user)):
    out: list[FinancingApplication] = []
    async for doc in db.financing_applications.find(
        {"user_id": current["id"]}, {"_id": 0}
    ).sort("created_at", -1):
        out.append(await _to_application(doc))
    return out


@router.post("/financing/applications/{app_id}/withdraw", response_model=FinancingApplication)
async def withdraw_my_application(app_id: str, current=Depends(get_current_user)):
    doc = await db.financing_applications.find_one({"id": app_id}, {"_id": 0})
    if not doc or doc.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Application not found")
    if doc["status"] in {"approved", "rejected", "withdrawn"}:
        return await _to_application(doc)
    await db.financing_applications.update_one(
        {"id": app_id},
        {"$set": {"status": "withdrawn", "updated_at": now_utc()}},
    )
    fresh = await db.financing_applications.find_one({"id": app_id}, {"_id": 0})
    return await _to_application(fresh)


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------
def _require_admin(secret: Optional[str]) -> None:
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/admin/financing", response_model=List[FinancingApplication])
async def admin_list(
    status: Optional[str] = None,
    partner_id: Optional[str] = None,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    _require_admin(x_admin_secret)
    q: dict = {}
    if status and status in VALID_STATUSES:
        q["status"] = status
    if partner_id:
        q["partner_id"] = partner_id
    out: list[FinancingApplication] = []
    async for doc in db.financing_applications.find(q, {"_id": 0}).sort(
        "created_at", -1
    ):
        out.append(await _to_application(doc))
    return out


@router.patch("/admin/financing/{app_id}", response_model=FinancingApplication)
async def admin_update(
    app_id: str,
    body: StatusUpdate,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    _require_admin(x_admin_secret)
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400, detail=f"status must be one of {sorted(VALID_STATUSES)}"
        )
    update: dict = {"status": body.status, "updated_at": now_utc()}
    if body.admin_notes is not None:
        update["admin_notes"] = body.admin_notes.strip() or None
    res = await db.financing_applications.update_one(
        {"id": app_id}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Application not found")
    fresh = await db.financing_applications.find_one({"id": app_id}, {"_id": 0})
    return await _to_application(fresh)
