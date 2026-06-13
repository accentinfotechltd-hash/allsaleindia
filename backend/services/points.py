"""Loyalty points — append-only ledger with 12-month expiry.

Design:
- One row per credit or debit in `points_ledger`. Never mutate, only append.
- `balance(user) = SUM(non-expired credits) - SUM(debits)`.
- A credit's `expires_at` is set on insert (12 months out). When it expires,
  we insert a negative `expired` row equal to the unused portion (FIFO).
- Order earn rate: 1 pt per whole NZD spent on the order subtotal.
- Redemption: 100 pts = $1 NZD off, capped at 50% of subtotal per order.

The redeem flow mirrors coupons: buyer "applies" N points to their cart,
the discount is reflected in `CartView.points_discount_nzd`, and the
actual ledger debit happens on payment success (idempotent per order_id).
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from db import db


# ---- Tunables (match PRD defaults agreed with the user) -------------------
EARN_RATE_PER_NZD = 1            # 1 pt per $1 NZD
REDEEM_PTS_PER_NZD = 100         # 100 pts = $1 NZD
MAX_REDEEM_PCT = 0.50            # max 50% of subtotal can come from points
WELCOME_BONUS = 500
REVIEW_BONUS = 50
EXPIRY_MONTHS = 12


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expiry_for(now: datetime | None = None) -> datetime:
    base = now or _now()
    # ~12 months out (use 365 days for simplicity)
    return base + timedelta(days=30 * EXPIRY_MONTHS)


def points_to_nzd(points: int) -> float:
    return round(max(0, int(points)) / REDEEM_PTS_PER_NZD, 2)


def nzd_to_points(nzd: float) -> int:
    return int(max(0.0, float(nzd)) * REDEEM_PTS_PER_NZD)


# ---------------------------------------------------------------------------
# Balance + ledger helpers
# ---------------------------------------------------------------------------
async def current_balance(user_id: str) -> int:
    """Sum of all non-expired ledger entries for the user."""
    now = _now()
    pipeline = [
        {
            "$match": {
                "user_id": user_id,
                "$or": [
                    {"delta": {"$lt": 0}},
                    {"$and": [{"delta": {"$gt": 0}}, {"$or": [{"expires_at": None}, {"expires_at": {"$gt": now}}]}]},
                ],
            }
        },
        {"$group": {"_id": "$user_id", "total": {"$sum": "$delta"}}},
    ]
    rows = await db.points_ledger.aggregate(pipeline).to_list(length=1)
    return max(0, int(rows[0]["total"])) if rows else 0


async def expiring_in_days(user_id: str, days: int = 30) -> int:
    """Sum of credits expiring within `days` (not yet expired)."""
    now = _now()
    cutoff = now + timedelta(days=days)
    pipeline = [
        {
            "$match": {
                "user_id": user_id,
                "delta": {"$gt": 0},
                "expires_at": {"$gt": now, "$lte": cutoff},
            }
        },
        {"$group": {"_id": "$user_id", "total": {"$sum": "$delta"}}},
    ]
    rows = await db.points_ledger.aggregate(pipeline).to_list(length=1)
    return int(rows[0]["total"]) if rows else 0


async def _append_entry(
    *,
    user_id: str,
    delta: int,
    reason: str,
    title: str,
    ref_id: Optional[str] = None,
    ref_type: Optional[str] = None,
) -> dict:
    if delta == 0:
        return {}
    now = _now()
    doc = {
        "id": f"pt_{uuid.uuid4().hex[:14]}",
        "user_id": user_id,
        "delta": int(delta),
        "reason": reason,
        "title": title,
        "ref_id": ref_id,
        "ref_type": ref_type,
        "created_at": now,
        "expires_at": _expiry_for(now) if delta > 0 else None,
    }
    await db.points_ledger.insert_one(doc)
    return doc


# ---------------------------------------------------------------------------
# Awards (credits) — all idempotent on a (user, ref_id, reason) basis.
# ---------------------------------------------------------------------------
async def _award_idempotent(
    user_id: str,
    delta: int,
    reason: str,
    title: str,
    ref_id: Optional[str],
    ref_type: str,
) -> bool:
    if delta <= 0:
        return False
    if ref_id is not None:
        existing = await db.points_ledger.find_one(
            {"user_id": user_id, "reason": reason, "ref_id": ref_id},
            {"_id": 0, "id": 1},
        )
        if existing:
            return False
    await _append_entry(
        user_id=user_id, delta=delta, reason=reason, title=title,
        ref_id=ref_id, ref_type=ref_type,
    )
    return True


async def award_welcome_bonus(user_id: str) -> bool:
    """Award the one-time signup bonus. Idempotent per user."""
    return await _award_idempotent(
        user_id, WELCOME_BONUS, "signup_bonus",
        f"Welcome bonus · +{WELCOME_BONUS} pts",
        ref_id=user_id, ref_type="user",
    )


async def award_order_points(user_id: str, order_id: str, subtotal_nzd: float) -> int:
    """Earn 1 pt per whole NZD subtotal. Idempotent per order."""
    pts = int(math.floor(EARN_RATE_PER_NZD * max(0.0, float(subtotal_nzd))))
    if pts <= 0:
        return 0
    created = await _award_idempotent(
        user_id, pts, "order_earn",
        f"Earned on order · +{pts} pts",
        ref_id=order_id, ref_type="order",
    )
    return pts if created else 0


async def award_review_points(user_id: str, review_id: str) -> int:
    created = await _award_idempotent(
        user_id, REVIEW_BONUS, "review_earn",
        f"Review reward · +{REVIEW_BONUS} pts",
        ref_id=review_id, ref_type="review",
    )
    return REVIEW_BONUS if created else 0


# ---------------------------------------------------------------------------
# Redemption
# ---------------------------------------------------------------------------
def compute_redeem(
    *, requested: int, balance: int, subtotal_nzd: float
) -> dict:
    """Pure: return how many points are actually usable + the resulting discount."""
    requested = max(0, int(requested))
    if requested == 0 or balance <= 0 or subtotal_nzd <= 0:
        return {
            "requested_points": requested,
            "usable_points": 0,
            "discount_nzd": 0.0,
            "balance_after": balance,
            "capped_by": None,
        }
    capped_by: Optional[str] = None
    usable = requested
    if usable > balance:
        usable, capped_by = balance, "balance"
    # Max % of subtotal
    max_by_pct_nzd = subtotal_nzd * MAX_REDEEM_PCT
    max_by_pct_pts = int(math.floor(max_by_pct_nzd * REDEEM_PTS_PER_NZD))
    if usable > max_by_pct_pts:
        usable, capped_by = max_by_pct_pts, capped_by or "max_per_order"
    # Round down to nearest 100 (since 100 pts = $1)
    usable = (usable // REDEEM_PTS_PER_NZD) * REDEEM_PTS_PER_NZD
    discount = points_to_nzd(usable)
    if discount > subtotal_nzd:
        usable = nzd_to_points(subtotal_nzd)
        discount = points_to_nzd(usable)
        capped_by = capped_by or "cart_total"
    return {
        "requested_points": requested,
        "usable_points": usable,
        "discount_nzd": discount,
        "balance_after": balance - usable,
        "capped_by": capped_by,
    }


async def redeem_for_order(
    user_id: str, order_id: str, points_to_redeem: int
) -> int:
    """Debit the ledger when an order is paid. Idempotent per order_id."""
    points_to_redeem = max(0, int(points_to_redeem))
    if points_to_redeem == 0:
        return 0
    existing = await db.points_ledger.find_one(
        {"user_id": user_id, "reason": "order_redeem", "ref_id": order_id},
        {"_id": 0, "id": 1},
    )
    if existing:
        return 0
    # Sanity check current balance just before debit
    bal = await current_balance(user_id)
    actual = min(points_to_redeem, bal)
    if actual <= 0:
        return 0
    await _append_entry(
        user_id=user_id,
        delta=-actual,
        reason="order_redeem",
        title=f"Used on order · -{actual} pts",
        ref_id=order_id,
        ref_type="order",
    )
    return actual
