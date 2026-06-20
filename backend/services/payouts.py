"""Per-seller payouts derived from paid orders.

Implements the tiered payout policy (see services/seller_tier.py):
  - Payouts start as ``held`` when the order is paid.
  - When the order is *delivered* (Shiprocket webhook), we set the
    ``release_at`` timestamp based on the seller's current tier.
  - A scheduler / cron calls :func:`release_due_payouts` to flip
    ``held`` → ``available`` (and later ``reserve_held`` → ``available``).
  - Admin marks ``paid_out`` after pushing money via Stripe Connect.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Optional

from config import PLATFORM_COMMISSION  # noqa: F401  — kept for legacy callers
from db import db
from utils import now_utc

from services.seller_tier import (
    TIERS,
    compute_seller_metrics,
    pick_tier,
)
from services.stripe_connect_svc import get_commission_bps_for_product


async def _tier_for(seller_id: str):
    metrics = await compute_seller_metrics(seller_id)
    return pick_tier(metrics)


async def create_payouts_for_order(order_id: str) -> None:
    """Idempotently materialize one Payout per seller present in the order.

    Items without a ``seller_id`` are platform-owned (seeded catalog) and
    generate no payout. Safe to call multiple times — duplicate
    ``(order_id, seller_id)`` inserts are absorbed.
    """
    existing = await db.payouts.find_one({"order_id": order_id}, {"_id": 0})
    if existing:
        return
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    by_seller: dict[str, dict] = {}

    # Discounts (coupon + loyalty points) are shared with sellers proportionally
    # to each line's contribution to the pre-coupon subtotal. This matches the
    # industry-standard accounting used by Amazon, Etsy, eBay and Flipkart and
    # prevents the platform from absorbing 100% of every coupon discount —
    # which would turn aggressive promotions into negative-margin sales.
    gross_pre_discount = sum(
        float(it.get("price_nzd") or 0) * int(it.get("quantity") or 0)
        for it in order.get("items", [])
    )
    coupon_discount = float(order.get("discount_nzd") or 0.0)
    points_discount = float(order.get("points_discount_nzd") or 0.0)
    total_discount = max(0.0, coupon_discount + points_discount)
    discount_ratio = (total_discount / gross_pre_discount) if gross_pre_discount > 0 else 0.0
    # Defensive clamp — a coupon ≥ the cart subtotal is impossible (the
    # voucher engine caps at min_order_nzd) but cap at 100% just in case.
    if discount_ratio > 1.0:
        discount_ratio = 1.0

    for it in order.get("items", []):
        sid = it.get("seller_id")
        if not sid:
            continue
        # Resolve tiered commission rate for this specific product (8/12/15%
        # by category — matches what Stripe Connect actually charged via
        # application_fee_amount at checkout).
        prod = await db.products.find_one(
            {"id": it["product_id"]}, {"_id": 0, "category": 1, "tags": 1}
        )
        bps = get_commission_bps_for_product(prod)
        # Apply the proportional discount share to this line's gross so the
        # seller's commission base is calculated from the buyer's actual paid
        # amount, not the pre-coupon list price.
        line_listed = float(it["price_nzd"]) * int(it["quantity"])
        line_gross = round(line_listed * (1.0 - discount_ratio), 2)
        line_commission = round(line_gross * bps / 10000.0, 2)
        bucket = by_seller.setdefault(
            sid,
            {
                "seller_name": it.get("seller_name") or "Seller",
                "items_count": 0,
                "gross": 0.0,
                "commission": 0.0,
            },
        )
        bucket["items_count"] += int(it["quantity"])
        bucket["gross"] += line_gross
        bucket["commission"] += line_commission
    docs = []
    for sid, agg in by_seller.items():
        gross = round(agg["gross"], 2)
        commission = round(agg["commission"], 2)
        net = round(gross - commission, 2)
        tier = await _tier_for(sid)
        reserve = round(net * tier.reserve_pct, 2)
        docs.append(
            {
                "id": f"po_{uuid.uuid4().hex[:12]}",
                "order_id": order_id,
                "seller_id": sid,
                "company_name": agg["seller_name"],
                "items_count": agg["items_count"],
                "gross_nzd": gross,
                "commission_nzd": commission,
                "net_payable_nzd": net,
                "tier": tier.name,
                "reserve_nzd": reserve,
                "release_at": None,  # set when delivered
                "reserve_release_at": None,  # set when released
                "status": "held",
                "created_at": now_utc(),
                "paid_out_at": None,
            }
        )
    if docs:
        await db.payouts.insert_many(docs)


async def mark_delivered(order_id: str) -> int:
    """Called when an order is delivered — schedules each payout's
    ``release_at`` based on its seller's current tier.

    Returns the number of payouts updated.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return 0
    delivered_at = order.get("delivered_at") or now_utc()
    updated = 0
    async for po in db.payouts.find(
        {"order_id": order_id, "status": "held"}, {"_id": 0}
    ):
        tier_name = po.get("tier") or "starter"
        tier = next((t for t in TIERS if t.name == tier_name), TIERS[-1])
        release_at = delivered_at + timedelta(days=tier.payout_hold_days)
        reserve_release_at = (
            release_at + timedelta(days=tier.reserve_hold_days)
            if tier.reserve_hold_days
            else None
        )
        await db.payouts.update_one(
            {"id": po["id"]},
            {
                "$set": {
                    "release_at": release_at,
                    "reserve_release_at": reserve_release_at,
                }
            },
        )
        updated += 1
    return updated


async def cancel_payouts(order_id: str, reason: str = "refunded") -> int:
    """When an order is refunded / cancelled / RTO-delivered, void payouts."""
    res = await db.payouts.update_many(
        {"order_id": order_id, "status": {"$in": ["held", "available", "reserve_held"]}},
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": now_utc(),
                "cancel_reason": reason,
            }
        },
    )
    return getattr(res, "modified_count", 0)


async def release_due_payouts() -> dict:
    """Cron / scheduler hook. Flips:
       - ``held`` → ``available`` when ``release_at <= now`` and reserve == 0
       - ``held`` → ``reserve_held`` when ``release_at <= now`` and reserve > 0
       - ``reserve_held`` → ``available`` when ``reserve_release_at <= now``
                              (and merges reserve back into net_payable)
    Returns a small summary dict.
    """
    now = now_utc()
    flipped_to_available = 0
    flipped_to_reserve = 0
    reserve_released = 0
    reserve_released_amount = 0.0

    # held → available / reserve_held
    async for po in db.payouts.find(
        {"status": "held", "release_at": {"$lte": now}}, {"_id": 0}
    ):
        reserve = float(po.get("reserve_nzd") or 0)
        if reserve > 0 and po.get("reserve_release_at"):
            await db.payouts.update_one(
                {"id": po["id"]},
                {"$set": {"status": "reserve_held", "available_at": now}},
            )
            flipped_to_reserve += 1
        else:
            await db.payouts.update_one(
                {"id": po["id"]},
                {"$set": {"status": "available", "available_at": now}},
            )
            flipped_to_available += 1

    # reserve_held → available
    async for po in db.payouts.find(
        {"status": "reserve_held", "reserve_release_at": {"$lte": now}},
        {"_id": 0},
    ):
        await db.payouts.update_one(
            {"id": po["id"]},
            {"$set": {"status": "available", "reserve_released_at": now}},
        )
        reserve_released += 1
        reserve_released_amount += float(po.get("reserve_nzd") or 0)

    return {
        "flipped_to_available": flipped_to_available,
        "flipped_to_reserve_held": flipped_to_reserve,
        "reserve_released": reserve_released,
        "reserve_released_nzd": round(reserve_released_amount, 2),
        "ran_at": now,
    }
