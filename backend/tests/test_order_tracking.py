"""Tests for the buyer-side Order Tracking enhancement (June 2026).

Covers:
- GET  /api/orders/{id}/tracking       — stages, progress %, scan events, AWB
- POST /api/orders/{id}/mark-received  — buyer-confirmed delivery, idempotency
- POST /api/orders/{id}/reorder        — re-adds to cart, skips out-of-stock
- POST /api/reviews/{id}/report        — buyer flags abusive review

Tests share helpers with `test_reviews.py` for fixture parity.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def _address():
    return {
        "full_name": "Tracking Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def _new_user(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_trk_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"Trk {label}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "user_id": d["user"]["id"],
        "token": d["access_token"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {d['access_token']}",
        },
    }


def _make_paid_order(api_client, base_url, headers):
    """Create one paid order with one in-stock product; return (order_id, product_id)."""
    products = api_client.get(f"{base_url}/api/products").json()
    # Pick the first in-stock product to avoid order pollution from prior test runs.
    p = next((x for x in products if x.get("in_stock") and (x.get("stock_count") or 0) > 5), products[0])
    api_client.post(
        f"{base_url}/api/cart",
        headers=headers,
        json={"product_id": p["id"], "quantity": 2},
    )
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 200, r.text
    order_id = r.json()["order_id"]

    async def force_paid():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "status": "paid",
                "payment_status": "paid",
            }},
        )
        cli.close()
    asyncio.run(force_paid())
    return order_id, p["id"]


def _force_order_state(order_id: str, patch: dict):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one({"id": order_id}, {"$set": patch})
        cli.close()
    asyncio.run(go())


def _attach_shipment(order_id: str, awb: str, events: list[dict] | None = None):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        doc = {
            "id": f"shp_{order_id[-8:]}",
            "order_id": order_id,
            "awb_code": awb,
            "carrier": "Shiprocket X",
            "tracking_url": f"https://shiprocket.co/tracking/{awb}",
            "status": "in_transit",
            "estimated_delivery": "3-5 business days",
            "is_mocked": True,
            "events": events or [],
            "last_update_at": datetime.now(timezone.utc),
        }
        await db.shipments.update_one(
            {"order_id": order_id}, {"$set": doc}, upsert=True
        )
        cli.close()
    asyncio.run(go())


# ---------- fixtures ----------
@pytest.fixture
def buyer(api_client, base_url):
    return _new_user(api_client, base_url, "buyer")


@pytest.fixture
def buyer_with_order(api_client, base_url, buyer):
    oid, pid = _make_paid_order(api_client, base_url, buyer["headers"])
    return {**buyer, "order_id": oid, "product_id": pid}


# ============================================================================
# TRACKING
# ============================================================================
def test_tracking_paid_order_returns_first_stage(api_client, base_url, buyer_with_order):
    r = api_client.get(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/tracking",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["order_id"] == buyer_with_order["order_id"]
    assert t["status"] == "paid"
    assert t["progress_pct"] == 25  # 1 of 4 stages
    assert [s["key"] for s in t["stages"]] == [
        "paid", "shipped", "out_for_delivery", "delivered",
    ]
    assert t["stages"][0]["done"] is True
    assert t["stages"][0]["at"] is not None
    assert all(not s["done"] for s in t["stages"][1:])
    assert t["events"] == []


def test_tracking_with_events_returns_newest_first(api_client, base_url, buyer_with_order):
    now = datetime.now(timezone.utc)
    events = [
        {"at": now - timedelta(days=2), "status": "Pickup", "location": "Mumbai, IN", "remark": "Picked up"},
        {"at": now - timedelta(days=1), "status": "In Transit", "location": "Singapore", "remark": "Hub scan"},
        {"at": now, "status": "Arrived", "location": "Auckland, NZ", "remark": "At facility"},
    ]
    awb = f"AWBTRK{int(time.time() * 1000)}"
    _attach_shipment(buyer_with_order["order_id"], awb, events)
    _force_order_state(buyer_with_order["order_id"], {
        "status": "shipped",
        "shipped_at": now - timedelta(days=2),
        "tracking_status": "Arrived",
        "last_tracking_location": "Auckland, NZ",
        "awb_code": awb,
    })

    r = api_client.get(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/tracking",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "shipped"
    assert t["progress_pct"] == 50  # 2 of 4 stages
    assert t["awb_code"] == awb
    assert t["carrier"] == "Shiprocket X"
    assert t["tracking_url"]
    # Events newest-first
    assert len(t["events"]) == 3
    assert t["events"][0]["status"] == "Arrived"
    assert t["events"][0]["location"] == "Auckland, NZ"
    assert t["events"][-1]["status"] == "Pickup"


def test_tracking_delivered_progress_100(api_client, base_url, buyer_with_order):
    _force_order_state(buyer_with_order["order_id"], {
        "status": "delivered",
        "shipped_at": datetime.now(timezone.utc) - timedelta(days=3),
        "out_for_delivery_at": datetime.now(timezone.utc) - timedelta(hours=6),
        "delivered_at": datetime.now(timezone.utc),
    })
    r = api_client.get(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/tracking",
        headers=buyer_with_order["headers"],
    )
    t = r.json()
    assert t["progress_pct"] == 100
    assert all(s["done"] for s in t["stages"])


def test_tracking_cancelled_progress_zero(api_client, base_url, buyer_with_order):
    _force_order_state(buyer_with_order["order_id"], {"status": "cancelled"})
    r = api_client.get(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/tracking",
        headers=buyer_with_order["headers"],
    )
    t = r.json()
    assert t["progress_pct"] == 0


def test_tracking_other_buyer_404(api_client, base_url, buyer_with_order):
    intruder = _new_user(api_client, base_url, "intruder")
    r = api_client.get(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/tracking",
        headers=intruder["headers"],
    )
    assert r.status_code == 404


# ============================================================================
# MARK RECEIVED
# ============================================================================
def test_mark_received_happy_path(api_client, base_url, buyer_with_order):
    _force_order_state(buyer_with_order["order_id"], {
        "status": "delivered",
        "delivered_at": datetime.now(timezone.utc),
    })
    r = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/mark-received",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["buyer_confirmed_at"] is not None
    assert o["status"] == "delivered"


def test_mark_received_promotes_out_for_delivery_to_delivered(api_client, base_url, buyer_with_order):
    _force_order_state(buyer_with_order["order_id"], {"status": "out_for_delivery"})
    r = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/mark-received",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["status"] == "delivered"  # promoted
    assert o["buyer_confirmed_at"] is not None
    assert o["delivered_at"] is not None


def test_mark_received_idempotent(api_client, base_url, buyer_with_order):
    _force_order_state(buyer_with_order["order_id"], {
        "status": "delivered",
        "delivered_at": datetime.now(timezone.utc),
    })
    r1 = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/mark-received",
        headers=buyer_with_order["headers"],
    )
    assert r1.status_code == 200
    r2 = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/mark-received",
        headers=buyer_with_order["headers"],
    )
    assert r2.status_code == 409  # already confirmed


def test_mark_received_rejects_pre_dispatch(api_client, base_url, buyer_with_order):
    # status is still "paid" — not ready for confirmation
    r = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/mark-received",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 400


def test_mark_received_rejects_cancelled(api_client, base_url, buyer_with_order):
    _force_order_state(buyer_with_order["order_id"], {"status": "cancelled"})
    r = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/mark-received",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 400


# ============================================================================
# REORDER
# ============================================================================
def test_reorder_adds_items_to_cart(api_client, base_url, buyer_with_order):
    r = api_client.post(
        f"{base_url}/api/orders/{buyer_with_order['order_id']}/reorder",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["cart_item_count"] >= 2
    assert buyer_with_order["product_id"] in res["added"]
    assert res["skipped"] == []

    # The cart now contains the reordered product
    cart = api_client.get(f"{base_url}/api/cart", headers=buyer_with_order["headers"]).json()
    assert any(it["product_id"] == buyer_with_order["product_id"] for it in cart["items"])


def test_reorder_skips_out_of_stock(api_client, base_url, buyer_with_order):
    async def out_of_stock():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.products.update_one(
            {"id": buyer_with_order["product_id"]},
            {"$set": {"in_stock": False, "stock_count": 0}},
        )
        cli.close()
    asyncio.run(out_of_stock())

    try:
        r = api_client.post(
            f"{base_url}/api/orders/{buyer_with_order['order_id']}/reorder",
            headers=buyer_with_order["headers"],
        )
        assert r.status_code == 200, r.text
        res = r.json()
        assert res["added"] == []
        assert any(s["product_id"] == buyer_with_order["product_id"] and s["reason"] == "out_of_stock" for s in res["skipped"])
    finally:
        # Always restore so other tests don't break.
        async def restock():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            await db.products.update_one(
                {"id": buyer_with_order["product_id"]},
                {"$set": {"in_stock": True, "stock_count": 100}},
            )
            cli.close()
        asyncio.run(restock())


# ============================================================================
# REVIEW REPORT
# ============================================================================
def _create_review_for(api_client, base_url, buyer, order_id, product_id) -> str:
    # Bypass the "must be shipped" gate by forcing order delivered
    _force_order_state(order_id, {"status": "delivered", "delivered_at": datetime.now(timezone.utc)})
    body = {
        "order_id": order_id,
        "product_id": product_id,
        "rating": 1,
        "title": "Bad",
        "comment": "Total scam product avoid avoid avoid",
    }
    r = api_client.post(f"{base_url}/api/reviews", headers=buyer["headers"], json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _purge_review(review_id: str):
    """Drop a review row so other tests (sort/distribution) aren't polluted."""
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.reviews.delete_one({"id": review_id})
        cli.close()
    asyncio.run(go())


def test_report_review_marks_reported_and_is_idempotent(
    api_client, base_url, buyer_with_order
):
    rid = _create_review_for(
        api_client, base_url, buyer_with_order,
        buyer_with_order["order_id"], buyer_with_order["product_id"],
    )
    try:
        reporter = _new_user(api_client, base_url, "reporter")
        r1 = api_client.post(
            f"{base_url}/api/reviews/{rid}/report",
            headers=reporter["headers"],
            json={"reason": "spam"},
        )
        assert r1.status_code == 204, r1.text

        # Idempotent — same reporter, no error
        r2 = api_client.post(
            f"{base_url}/api/reviews/{rid}/report",
            headers=reporter["headers"],
            json={"reason": "spam again"},
        )
        assert r2.status_code == 204

        # Doc now flagged
        async def check():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            doc = await db.reviews.find_one({"id": rid})
            cli.close()
            return doc
        doc = asyncio.run(check())
        assert doc["reported"] is True
        assert doc["moderation_status"] == "reported"
        assert len(doc["reports"]) == 1  # idempotent
    finally:
        _purge_review(rid)


def test_report_own_review_forbidden(api_client, base_url, buyer_with_order):
    rid = _create_review_for(
        api_client, base_url, buyer_with_order,
        buyer_with_order["order_id"], buyer_with_order["product_id"],
    )
    try:
        r = api_client.post(
            f"{base_url}/api/reviews/{rid}/report",
            headers=buyer_with_order["headers"],
            json={"reason": "spam"},
        )
        assert r.status_code == 400
    finally:
        _purge_review(rid)


def test_report_review_not_found(api_client, base_url, buyer):
    r = api_client.post(
        f"{base_url}/api/reviews/rev_doesnotexist/report",
        headers=buyer["headers"],
        json={"reason": "spam"},
    )
    assert r.status_code == 404
