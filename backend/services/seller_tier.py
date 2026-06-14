"""Seller reputation tiers + payout policy.

Tiers determine **when** a seller is paid after delivery and **how much**
is held back as a reserve against returns / disputes.

   Starter   →  T+10 after delivery, 10% reserve held 30 days
   Verified  →  T+5  after delivery,  5% reserve held 14 days
   Trusted   →  T+2  after delivery,  no reserve
   Top       →  T+1  after delivery,  no reserve

Tier is derived from the seller's lifetime metrics:
   - delivered_orders        (count of paid+delivered orders)
   - return_rate             (returned / delivered)
   - avg_rating              (mean of product reviews on this seller)
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

from db import db


# ---------------------------------------------------------------------------
# Tier table (ordered: best first → first match wins)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TierPolicy:
    name: str
    label: str
    payout_hold_days: int
    reserve_pct: float
    reserve_hold_days: int
    min_orders: int
    max_return_rate: float
    min_rating: float
    color: str
    perks: list


TIERS: list[TierPolicy] = [
    TierPolicy(
        name="top",
        label="Top seller",
        payout_hold_days=1,
        reserve_pct=0.0,
        reserve_hold_days=0,
        min_orders=200,
        max_return_rate=0.01,
        min_rating=4.7,
        color="#9333EA",
        perks=["T+1 payout", "No reserve held", "Priority support", "Featured placement"],
    ),
    TierPolicy(
        name="trusted",
        label="Trusted",
        payout_hold_days=2,
        reserve_pct=0.0,
        reserve_hold_days=0,
        min_orders=50,
        max_return_rate=0.02,
        min_rating=4.5,
        color="#10B981",
        perks=["T+2 payout", "No reserve held", "Verified badge"],
    ),
    TierPolicy(
        name="verified",
        label="Verified",
        payout_hold_days=5,
        reserve_pct=0.05,
        reserve_hold_days=14,
        min_orders=10,
        max_return_rate=0.05,
        min_rating=4.0,
        color="#0EA5E9",
        perks=["T+5 payout", "5% reserve · 14-day hold"],
    ),
    TierPolicy(
        name="starter",
        label="Starter",
        payout_hold_days=10,
        reserve_pct=0.10,
        reserve_hold_days=30,
        min_orders=0,
        max_return_rate=1.0,
        min_rating=0.0,
        color="#F59E0B",
        perks=["T+10 payout", "10% reserve · 30-day hold", "Build your reputation"],
    ),
]


def tier_by_name(name: str) -> TierPolicy:
    for t in TIERS:
        if t.name == name:
            return t
    return TIERS[-1]  # default starter


async def compute_seller_metrics(seller_id: str) -> dict:
    """Recompute tier-relevant metrics for a seller from DB."""
    delivered_orders = 0
    cancelled_or_returned = 0
    rating_sum = 0.0
    rating_n = 0

    # Orders touching this seller — count distinct order ids
    seen_order_ids: set[str] = set()
    async for order in db.orders.find(
        {"items.seller_id": seller_id},
        {"id": 1, "status": 1, "_id": 0},
    ):
        oid = order.get("id")
        if not oid or oid in seen_order_ids:
            continue
        seen_order_ids.add(oid)
        status = order.get("status")
        if status == "delivered":
            delivered_orders += 1
        elif status in {"refunded", "cancelled", "rto_delivered"}:
            cancelled_or_returned += 1

    # Product ratings — average from reviews collection
    async for rv in db.reviews.find(
        {"seller_id": seller_id, "rating": {"$gte": 1}},
        {"rating": 1, "_id": 0},
    ):
        rating_sum += float(rv.get("rating") or 0)
        rating_n += 1

    total = delivered_orders + cancelled_or_returned
    return_rate = (cancelled_or_returned / total) if total > 0 else 0.0
    avg_rating = (rating_sum / rating_n) if rating_n else 0.0
    return {
        "delivered_orders": delivered_orders,
        "returned_orders": cancelled_or_returned,
        "return_rate": round(return_rate, 4),
        "avg_rating": round(avg_rating, 2),
        "review_count": rating_n,
    }


def pick_tier(metrics: dict) -> TierPolicy:
    """Pick the best tier the seller qualifies for (highest first)."""
    orders = int(metrics.get("delivered_orders") or 0)
    rr = float(metrics.get("return_rate") or 0.0)
    rating = float(metrics.get("avg_rating") or 0.0)
    for t in TIERS:
        if (
            orders >= t.min_orders
            and rr <= t.max_return_rate
            and (rating >= t.min_rating or metrics.get("review_count", 0) < 5)
        ):
            # If seller has <5 reviews, ignore rating gate so new sellers
            # aren't blocked from progressing.
            if t.min_rating > 0 and metrics.get("review_count", 0) < 5 and orders < t.min_orders:
                continue
            return t
    return TIERS[-1]


def next_tier(current: TierPolicy) -> Optional[TierPolicy]:
    """Returns the next tier above the current one (or None if at the top)."""
    idx = [i for i, t in enumerate(TIERS) if t.name == current.name]
    if not idx:
        return None
    i = idx[0]
    if i == 0:
        return None  # already top
    return TIERS[i - 1]


def progress_to_next(metrics: dict, current: TierPolicy) -> dict:
    """Return missing requirements & progress % to next tier."""
    nxt = next_tier(current)
    if not nxt:
        return {
            "next_tier": None,
            "orders_needed": 0,
            "return_rate_ok": True,
            "rating_ok": True,
            "progress_pct": 100,
        }
    orders = int(metrics.get("delivered_orders") or 0)
    rr = float(metrics.get("return_rate") or 0.0)
    rating = float(metrics.get("avg_rating") or 0.0)
    review_n = int(metrics.get("review_count") or 0)

    orders_needed = max(0, nxt.min_orders - orders)
    return_rate_ok = rr <= nxt.max_return_rate
    rating_ok = review_n < 5 or rating >= nxt.min_rating
    progress = (
        min(1.0, orders / nxt.min_orders) if nxt.min_orders else 1.0
    )
    return {
        "next_tier": nxt.name,
        "next_tier_label": nxt.label,
        "orders_needed": orders_needed,
        "return_rate_ok": return_rate_ok,
        "rating_ok": rating_ok,
        "progress_pct": int(round(progress * 100)),
    }


async def get_seller_tier_snapshot(seller_id: str) -> dict:
    """Bundle: current tier + metrics + progress to next."""
    metrics = await compute_seller_metrics(seller_id)
    current = pick_tier(metrics)
    progress = progress_to_next(metrics, current)
    return {
        "tier": asdict(current),
        "metrics": metrics,
        "progress": progress,
    }
