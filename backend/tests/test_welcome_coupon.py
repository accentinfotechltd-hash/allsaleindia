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
