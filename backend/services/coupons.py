"""Coupon validation & discount calculation.

Pure(-ish) logic separated from FastAPI so we can call it from both the
cart endpoints (preview discount before checkout) and the checkout
finalization step (record usage on payment success).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from db import db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(d):
    if d is None:
        return None
    if isinstance(d, datetime) and d.tzinfo is None:
        return d.replace(tzinfo=timezone.utc)
    return d


def _eligible_items(coupon: dict, items: list[dict]) -> list[dict]:
    """Return the subset of cart `items` that this coupon applies to."""
    scope = coupon.get("scope") or "all"
    sval = coupon.get("scope_value") or []
    if scope == "all" or not sval:
        return list(items)
    if scope == "category":
        cats = {s.strip().lower() for s in sval}
        return [it for it in items if (it.get("category") or "").lower() in cats]
    if scope == "seller":
        ids = set(sval)
        return [it for it in items if it.get("seller_id") in ids]
    if scope == "products":
        ids = set(sval)
        return [it for it in items if it.get("product_id") in ids]
    return list(items)


async def find_coupon(code: str) -> Optional[dict]:
    code = (code or "").strip().upper()
    if not code:
        return None
    return await db.coupons.find_one({"code": code}, {"_id": 0})


async def is_ambassador_b2b_code(code: str) -> bool:
    """True if ``code`` matches an ambassador's seller-recruit (B2B) code.

    Used by checkout to give a clear error instead of "coupon not found"
    when a buyer accidentally pastes a B2B recruit code where a customer
    discount code (B2C) is expected.
    """
    code = (code or "").strip().upper()
    if not code:
        return False
    hit = await db.users.find_one(
        {"ambassador_profile.code_b2b": code},
        {"_id": 0, "id": 1},
    )
    return hit is not None


async def validate_for_cart(
    code: str,
    items: list[dict],
    subtotal_nzd: float,
    user: dict | None,
) -> tuple[Optional[dict], dict]:
    """Validate a coupon against the current cart.

    Returns: (coupon_doc | None, result_dict)
    `result_dict` shape::
        {
          ok: bool, code: str, discount_nzd: float, free_shipping: bool,
          label: str, error: str | None
        }
    """
    result = {
        "ok": False,
        "code": (code or "").upper(),
        "discount_nzd": 0.0,
        "free_shipping": False,
        "label": "",
        "error": None,
    }
    coupon = await find_coupon(code)
    if not coupon:
        result["error"] = "Invalid coupon code"
        return None, result

    if not coupon.get("active", True):
        result["error"] = "This coupon is no longer active"
        return coupon, result

    now = _now()
    vf = _aware(coupon.get("valid_from"))
    vt = _aware(coupon.get("valid_to"))
    if vf and now < vf:
        result["error"] = "This coupon isn't active yet"
        return coupon, result
    if vt and now > vt:
        result["error"] = "This coupon has expired"
        return coupon, result

    limit = coupon.get("usage_limit_total")
    if isinstance(limit, int) and limit > 0 and (coupon.get("used_count", 0) >= limit):
        result["error"] = "This coupon has been fully redeemed"
        return coupon, result

    countries = coupon.get("countries") or []
    if countries and user and (user.get("country") or "").upper() not in {c.upper() for c in countries}:
        result["error"] = "This coupon isn't available in your region"
        return coupon, result

    min_order = float(coupon.get("min_order_nzd") or 0.0)
    if min_order > 0 and subtotal_nzd < min_order:
        gap = min_order - subtotal_nzd
        result["error"] = f"Spend ${gap:.2f} more (NZD) to unlock this coupon"
        return coupon, result

    if user:
        per_user = int(coupon.get("per_user_limit") or 1)
        used_by_user = await db.coupon_usage.count_documents(
            {"coupon_id": coupon["id"], "user_id": user["id"]}
        )
        if used_by_user >= per_user:
            result["error"] = "You've already used this coupon"
            return coupon, result

        # First-order-only coupons (welcome / activation lever) require the
        # buyer to have NO previously-paid orders. We treat any "paid",
        # "shipped", "out_for_delivery", "delivered", "refunded" or
        # "cancelled" order as "they've already bought once" so a buyer
        # can't game it by cancelling their first order.
        if coupon.get("first_order_only"):
            existing_paid_orders = await db.orders.count_documents(
                {
                    "user_id": user["id"],
                    "payment_status": {"$in": ["paid", "refunded", "refund_pending"]},
                }
            )
            if existing_paid_orders > 0:
                result["error"] = "This welcome offer is only for your first order"
                return coupon, result

    # Eligible items
    eligible = _eligible_items(coupon, items)
    if not eligible:
        scope = coupon.get("scope")
        if scope == "category":
            result["error"] = "This coupon doesn't apply to items in your cart"
        elif scope == "seller":
            result["error"] = "This coupon only applies to specific sellers"
        elif scope == "products":
            result["error"] = "This coupon only applies to specific products"
        else:
            result["error"] = "Coupon not applicable to your cart"
        return coupon, result

    eligible_subtotal = sum(
        float(it.get("price_nzd", 0)) * int(it.get("quantity", 1)) for it in eligible
    )

    ctype = (coupon.get("type") or "").lower()
    discount = 0.0
    free_shipping = False
    if ctype == "percent":
        pct = float(coupon.get("value") or 0)
        discount = eligible_subtotal * (pct / 100.0)
        cap = coupon.get("max_discount_nzd")
        if cap is not None:
            discount = min(discount, float(cap))
        label = f"{int(pct) if pct.is_integer() else pct}% off"
    elif ctype == "fixed":
        discount = min(float(coupon.get("value") or 0), eligible_subtotal)
        label = f"${discount:.0f} off"
    elif ctype == "free_shipping":
        free_shipping = True
        label = "Free shipping"
    else:
        result["error"] = "Unsupported coupon type"
        return coupon, result

    discount = max(0.0, round(discount, 2))

    result["ok"] = True
    result["discount_nzd"] = discount
    result["free_shipping"] = free_shipping
    result["label"] = label
    return coupon, result


async def record_coupon_redemption(
    *, coupon_id: str, user_id: str, order_id: str, discount_nzd: float
) -> None:
    """Idempotent (best-effort) usage record + counter bump."""
    existing = await db.coupon_usage.find_one(
        {"coupon_id": coupon_id, "order_id": order_id}, {"_id": 1}
    )
    if existing:
        return
    await db.coupon_usage.insert_one(
        {
            "coupon_id": coupon_id,
            "user_id": user_id,
            "order_id": order_id,
            "discount_nzd": float(discount_nzd),
            "redeemed_at": _now(),
        }
    )
    await db.coupons.update_one(
        {"id": coupon_id}, {"$inc": {"used_count": 1}}
    )
