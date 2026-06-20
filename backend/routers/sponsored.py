"""Sponsored placements — seller-paid product boosts ("Sponsored" slots).

MVP model (post-paid, monthly invoice):
  - Sellers create a ``SponsoredCampaign`` for one of their products.
  - Each campaign has a CPC (cost-per-click in NZD) and a ``daily_budget_nzd``.
  - The public ``/sponsored/slots`` endpoint returns active, in-budget
    campaigns weighted by remaining-daily-budget so higher-budget
    campaigns are shown more often.
  - Clicks are tracked through ``/sponsored/track/click``. Each click
    deducts ``cpc_nzd`` from ``spent_today`` and adds to ``spent_total``.
    When ``spent_today >= daily_budget_nzd`` the campaign auto-pauses
    until UTC midnight (status → ``out_of_budget``).
  - Impressions are also tracked (free, for CTR analytics).

Billing: ``spent_total`` is what we'll invoice the seller monthly. The
seller dashboard surfaces both spend + CTR so it's transparent.
"""
from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user, get_current_user_optional
from utils import now_utc

logger = logging.getLogger("allsale.sponsored")
router = APIRouter(tags=["sponsored"])

# ---------------------------------------------------------------------------
# Tuning constants — defaults for a balanced auction.
# ---------------------------------------------------------------------------
MIN_CPC = 0.10          # 10 cents NZD floor (anti-fraud)
MAX_CPC = 5.00          # cap so a campaign can't auction-storm
DEFAULT_CPC = 0.50
MIN_DAILY_BUDGET = 1.0
MAX_DAILY_BUDGET = 500.0
PLACEMENTS = {"home", "category", "search", "pdp"}


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CampaignCreate(BaseModel):
    product_id: str
    daily_budget_nzd: float = Field(..., ge=MIN_DAILY_BUDGET, le=MAX_DAILY_BUDGET)
    cpc_nzd: float = Field(DEFAULT_CPC, ge=MIN_CPC, le=MAX_CPC)
    placements: list[Literal["home", "category", "search", "pdp"]] = Field(
        default_factory=lambda: ["home", "category", "search"]
    )


class CampaignUpdate(BaseModel):
    daily_budget_nzd: Optional[float] = Field(None, ge=MIN_DAILY_BUDGET, le=MAX_DAILY_BUDGET)
    cpc_nzd: Optional[float] = Field(None, ge=MIN_CPC, le=MAX_CPC)
    status: Optional[Literal["active", "paused"]] = None
    placements: Optional[list[Literal["home", "category", "search", "pdp"]]] = None


class CampaignOut(BaseModel):
    id: str
    seller_id: str
    product_id: str
    product_name: Optional[str] = None
    product_image: Optional[str] = None
    daily_budget_nzd: float
    cpc_nzd: float
    placements: list[str]
    status: str  # active | paused | out_of_budget
    impressions: int
    clicks: int
    ctr: float
    spent_today: float
    spent_total: float
    last_reset_date: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class TrackEvent(BaseModel):
    campaign_id: str
    product_id: str
    placement: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _today_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _ctr(impressions: int, clicks: int) -> float:
    return round(clicks / impressions * 100, 2) if impressions else 0.0


async def _serialize(doc: dict) -> dict:
    pid = doc.get("product_id")
    name, image = None, None
    if pid:
        p = await db.products.find_one(
            {"id": pid}, {"_id": 0, "name": 1, "image": 1}
        )
        if p:
            name = p.get("name")
            image = p.get("image")
    return {
        **doc,
        "product_name": name,
        "product_image": image,
        "ctr": _ctr(doc.get("impressions", 0), doc.get("clicks", 0)),
    }


async def _reset_daily_if_needed(doc: dict) -> dict:
    """Reset spent_today + revive out_of_budget campaigns at UTC midnight."""
    today = _today_utc_iso()
    if doc.get("last_reset_date") == today:
        return doc
    updates = {
        "last_reset_date": today,
        "spent_today": 0.0,
        "updated_at": now_utc(),
    }
    if doc.get("status") == "out_of_budget":
        updates["status"] = "active"
    await db.sponsored_campaigns.update_one(
        {"id": doc["id"]}, {"$set": updates}
    )
    return {**doc, **updates}


async def _require_owns_product(seller_id: str, product_id: str) -> dict:
    p = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "id": 1, "seller_id": 1, "in_stock": 1}
    )
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if p.get("seller_id") != seller_id:
        raise HTTPException(status_code=403, detail="You don't own this product")
    return p


# ---------------------------------------------------------------------------
# Seller — CRUD
# ---------------------------------------------------------------------------
@router.post("/seller/sponsored/campaigns", response_model=CampaignOut)
async def create_campaign(
    body: CampaignCreate,
    current=Depends(get_current_user),
):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    await _require_owns_product(current["id"], body.product_id)

    # One active campaign per (seller, product) — refuse duplicates.
    existing = await db.sponsored_campaigns.find_one(
        {
            "seller_id": current["id"],
            "product_id": body.product_id,
            "status": {"$in": ["active", "paused", "out_of_budget"]},
        },
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Already promoting this product (campaign {existing['id']})",
        )

    doc = {
        "id": f"camp_{uuid.uuid4().hex[:12]}",
        "seller_id": current["id"],
        "product_id": body.product_id,
        "daily_budget_nzd": float(body.daily_budget_nzd),
        "cpc_nzd": float(body.cpc_nzd),
        "placements": list(body.placements),
        "status": "active",
        "impressions": 0,
        "clicks": 0,
        "spent_today": 0.0,
        "spent_total": 0.0,
        "last_reset_date": _today_utc_iso(),
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    await db.sponsored_campaigns.insert_one(doc)
    return CampaignOut(**(await _serialize(doc)))


@router.get("/seller/sponsored/campaigns", response_model=list[CampaignOut])
async def list_my_campaigns(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    out: list[dict] = []
    async for d in db.sponsored_campaigns.find(
        {"seller_id": current["id"], "status": {"$ne": "deleted"}},
        {"_id": 0},
    ).sort([("created_at", -1)]):
        d = await _reset_daily_if_needed(d)
        out.append(await _serialize(d))
    return [CampaignOut(**o) for o in out]


@router.get(
    "/seller/sponsored/campaigns/{campaign_id}",
    response_model=CampaignOut,
)
async def get_campaign(
    campaign_id: str, current=Depends(get_current_user)
):
    d = await db.sponsored_campaigns.find_one(
        {"id": campaign_id, "seller_id": current["id"]}, {"_id": 0}
    )
    if not d:
        raise HTTPException(status_code=404, detail="Campaign not found")
    d = await _reset_daily_if_needed(d)
    return CampaignOut(**(await _serialize(d)))


@router.patch(
    "/seller/sponsored/campaigns/{campaign_id}",
    response_model=CampaignOut,
)
async def update_campaign(
    campaign_id: str,
    body: CampaignUpdate,
    current=Depends(get_current_user),
):
    d = await db.sponsored_campaigns.find_one(
        {"id": campaign_id, "seller_id": current["id"]}, {"_id": 0}
    )
    if not d:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if d.get("status") == "deleted":
        raise HTTPException(status_code=410, detail="Campaign was deleted")

    updates: dict = {"updated_at": now_utc()}
    if body.daily_budget_nzd is not None:
        updates["daily_budget_nzd"] = float(body.daily_budget_nzd)
    if body.cpc_nzd is not None:
        updates["cpc_nzd"] = float(body.cpc_nzd)
    if body.placements is not None:
        updates["placements"] = list(body.placements)
    if body.status is not None:
        # Allowed manual transitions: active <-> paused
        if body.status not in ("active", "paused"):
            raise HTTPException(status_code=400, detail="Bad status")
        updates["status"] = body.status

    await db.sponsored_campaigns.update_one(
        {"id": campaign_id}, {"$set": updates}
    )
    updated = await db.sponsored_campaigns.find_one(
        {"id": campaign_id}, {"_id": 0}
    )
    updated = await _reset_daily_if_needed(updated)
    return CampaignOut(**(await _serialize(updated)))


@router.delete("/seller/sponsored/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: str, current=Depends(get_current_user)
):
    d = await db.sponsored_campaigns.find_one(
        {"id": campaign_id, "seller_id": current["id"]}, {"_id": 0, "id": 1}
    )
    if not d:
        raise HTTPException(status_code=404, detail="Campaign not found")
    await db.sponsored_campaigns.update_one(
        {"id": campaign_id},
        {"$set": {"status": "deleted", "updated_at": now_utc()}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Public — slot serving
# ---------------------------------------------------------------------------
@router.get("/sponsored/slots")
async def serve_slots(
    placement: str = Query("home"),
    category: Optional[str] = None,
    limit: int = Query(4, ge=1, le=10),
):
    """Return a randomised, budget-weighted set of sponsored products for
    the requested placement. The frontend renders each item with a small
    "Sponsored" badge and fires impression beacons.
    """
    if placement not in PLACEMENTS:
        raise HTTPException(status_code=400, detail=f"Bad placement: {placement}")

    today = _today_utc_iso()
    q: dict = {
        "status": "active",
        "placements": placement,
    }
    candidates: list[dict] = []
    async for d in db.sponsored_campaigns.find(q, {"_id": 0}):
        d = await _reset_daily_if_needed(d)
        if d.get("status") != "active":
            continue
        remaining = float(d["daily_budget_nzd"]) - float(d.get("spent_today", 0))
        if remaining < float(d.get("cpc_nzd", 0)):
            continue
        # Hydrate product
        prod = await db.products.find_one(
            {
                "id": d["product_id"],
                "in_stock": True,
                "stock_count": {"$gt": 0},
            },
            {
                "_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1,
                "rating": 1, "reviews_count": 1, "category": 1, "subcategory": 1,
                "seller_name": 1,
            },
        )
        if not prod:
            continue
        # Category scope on category placement
        if category and prod.get("category") != category:
            continue
        candidates.append({"campaign": d, "product": prod, "weight": remaining})

    # Budget-weighted random sample without replacement
    out: list[dict] = []
    pool = candidates[:]
    rng = random.Random()
    while pool and len(out) < limit:
        weights = [c["weight"] for c in pool]
        pick = rng.choices(range(len(pool)), weights=weights, k=1)[0]
        chosen = pool.pop(pick)
        out.append(
            {
                "campaign_id": chosen["campaign"]["id"],
                "product": chosen["product"],
                "placement": placement,
            }
        )

    return {"placement": placement, "count": len(out), "items": out}


@router.post("/sponsored/track/impression")
async def track_impression(
    body: TrackEvent,
    current=Depends(get_current_user_optional),
):
    """Beacon-style — increments impressions. No billing impact."""
    res = await db.sponsored_campaigns.update_one(
        {"id": body.campaign_id, "product_id": body.product_id},
        {"$inc": {"impressions": 1}, "$set": {"updated_at": now_utc()}},
    )
    if not res.matched_count:
        # Don't 404 — beacons should be best-effort.
        return {"ok": False}
    return {"ok": True}


@router.post("/sponsored/track/click")
async def track_click(
    body: TrackEvent,
    current=Depends(get_current_user_optional),
):
    """Increments clicks AND deducts CPC from daily/total budget."""
    d = await db.sponsored_campaigns.find_one(
        {"id": body.campaign_id, "product_id": body.product_id}, {"_id": 0}
    )
    if not d:
        return {"ok": False}
    d = await _reset_daily_if_needed(d)
    if d.get("status") != "active":
        # Still record click so we can analyse hover-after-pause behaviour,
        # but don't charge.
        await db.sponsored_campaigns.update_one(
            {"id": d["id"]}, {"$inc": {"clicks": 1}}
        )
        return {"ok": True, "billed": False, "reason": d.get("status")}

    cpc = float(d.get("cpc_nzd", 0))
    daily_budget = float(d.get("daily_budget_nzd", 0))
    spent_today = float(d.get("spent_today", 0)) + cpc
    spent_total = float(d.get("spent_total", 0)) + cpc

    set_doc: dict = {
        "spent_today": round(spent_today, 4),
        "spent_total": round(spent_total, 4),
        "updated_at": now_utc(),
    }
    if spent_today >= daily_budget:
        set_doc["status"] = "out_of_budget"

    await db.sponsored_campaigns.update_one(
        {"id": d["id"]},
        {"$inc": {"clicks": 1}, "$set": set_doc},
    )
    return {
        "ok": True,
        "billed": True,
        "cpc": cpc,
        "spent_today": set_doc["spent_today"],
        "spent_total": set_doc["spent_total"],
        "status": set_doc.get("status", "active"),
    }
