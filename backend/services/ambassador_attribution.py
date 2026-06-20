"""Ambassador commission attribution + release.

Lifecycle:
  1. Order placed with an ambassador-issued coupon code.
  2. Payment succeeds → ``credit_pending_for_order`` is invoked from
     ``routers.checkout._on_payment_succeeded``.
     - Writes ``ambassador_id`` + commission breakdown onto the order doc.
     - Increments the ambassador's ``pending_commission_minor`` and
       ``revenue_driven_minor`` (subtotal is the GMV credited).
     - Sets ``ambassador_release_at = paid_at + COMMISSION_HOLD_DAYS``.
  3. After the 7-day return-window hold expires, a scheduler job calls
     ``release_due_ambassador_commission`` which moves the per-order minor
     amount from ``pending_commission_minor`` → ``unpaid_balance_minor``
     and bumps ``lifetime_commission_minor`` + ``lifetime_orders``.

All writes are idempotent (guarded by the order's ``ambassador_attribution_state``
field: ``credited`` → ``released`` → terminal).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from db import db
# Pull tier rules + hold-days + payout currency map straight from the
# ambassador router so they remain a single source of truth.
from routers.ambassadors import (
    B2C_TIERS,
    COMMISSION_HOLD_DAYS,
    COUNTRY_PAYOUT_CCY,
    _count_orders_30d,
    _resolve_tier,
)
from services import fx

logger = logging.getLogger("allsale.ambassadors")


async def credit_pending_for_order(order_id: str) -> None:
    """Attribute an ambassador to a freshly-paid order and credit pending
    commission. Idempotent — running twice is a no-op."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    if order.get("ambassador_attribution_state"):
        return  # already processed (idempotency guard)

    code = (order.get("coupon_code") or "").strip().upper()
    if not code:
        return  # no coupon applied → nothing to attribute

    coupon = await db.coupons.find_one(
        {"code": code, "coupon_type": "ambassador_b2c"},
        {"_id": 0, "ambassador_user_id": 1, "coupon_type": 1},
    )
    if not coupon or not coupon.get("ambassador_user_id"):
        return  # coupon exists but isn't an ambassador code

    amb_id = coupon["ambassador_user_id"]
    amb = await db.users.find_one(
        {"id": amb_id}, {"_id": 0, "ambassador_profile": 1, "country": 1}
    )
    prof = (amb or {}).get("ambassador_profile") or {}
    if not prof:
        logger.warning("ambassador coupon %s resolved to user %s with no profile",
                       code, amb_id)
        return
    if prof.get("status") in {"suspended", "forfeited"}:
        logger.info("ambassador %s suspended/forfeited — skipping attribution for order %s",
                    amb_id, order_id)
        return

    # --- Resolve commission rate from CURRENT tier --------------------------
    orders_30d = await _count_orders_30d(amb_id)
    current_tier, _ = _resolve_tier(orders_30d)
    rate_pct = float(current_tier["rate_pct"])

    # --- Commission base = order subtotal AFTER coupon + loyalty discounts.
    # Ambassador commission is computed from the buyer's ACTUAL paid amount
    # rather than the pre-coupon list price — this keeps the give-away cost
    # shared across the value chain (seller + platform + ambassador) and
    # prevents stacked discounts from pushing the platform into negative-
    # margin territory.
    subtotal_listed = float(order.get("subtotal_nzd") or 0.0)
    coupon_discount = float(order.get("discount_nzd") or 0.0)
    points_discount = float(order.get("points_discount_nzd") or 0.0)
    subtotal_nzd = max(0.0, subtotal_listed - coupon_discount - points_discount)
    if subtotal_nzd <= 0:
        return

    commission_nzd = round(subtotal_nzd * rate_pct / 100.0, 2)
    payout_ccy = prof.get("payout_currency") or COUNTRY_PAYOUT_CCY.get(
        (prof.get("country") or "NZ").upper(), "NZD"
    )
    # Convert NZD → payout currency at today's FX (snapshot the rate so
    # later FX swings don't change what we owe the ambassador).
    if payout_ccy == "NZD":
        commission_in_ccy = commission_nzd
        revenue_in_ccy = subtotal_nzd
    else:
        try:
            rates = await fx.get_rates()
            commission_in_ccy = fx.convert(commission_nzd, payout_ccy, rates)
            revenue_in_ccy = fx.convert(subtotal_nzd, payout_ccy, rates)
        except Exception:
            logger.exception("FX lookup failed for %s — falling back to NZD", payout_ccy)
            commission_in_ccy = commission_nzd
            revenue_in_ccy = subtotal_nzd

    commission_minor = int(round(commission_in_ccy * 100))
    revenue_minor = int(round(revenue_in_ccy * 100))
    if commission_minor <= 0:
        return

    paid_at = order.get("paid_at") or datetime.now(timezone.utc)
    if paid_at.tzinfo is None:
        paid_at = paid_at.replace(tzinfo=timezone.utc)
    release_at = paid_at + timedelta(days=COMMISSION_HOLD_DAYS)

    # --- Persist on the order ----------------------------------------------
    order_update = await db.orders.update_one(
        {"id": order_id, "ambassador_attribution_state": {"$exists": False}},
        {"$set": {
            "ambassador_id": amb_id,
            "ambassador_commission_minor": commission_minor,
            "ambassador_commission_currency": payout_ccy,
            "ambassador_tier_key_at_attribution": current_tier["key"],
            "ambassador_rate_pct_at_attribution": rate_pct,
            "ambassador_release_at": release_at,
            "ambassador_attribution_state": "credited",
            "ambassador_credited_at": datetime.now(timezone.utc),
        }},
    )
    if order_update.modified_count == 0:
        # Raced with another worker — skip the profile increments.
        return

    # --- Bump the ambassador's pending pot ---------------------------------
    await db.users.update_one(
        {"id": amb_id},
        {
            "$inc": {
                "ambassador_profile.pending_commission_minor": commission_minor,
                "ambassador_profile.lifetime_orders": 1,
                "ambassador_profile.revenue_driven_minor": revenue_minor,
            },
            "$set": {
                "ambassador_profile.last_active_at": datetime.now(timezone.utc),
            },
        },
    )
    logger.info(
        "ambassador credit: order=%s ambassador=%s commission=%s %s (tier=%s @ %.1f%%)",
        order_id, amb_id, commission_in_ccy, payout_ccy,
        current_tier["key"], rate_pct,
    )


async def release_due_ambassador_commission() -> dict:
    """Move per-order pending → unpaid for orders past their 7-day hold.

    Skips orders that have been refunded, cancelled, or returned — those
    flip to ``ambassador_attribution_state == "clawed_back"`` and the
    pending amount is just decremented (no unpaid bump).
    """
    now = datetime.now(timezone.utc)
    released = 0
    clawed = 0
    cursor = db.orders.find(
        {
            "ambassador_attribution_state": "credited",
            "ambassador_release_at": {"$lte": now},
        },
        {"_id": 0, "id": 1, "ambassador_id": 1,
         "ambassador_commission_minor": 1, "status": 1, "payment_status": 1},
    ).limit(500)
    async for o in cursor:
        amb_id = o.get("ambassador_id")
        minor = int(o.get("ambassador_commission_minor") or 0)
        if not amb_id or minor <= 0:
            await db.orders.update_one(
                {"id": o["id"]},
                {"$set": {"ambassador_attribution_state": "skipped"}},
            )
            continue

        # Clawback if the order ended up cancelled/refunded/returned.
        terminal_bad = {"cancelled", "refunded", "returned"}
        if (o.get("status") in terminal_bad) or (o.get("payment_status") in terminal_bad):
            await db.orders.update_one(
                {"id": o["id"], "ambassador_attribution_state": "credited"},
                {"$set": {"ambassador_attribution_state": "clawed_back",
                          "ambassador_clawed_back_at": now}},
            )
            await db.users.update_one(
                {"id": amb_id},
                {"$inc": {"ambassador_profile.pending_commission_minor": -minor}},
            )
            clawed += 1
            continue

        # Happy path — release.
        res = await db.orders.update_one(
            {"id": o["id"], "ambassador_attribution_state": "credited"},
            {"$set": {"ambassador_attribution_state": "released",
                      "ambassador_released_at": now}},
        )
        if res.modified_count == 0:
            continue  # raced
        await db.users.update_one(
            {"id": amb_id},
            {"$inc": {
                "ambassador_profile.pending_commission_minor": -minor,
                "ambassador_profile.unpaid_balance_minor": minor,
                "ambassador_profile.lifetime_commission_minor": minor,
            }},
        )
        # Sync the order's `ambassador_locked_at` so the sales list shows
        # this row as "available".
        await db.orders.update_one(
            {"id": o["id"]},
            {"$set": {"ambassador_locked_at": now}},
        )
        released += 1

    if released or clawed:
        logger.info("ambassador release tick — released=%d clawed=%d", released, clawed)
    return {"released": released, "clawed_back": clawed}
