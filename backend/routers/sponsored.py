"""Sponsored placements — seller-paid product boosts ("Sponsored" slots).

MVP model (prepaid wallet via Stripe Checkout):
  - Sellers create a ``SponsoredCampaign`` for one of their products.
  - Each campaign has a CPC (cost-per-click in NZD) and a ``daily_budget_nzd``.
  - Sellers fund a ``seller_wallets`` row via Stripe Checkout (one-time
    topup). Balance must cover CPC for ads to serve.
  - The public ``/sponsored/slots`` endpoint returns active, in-budget
    AND in-wallet campaigns weighted by remaining-daily-budget.
  - Clicks are tracked through ``/sponsored/track/click``. Each click
    deducts ``cpc_nzd`` from BOTH ``spent_today`` (daily cap) AND the
    seller's wallet balance. When ``spent_today >= daily_budget`` the
    campaign auto-pauses for the day; when wallet balance drops below
    CPC the campaign also stops serving until topped up.
"""
from __future__ import annotations

import logging
import os
import random
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user, get_current_user_optional
from utils import now_utc

logger = logging.getLogger("allsale.sponsored")
router = APIRouter(tags=["sponsored"])
webhook_router = APIRouter(tags=["sponsored"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY") or ""
WEBHOOK_SECRET = (
    os.getenv("SPONSORED_WEBHOOK_SECRET") or os.getenv("STRIPE_WEBHOOK_SECRET") or ""
)
BASE_URL = (
    os.getenv("PUBLIC_SITE_URL") or "https://shop.allsale.co.nz"
).rstrip("/")

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
# Wallet helpers
# ---------------------------------------------------------------------------
async def _get_or_create_wallet(seller_id: str) -> dict:
    w = await db.seller_wallets.find_one({"seller_id": seller_id}, {"_id": 0})
    if w:
        return w
    w = {
        "seller_id": seller_id,
        "balance_nzd": 0.0,
        "lifetime_topup_nzd": 0.0,
        "lifetime_spent_nzd": 0.0,
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    await db.seller_wallets.insert_one(w)
    return w


async def _credit_wallet(seller_id: str, amount_nzd: float, *, source: str, ref: str) -> dict:
    """Idempotent credit: only applies if ``ref`` (e.g. stripe session id)
    hasn't been processed before. Returns the latest wallet."""
    existing = await db.seller_wallet_events.find_one({"ref": ref}, {"_id": 0})
    if existing:
        return await _get_or_create_wallet(seller_id)
    await _get_or_create_wallet(seller_id)
    await db.seller_wallets.update_one(
        {"seller_id": seller_id},
        {
            "$inc": {"balance_nzd": amount_nzd, "lifetime_topup_nzd": amount_nzd},
            "$set": {"updated_at": now_utc()},
        },
    )
    await db.seller_wallet_events.insert_one(
        {
            "id": f"wev_{uuid.uuid4().hex[:12]}",
            "seller_id": seller_id,
            "type": "topup",
            "source": source,
            "ref": ref,
            "amount_nzd": amount_nzd,
            "created_at": now_utc(),
        }
    )
    return await _get_or_create_wallet(seller_id)


async def _debit_wallet(seller_id: str, amount_nzd: float, *, ref: str) -> bool:
    """Atomic debit — returns True if balance was sufficient and got
    debited, False if insufficient. ``ref`` is for audit (campaign id)."""
    res = await db.seller_wallets.update_one(
        {"seller_id": seller_id, "balance_nzd": {"$gte": amount_nzd}},
        {
            "$inc": {"balance_nzd": -amount_nzd, "lifetime_spent_nzd": amount_nzd},
            "$set": {"updated_at": now_utc()},
        },
    )
    if res.modified_count:
        await db.seller_wallet_events.insert_one(
            {
                "id": f"wev_{uuid.uuid4().hex[:12]}",
                "seller_id": seller_id,
                "type": "click_charge",
                "ref": ref,
                "amount_nzd": amount_nzd,
                "created_at": now_utc(),
            }
        )
        return True
    return False


async def _ensure_stripe_customer(user: dict) -> str:
    """Idempotent — returns the seller's Stripe customer id."""
    cust_id = user.get("stripe_customer_id")
    if cust_id:
        return cust_id
    cust = stripe.Customer.create(
        email=user.get("email"),
        name=user.get("full_name"),
        metadata={"user_id": str(user["id"]), "platform": "allsale"},
    )
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"stripe_customer_id": cust["id"]}}
    )
    return cust["id"]


# ---------------------------------------------------------------------------
# Seller — Wallet
# ---------------------------------------------------------------------------
@router.get("/seller/sponsored/wallet")
async def get_wallet(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    w = await _get_or_create_wallet(current["id"])
    return {
        "balance_nzd": round(float(w.get("balance_nzd", 0)), 2),
        "lifetime_topup_nzd": round(float(w.get("lifetime_topup_nzd", 0)), 2),
        "lifetime_spent_nzd": round(float(w.get("lifetime_spent_nzd", 0)), 2),
    }


class TopupBody(BaseModel):
    amount_nzd: float = Field(..., ge=5.0, le=2000.0)


@router.post("/seller/sponsored/wallet/topup")
async def topup_wallet(
    body: TopupBody,
    current=Depends(get_current_user),
):
    """Returns a Stripe Checkout URL the seller can open to fund the wallet."""
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    await _get_or_create_wallet(current["id"])
    cust_id = await _ensure_stripe_customer(current)
    amount_cents = int(round(body.amount_nzd * 100))

    try:
        session = stripe.checkout.Session.create(
            customer=cust_id,
            mode="payment",
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "nzd",
                        "unit_amount": amount_cents,
                        "product_data": {
                            "name": "Allsale Sponsored Wallet topup",
                            "description": f"${body.amount_nzd:.2f} NZD ad credit for sponsored placements",
                        },
                    },
                }
            ],
            success_url=f"{BASE_URL}/seller/sponsored?topup=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{BASE_URL}/seller/sponsored?topup=cancelled",
            metadata={
                "user_id": str(current["id"]),
                "product": "sponsored_topup",
                "amount_nzd": str(body.amount_nzd),
            },
            payment_intent_data={
                "metadata": {
                    "user_id": str(current["id"]),
                    "product": "sponsored_topup",
                    "amount_nzd": str(body.amount_nzd),
                }
            },
        )
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")

    return {"url": session["url"], "session_id": session["id"]}


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

    q: dict = {
        "status": "active",
        "placements": placement,
    }
    # Wallet balance cache so we don't query for the same seller repeatedly.
    wallet_balance: dict[str, float] = {}
    candidates: list[dict] = []
    async for d in db.sponsored_campaigns.find(q, {"_id": 0}):
        d = await _reset_daily_if_needed(d)
        if d.get("status") != "active":
            continue
        remaining = float(d["daily_budget_nzd"]) - float(d.get("spent_today", 0))
        cpc = float(d.get("cpc_nzd", 0))
        if remaining < cpc:
            continue

        # Wallet gate — campaigns serve only when seller's prepaid balance
        # can cover at least one click.
        seller_id = d["seller_id"]
        if seller_id not in wallet_balance:
            w = await db.seller_wallets.find_one(
                {"seller_id": seller_id}, {"_id": 0, "balance_nzd": 1}
            )
            wallet_balance[seller_id] = float((w or {}).get("balance_nzd", 0))
        if wallet_balance[seller_id] < cpc:
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

    # Debit the prepaid wallet — fail-open: if wallet is empty we still
    # record the click but mark it un-billed and pause the campaign.
    billed = await _debit_wallet(
        d["seller_id"], cpc, ref=f"camp:{d['id']}"
    )
    if not billed:
        await db.sponsored_campaigns.update_one(
            {"id": d["id"]},
            {"$inc": {"clicks": 1}, "$set": {"status": "out_of_budget", "updated_at": now_utc()}},
        )
        return {"ok": True, "billed": False, "reason": "wallet_empty"}

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


# ---------------------------------------------------------------------------
# Stripe webhook — credit wallet on successful one-time topup
# ---------------------------------------------------------------------------
@webhook_router.post("/sponsored/webhooks/stripe")
async def sponsored_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
):
    payload = await request.body()
    if WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=stripe_signature or "",
                secret=WEBHOOK_SECRET,
            )
        except (ValueError, stripe.error.SignatureVerificationError):
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        import json as _json
        try:
            event = _json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payload")

    event_id = event.get("id")
    event_type = event.get("type")
    if event_id:
        seen = await db.stripe_events.find_one({"event_id": event_id}, {"_id": 0})
        if seen:
            return {"ok": True, "deduped": True}

    obj = (event.get("data") or {}).get("object") or {}
    metadata = obj.get("metadata") or {}
    if event_type == "checkout.session.completed" and metadata.get("product") == "sponsored_topup":
        seller_id = metadata.get("user_id")
        try:
            amount_nzd = float(metadata.get("amount_nzd") or 0)
        except (TypeError, ValueError):
            amount_nzd = float(obj.get("amount_total", 0)) / 100.0
        if seller_id and amount_nzd > 0:
            await _credit_wallet(
                seller_id,
                amount_nzd,
                source="stripe_checkout",
                ref=str(obj.get("id") or event_id),
            )
            logger.info(
                "Sponsored wallet credited: seller=%s amount=%s session=%s",
                seller_id, amount_nzd, obj.get("id"),
            )

    if event_id:
        await db.stripe_events.insert_one(
            {"event_id": event_id, "type": event_type, "received_at": now_utc()}
        )
    return {"ok": True}
