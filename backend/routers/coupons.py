"""Public + seller coupon management."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import (
    Coupon,
    CouponApplyResult,
    CouponCreate,
    CouponPublic,
    CouponUpdate,
    CouponValidateRequest,
)
from services.cart import hydrate_cart
from services.coupons import find_coupon, validate_for_cart
from services.welcome_coupon import get_welcome_coupon_for_user
from utils import now_utc

router = APIRouter(tags=["coupons"])

VALID_TYPES = {"percent", "fixed", "free_shipping"}
VALID_SCOPES = {"all", "category", "seller", "products"}


def _norm_code(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


def _from_doc(doc: dict, model_cls):
    """Build a Pydantic model from a Mongo doc, dropping None values so
    field defaults (e.g. ``first_order_only: bool = False``) kick in
    instead of failing validation when older docs miss the field.
    """
    payload = {
        k: doc.get(k) for k in model_cls.model_fields.keys() if doc.get(k) is not None
    }
    return model_cls(**payload)


def _coupon_public(doc: dict) -> Coupon:
    return _from_doc(doc, Coupon)


# ---------------------------------------------------------------------------
# Public — buyer-facing
# ---------------------------------------------------------------------------
@router.post("/coupons/validate", response_model=CouponApplyResult)
async def validate_coupon(
    body: CouponValidateRequest, current=Depends(get_current_user)
):
    cart = await hydrate_cart(current["id"])
    if not cart.items:
        return CouponApplyResult(
            ok=False,
            code=_norm_code(body.code),
            error="Your cart is empty",
        )
    coupon, result = await validate_for_cart(
        body.code, cart.items, cart.subtotal_nzd, current
    )
    payload = CouponApplyResult(**result)
    if coupon and result.get("ok"):
        payload.coupon = _coupon_public(coupon)
    return payload


@router.get("/coupons/active", response_model=List[CouponPublic])
async def list_active_coupons(current=Depends(get_current_user)):
    """Public coupons (scope=all + sitewide sellers/categories) that the
    buyer can browse and tap to apply. We exclude expired/inactive ones
    AND personal ambassador-issued codes (those are 1:1 referrals, not
    public sitewide promos — they're surfaced via the ambassador share
    sheet instead).
    """
    now = datetime.now(timezone.utc)
    docs = []
    async for c in db.coupons.find(
        {
            "active": True,
            "$or": [{"valid_to": None}, {"valid_to": {"$gt": now}}],
        },
        {"_id": 0},
    ).sort("created_at", -1):
        # Skip personal / ambassador-issued codes — they have either no
        # description (auto-generated) or a non-public owner attribution.
        if not c.get("description"):
            continue
        if c.get("id", "").startswith("cpn_amb_") or c.get("ambassador_id"):
            continue
        # Region filter
        countries = c.get("countries") or []
        if countries:
            cc = (current.get("country") or "").upper()
            if cc not in {x.upper() for x in countries}:
                continue
        # Hide fully redeemed
        limit = c.get("usage_limit_total")
        if isinstance(limit, int) and limit > 0 and c.get("used_count", 0) >= limit:
            continue
        docs.append(c)
    return [_from_doc(d, CouponPublic) for d in docs]


@router.get("/coupons/welcome", response_model=Optional[CouponPublic])
async def get_my_welcome_coupon(current=Depends(get_current_user)):
    """Return the active first-order welcome coupon for the current user,
    or null if they're not eligible (already placed a paid order, or
    already redeemed). Used by the home-tab Welcome banner."""
    coupon = await get_welcome_coupon_for_user(current)
    if not coupon:
        return None
    # Don't surface to ineligible regions either.
    countries = coupon.get("countries") or []
    if countries:
        cc = (current.get("country") or "").upper()
        if cc not in {c.upper() for c in countries}:
            return None
    return _from_doc(coupon, CouponPublic)


# ---------------------------------------------------------------------------
# Seller — manage own coupons
# ---------------------------------------------------------------------------
async def _require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


@router.post("/seller/coupons", response_model=Coupon, status_code=201)
async def create_seller_coupon(
    body: CouponCreate, current=Depends(_require_verified_seller)
):
    code = _norm_code(body.code)
    if not code or len(code) < 3:
        raise HTTPException(status_code=400, detail="Code too short")
    if body.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {sorted(VALID_TYPES)}")
    if body.scope not in VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"scope must be one of {sorted(VALID_SCOPES)}")
    if body.type == "percent" and not (0 < body.value <= 90):
        raise HTTPException(status_code=400, detail="percent must be 1-90")
    if body.type == "fixed" and body.value <= 0:
        raise HTTPException(status_code=400, detail="fixed amount must be > 0")

    existing = await db.coupons.find_one({"code": code}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="That code already exists, please pick another")

    # Force seller scope to themselves — they cannot create site-wide coupons
    # nor coupons for other sellers.
    scope = body.scope
    scope_value = list(body.scope_value or [])
    if scope == "all":
        scope = "seller"
        scope_value = [current["id"]]
    elif scope == "seller":
        scope_value = [current["id"]]
    elif scope == "products":
        # Only allow products owned by this seller
        own = []
        async for p in db.products.find(
            {"id": {"$in": scope_value}, "seller_id": current["id"]},
            {"_id": 0, "id": 1},
        ):
            own.append(p["id"])
        if not own:
            raise HTTPException(
                status_code=400,
                detail="None of those products belong to you.",
            )
        scope_value = own

    seller_profile = await db.sellers.find_one(
        {"user_id": current["id"]}, {"_id": 0, "company_name": 1}
    )

    doc = {
        "id": f"cpn_{uuid.uuid4().hex[:12]}",
        "code": code,
        "description": body.description.strip(),
        "type": body.type,
        "value": float(body.value),
        "min_order_nzd": float(body.min_order_nzd or 0),
        "max_discount_nzd": float(body.max_discount_nzd) if body.max_discount_nzd else None,
        "valid_from": body.valid_from,
        "valid_to": body.valid_to,
        "usage_limit_total": body.usage_limit_total,
        "used_count": 0,
        "per_user_limit": int(body.per_user_limit or 1),
        "scope": scope,
        "scope_value": scope_value,
        "countries": [c.upper() for c in (body.countries or [])],
        "owner_id": current["id"],
        "owner_name": (seller_profile or {}).get("company_name")
        or current.get("full_name"),
        "active": bool(body.active),
        "created_at": now_utc(),
    }
    await db.coupons.insert_one(doc)
    return _coupon_public(doc)


@router.get("/seller/coupons", response_model=List[Coupon])
async def list_seller_coupons(current=Depends(_require_verified_seller)):
    out = []
    async for c in db.coupons.find({"owner_id": current["id"]}, {"_id": 0}).sort(
        "created_at", -1
    ):
        out.append(_coupon_public(c))
    return out


@router.patch("/seller/coupons/{coupon_id}", response_model=Coupon)
async def update_seller_coupon(
    coupon_id: str,
    body: CouponUpdate,
    current=Depends(_require_verified_seller),
):
    doc = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Coupon not found")
    if doc.get("owner_id") != current["id"]:
        raise HTTPException(status_code=403, detail="Not your coupon")

    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if patch:
        await db.coupons.update_one({"id": coupon_id}, {"$set": patch})
    fresh = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    return _coupon_public(fresh)


@router.delete("/seller/coupons/{coupon_id}", status_code=204)
async def delete_seller_coupon(
    coupon_id: str, current=Depends(_require_verified_seller)
):
    doc = await db.coupons.find_one(
        {"id": coupon_id}, {"_id": 0, "owner_id": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Coupon not found")
    if doc.get("owner_id") != current["id"]:
        raise HTTPException(status_code=403, detail="Not your coupon")
    await db.coupons.delete_one({"id": coupon_id})
    return None
