"""First-purchase welcome-coupon flow — service-level tests.

Covers:
  - seed/ensure produces a valid sitewide coupon (idempotent)
  - get_welcome_coupon_for_user honours eligibility / redemption history
  - validate_for_cart rejects/accepts based on first_order_only + cap + min

The HTTP-layer ``GET /api/coupons/welcome`` route is a 4-line wrapper around
``get_welcome_coupon_for_user`` (see ``routers/coupons.py``); it inherits the
coverage of this service-level test by composition. We additionally smoke-test
it end-to-end via a curl in the deploy checklist.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.coupons import validate_for_cart  # noqa: E402
from services.welcome_coupon import (  # noqa: E402
    ensure_welcome_coupon,
    get_welcome_coupon_for_user,
)
from tests.conftest import run_async  # noqa: E402

_MONGO = MongoClient(os.environ.get("MONGO_URL") or "mongodb://localhost:27017")
_DB_NAME = os.environ.get("DB_NAME") or "allsale_database"
_db = _MONGO[_DB_NAME]


def _run(coro):
    """Reuse the session-wide event loop so motor stays bound to one loop."""
    return run_async(coro)


def _cleanup(user_id: str) -> None:
    _db.orders.delete_many({"user_id": user_id})
    _db.coupon_usage.delete_many({"user_id": user_id})


# ---------------------------------------------------------------------------
# Service-level
# ---------------------------------------------------------------------------
def test_ensure_welcome_coupon_is_idempotent():
    """Two calls must leave exactly one WELCOME row in the collection."""
    _run(ensure_welcome_coupon())
    _run(ensure_welcome_coupon())
    count = _db.coupons.count_documents({"code": "WELCOME10"})
    assert count == 1
    doc = _db.coupons.find_one({"code": "WELCOME10"})
    assert doc["first_order_only"] is True
    assert doc["value"] == 10
    assert doc["active"] is True


# ---------------------------------------------------------------------------
# HTTP — /coupons/welcome
# (moved to test_welcome_coupon_http.py — see module docstring for why)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Service-level cart validation
# ---------------------------------------------------------------------------
def _build_cart(subtotal: float):
    return [
        {
            "product_id": "p_test",
            "seller_id": "s_test",
            "price_nzd": subtotal,
            "quantity": 1,
            "category": "Decor",
        }
    ]


def test_validate_welcome_accepts_brand_new_buyer():
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    user = {"id": uid, "country": "NZ"}
    coupon, result = _run(
        validate_for_cart("WELCOME10", _build_cart(50.0), 50.0, user)
    )
    assert coupon is not None
    assert result["ok"] is True, result
    # 10% of $50 = $5, well under the $20 cap.
    assert result["discount_nzd"] == 5.0
    _cleanup(uid)


def test_validate_welcome_rejects_repeat_buyer():
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    user = {"id": uid, "country": "NZ"}
    # Insert a paid order ⇒ no longer eligible.
    _db.orders.insert_one(
        {
            "id": f"order_{uuid.uuid4().hex[:8]}",
            "user_id": uid,
            "payment_status": "paid",
            "status": "paid",
            "total_nzd": 30.0,
            "created_at": datetime.now(tz=timezone.utc),
        }
    )
    try:
        _, result = _run(
            validate_for_cart("WELCOME10", _build_cart(50.0), 50.0, user)
        )
        assert result["ok"] is False
        assert "first order" in (result["error"] or "").lower()
    finally:
        _cleanup(uid)


def test_validate_welcome_respects_min_order():
    """Welcome coupon should fail loudly when the cart is below the
    $25 minimum, returning a friendly "spend more" error so the buyer
    knows how much more they need to add."""
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    user = {"id": uid, "country": "NZ"}
    _, result = _run(
        validate_for_cart("WELCOME10", _build_cart(10.0), 10.0, user)
    )
    assert result["ok"] is False
    assert "Spend" in (result["error"] or "")
    _cleanup(uid)


def test_validate_welcome_caps_discount_at_max():
    """At 10% off, a $300 cart would discount $30 — but the cap is $20."""
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    user = {"id": uid, "country": "NZ"}
    _, result = _run(
        validate_for_cart("WELCOME10", _build_cart(300.0), 300.0, user)
    )
    assert result["ok"] is True
    assert result["discount_nzd"] == 20.0
    _cleanup(uid)


def test_get_welcome_coupon_for_user_returns_none_after_redemption():
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    user = {"id": uid, "country": "NZ"}
    coupon = _run(get_welcome_coupon_for_user(user))
    assert coupon is not None and coupon["code"] == "WELCOME10"

    # Simulate redemption
    _db.coupon_usage.insert_one(
        {
            "coupon_id": coupon["id"],
            "user_id": uid,
            "order_id": f"order_{uuid.uuid4().hex[:8]}",
            "discount_nzd": 5.0,
            "redeemed_at": datetime.now(tz=timezone.utc),
        }
    )
    after = _run(get_welcome_coupon_for_user(user))
    assert after is None
    _cleanup(uid)


# ---------------------------------------------------------------------------
# Regression — payouts honour the proportional-discount-sharing contract
# ---------------------------------------------------------------------------
# WHY: services/payouts.py used to compute seller commission from the
# pre-coupon listed price, so the platform absorbed 100% of every coupon
# discount. After fixing the math we share the discount proportionally
# with sellers (matching Amazon/Etsy/eBay/Flipkart). This test locks the
# behaviour in so a future refactor can't silently re-introduce the bug.
#
# The acid-test: a 50%-off coupon should halve the seller's commission base
# (and therefore halve the platform's commission take) — same as if the
# seller had listed the item at half the price to begin with.
def test_payouts_halve_commission_when_50pct_coupon(monkeypatch):
    from services import payouts as payouts_svc

    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    sid = f"seller_stub_{uuid.uuid4().hex[:8]}"
    pid = f"prod_stub_{uuid.uuid4().hex[:8]}"
    oid = f"order_stub_{uuid.uuid4().hex[:8]}"

    # Seed a product in the "Decor" category which carries a 15% commission
    # (1500 bps) — see services/stripe_connect_svc.get_commission_bps_for_product.
    _db.products.insert_one(
        {"id": pid, "category": "Decor", "tags": [], "price_nzd": 100.0}
    )

    # Order with a $100 listed item, a 50% ($50) coupon — buyer effectively
    # pays $50. Pre-fix the seller would've received commission against $100;
    # post-fix they should receive against $50.
    _db.orders.insert_one(
        {
            "id": oid,
            "user_id": uid,
            "items": [
                {
                    "product_id": pid,
                    "seller_id": sid,
                    "seller_name": "Stub Seller",
                    "name": "Test Decor",
                    "image": "x",
                    "price_nzd": 100.0,
                    "quantity": 1,
                }
            ],
            "subtotal_nzd": 100.0,
            "discount_nzd": 50.0,          # ← the 50% coupon
            "points_discount_nzd": 0.0,
            "shipping_nzd": 0.0,
            "total_nzd": 50.0,
            "status": "paid",
            "payment_status": "paid",
            "created_at": datetime.now(tz=timezone.utc),
        }
    )

    # Stub seller-tier resolution (returns the default Starter tier) so we
    # don't depend on the sellers collection layout for this test.
    class _Tier:
        name = "starter"
        reserve_pct = 0.0

    async def _fake_tier(seller_id: str):
        return _Tier()

    monkeypatch.setattr(payouts_svc, "_tier_for", _fake_tier)

    # Invoke the service and inspect the payout it writes.
    try:
        run_async(payouts_svc.create_payouts_for_order(oid))
        payout = _db.payouts.find_one({"order_id": oid, "seller_id": sid})
        assert payout is not None, "payout row was not created"
        # On a $100 line with a 50% coupon, the discounted line gross = $50.
        # At 12% commission (Decor category default), the platform takes $6
        # and the seller's net payable is $50 − $6 = $44.
        assert payout["gross_nzd"] == 50.0, payout
        assert payout["commission_nzd"] == 6.0, payout
        assert payout["net_payable_nzd"] == 44.0, payout
    finally:
        _db.products.delete_one({"id": pid})
        _db.orders.delete_one({"id": oid})
        _db.payouts.delete_many({"order_id": oid})


def test_payouts_unchanged_when_no_coupon(monkeypatch):
    """Sanity counterpart: zero discount → seller gets full pre-fix commission
    base. Guards against accidental scaling on non-discounted orders."""
    from services import payouts as payouts_svc

    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    sid = f"seller_stub_{uuid.uuid4().hex[:8]}"
    pid = f"prod_stub_{uuid.uuid4().hex[:8]}"
    oid = f"order_stub_{uuid.uuid4().hex[:8]}"

    _db.products.insert_one(
        {"id": pid, "category": "Decor", "tags": [], "price_nzd": 80.0}
    )
    _db.orders.insert_one(
        {
            "id": oid,
            "user_id": uid,
            "items": [
                {
                    "product_id": pid,
                    "seller_id": sid,
                    "seller_name": "Stub Seller",
                    "name": "Test Decor",
                    "image": "x",
                    "price_nzd": 80.0,
                    "quantity": 1,
                }
            ],
            "subtotal_nzd": 80.0,
            "discount_nzd": 0.0,
            "points_discount_nzd": 0.0,
            "shipping_nzd": 0.0,
            "total_nzd": 80.0,
            "status": "paid",
            "payment_status": "paid",
            "created_at": datetime.now(tz=timezone.utc),
        }
    )

    class _Tier:
        name = "starter"
        reserve_pct = 0.0

    async def _fake_tier(seller_id: str):
        return _Tier()

    monkeypatch.setattr(payouts_svc, "_tier_for", _fake_tier)

    try:
        run_async(payouts_svc.create_payouts_for_order(oid))
        payout = _db.payouts.find_one({"order_id": oid, "seller_id": sid})
        assert payout is not None
        # $80 × 12% (Decor) = $9.60 commission · $70.40 net payable
        assert payout["gross_nzd"] == 80.0
        assert payout["commission_nzd"] == 9.6
        assert payout["net_payable_nzd"] == 70.4
    finally:
        _db.products.delete_one({"id": pid})
        _db.orders.delete_one({"id": oid})
        _db.payouts.delete_many({"order_id": oid})
