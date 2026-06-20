"""Cancellation-reasons endpoint + structured cancel flow.

We hit the running backend (live HTTP via `requests`) for the simple list
endpoint, and use TestClient + dependency overrides + pymongo seed for the
order-cancel logic so we don't depend on Stripe / a paid checkout.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from fastapi.testclient import TestClient
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import app  # noqa: E402
from deps import get_current_user  # noqa: E402
from routers import orders as orders_router  # noqa: E402

_MONGO = MongoClient(os.environ.get("MONGO_URL") or "mongodb://localhost:27017")
_DB_NAME = os.environ.get("DB_NAME") or "allsale_database"
_orders = _MONGO[_DB_NAME]["orders"]
_payouts = _MONGO[_DB_NAME]["payouts"]


# ---------------------------------------------------------------------------
# Live HTTP — the public list endpoint
# ---------------------------------------------------------------------------
def test_cancel_reasons_endpoint_live(base_url):
    """`GET /api/orders/cancel-reasons` should return a non-empty list with
    the canonical fields and include the ``other`` (requires_note) entry."""
    r = requests.get(f"{base_url}/api/orders/cancel-reasons", timeout=8)
    assert r.status_code == 200, r.text
    items = r.json()
    assert isinstance(items, list) and len(items) >= 4
    keys = {tuple(sorted(d.keys())) for d in items}
    # Every entry must have the same 3 fields
    assert keys == {("code", "label", "requires_note")}
    codes = [d["code"] for d in items]
    assert "other" in codes, "missing required 'other' reason"
    other = next(d for d in items if d["code"] == "other")
    assert other["requires_note"] is True


# ---------------------------------------------------------------------------
# TestClient — exercise cancel validation w/o touching Stripe
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _seed_paid_order(user_id: str) -> str:
    """Insert a minimal paid order for the given user and return its id."""
    oid = f"order_{uuid.uuid4().hex[:12]}"
    _orders.insert_one(
        {
            "id": oid,
            "user_id": user_id,
            "items": [
                {
                    "product_id": "p_dummy",
                    "name": "Test product",
                    "image": "https://example.com/i.png",
                    "price_nzd": 19.99,
                    "quantity": 1,
                    "seller_id": "seller_demo",
                }
            ],
            "subtotal_nzd": 19.99,
            "shipping_nzd": 5.0,
            "total_nzd": 24.99,
            "address": {
                "full_name": "Tester",
                "line1": "1 Test Lane",
                "city": "Auckland",
                "region": "AKL",
                "postcode": "1010",
                "country": "NZ",
                "phone": "+64 21 000 0000",
            },
            "status": "paid",
            "payment_status": "paid",
            "created_at": datetime.now(tz=timezone.utc),
            "estimated_delivery": "5–9 business days",
            # NOTE: no session_id / payment_intent — issue_stripe_refund will
            # noop and return (None, total_nzd).
        }
    )
    return oid


def _override_user(user_id: str):
    """Hook FastAPI to treat each request as coming from `user_id`."""
    async def fake_user():
        return {"id": user_id, "email": "stub@allsale.co.nz", "full_name": "Stub"}

    app.dependency_overrides[get_current_user] = fake_user


def _cleanup_user_orders(user_id: str) -> None:
    _orders.delete_many({"user_id": user_id})
    _payouts.delete_many({"user_id": user_id})


def test_cancel_rejects_unknown_reason_code(client):
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    _override_user(uid)
    try:
        oid = _seed_paid_order(uid)
        r = client.post(
            f"/api/orders/{oid}/cancel",
            json={"reason_code": "i_am_not_a_real_code"},
        )
        assert r.status_code == 400, r.text
        assert "Unknown cancellation reason" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        _cleanup_user_orders(uid)


def test_cancel_requires_note_when_other(client):
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    _override_user(uid)
    try:
        oid = _seed_paid_order(uid)
        r = client.post(
            f"/api/orders/{oid}/cancel",
            json={"reason_code": "other"},  # no note
        )
        assert r.status_code == 400, r.text
        assert "why" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        _cleanup_user_orders(uid)


def test_cancel_with_structured_reason_persists_code_and_expected_by(client):
    uid = f"user_stub_{uuid.uuid4().hex[:8]}"
    _override_user(uid)
    try:
        oid = _seed_paid_order(uid)
        # Pre-empt Stripe call so we don't need real credentials.
        orders_router.issue_stripe_refund = (  # type: ignore[assignment]
            lambda order: _fake_refund(order)
        )

        r = client.post(
            f"/api/orders/{oid}/cancel",
            json={"reason_code": "changed_mind"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "cancelled"
        assert body["cancel_reason_code"] == "changed_mind"
        assert body["refund_amount_nzd"] == 24.99
        assert body["refund_expected_by"], "refund_expected_by must be set"
        # Round-trip the date so we know it's a valid ISO 8601.
        datetime.fromisoformat(body["refund_expected_by"].replace("Z", "+00:00"))

        # Second call must reject (already cancelled).
        r2 = client.post(
            f"/api/orders/{oid}/cancel", json={"reason_code": "changed_mind"}
        )
        assert r2.status_code == 400
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        _cleanup_user_orders(uid)


async def _fake_refund(order):
    return f"re_test_{uuid.uuid4().hex[:8]}", float(order.get("total_nzd") or 0)
