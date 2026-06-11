"""Tests for order cancellation (12-hour window) and notifications fan-out."""
import os
import time

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "allsale_database")


def _address():
    return {
        "full_name": "Cancel Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


@pytest.fixture
def fresh_user(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_cancel_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Cancel Tester"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "email": email,
        "user_id": data["user"]["id"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {data['access_token']}",
        },
    }


def _make_paid_order(api_client, base_url, headers, user_id):
    """Create an order then directly mark it paid in Mongo to simulate Stripe webhook."""
    # Empty cart
    cur = api_client.get(f"{base_url}/api/cart", headers=headers).json()
    for it in cur.get("items", []):
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=headers)

    products = api_client.get(f"{base_url}/api/products").json()
    p = products[0]
    api_client.post(
        f"{base_url}/api/cart",
        headers=headers,
        json={"product_id": p["id"], "quantity": 1},
    )
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 200, r.text
    order_id = r.json()["order_id"]

    # Mark it paid via Mongo directly (Stripe webhook would do this).
    import asyncio
    from datetime import datetime, timezone, timedelta

    async def mark_paid():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        paid_at = datetime.now(timezone.utc)
        await db.orders.update_one(
            {"id": order_id},
            {
                "$set": {
                    "status": "paid",
                    "payment_status": "paid",
                    "paid_at": paid_at,
                    "cancellable_until": paid_at + timedelta(hours=12),
                }
            },
        )
        # Also create notifications via API would be nicer, but for tests we just verify cancel works
        cli.close()

    asyncio.run(mark_paid())
    return order_id


def test_cancel_within_window_succeeds(api_client, base_url, fresh_user):
    headers = fresh_user["headers"]
    order_id = _make_paid_order(api_client, base_url, headers, fresh_user["user_id"])

    r = api_client.post(
        f"{base_url}/api/orders/{order_id}/cancel",
        headers=headers,
        json={"reason": "Ordered by mistake"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "cancelled"
    assert body["cancel_reason"] == "Ordered by mistake"


def test_cancel_outside_window_now_allowed(api_client, base_url, fresh_user):
    """After relaxing the 12-hour rule, cancel is allowed any time the order
    is still pre-shipped, even if `cancellable_until` is in the past."""
    headers = fresh_user["headers"]
    order_id = _make_paid_order(api_client, base_url, headers, fresh_user["user_id"])

    # Move cancellable_until into the past — should still succeed.
    import asyncio
    from datetime import datetime, timezone, timedelta

    async def expire():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {"cancellable_until": datetime.now(timezone.utc) - timedelta(hours=48)}},
        )
        cli.close()

    asyncio.run(expire())

    r = api_client.post(
        f"{base_url}/api/orders/{order_id}/cancel",
        headers=headers,
        json={},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "cancelled"


def test_cannot_cancel_shipped_order(api_client, base_url, fresh_user):
    headers = fresh_user["headers"]
    order_id = _make_paid_order(api_client, base_url, headers, fresh_user["user_id"])

    import asyncio

    async def ship():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one({"id": order_id}, {"$set": {"status": "shipped"}})
        cli.close()

    asyncio.run(ship())

    r = api_client.post(
        f"{base_url}/api/orders/{order_id}/cancel", headers=headers, json={}
    )
    assert r.status_code == 400, r.text
    assert "dispatched" in r.json()["detail"].lower() or "return" in r.json()["detail"].lower()


def test_cancel_creates_notifications(api_client, base_url, fresh_user):
    headers = fresh_user["headers"]
    order_id = _make_paid_order(api_client, base_url, headers, fresh_user["user_id"])

    # No notifications before
    pre = api_client.get(f"{base_url}/api/notifications", headers=headers).json()
    pre_count = len(pre)

    r = api_client.post(
        f"{base_url}/api/orders/{order_id}/cancel",
        headers=headers,
        json={"reason": "found cheaper elsewhere"},
    )
    assert r.status_code == 200, r.text

    # At least 1 new buyer notification
    post = api_client.get(f"{base_url}/api/notifications", headers=headers).json()
    assert len(post) > pre_count
    cancel_n = [n for n in post if n["type"] == "order_cancelled"]
    assert cancel_n, "expected an order_cancelled notification for buyer"
    assert cancel_n[0]["order_id"] == order_id


def test_notifications_unread_count_and_read(api_client, base_url, fresh_user):
    headers = fresh_user["headers"]
    order_id = _make_paid_order(api_client, base_url, headers, fresh_user["user_id"])

    # Create a notification by cancelling
    api_client.post(f"{base_url}/api/orders/{order_id}/cancel", headers=headers, json={})

    r = api_client.get(f"{base_url}/api/notifications/unread-count", headers=headers)
    assert r.status_code == 200
    count_before = r.json()["unread"]
    assert count_before >= 1

    # Mark all as read
    r = api_client.post(f"{base_url}/api/notifications/read-all", headers=headers)
    assert r.status_code == 200

    r = api_client.get(f"{base_url}/api/notifications/unread-count", headers=headers)
    assert r.json()["unread"] == 0


def test_cancel_unauthenticated_401(api_client, base_url):
    r = api_client.post(f"{base_url}/api/orders/order_xyz/cancel", json={})
    assert r.status_code == 401


def test_cancel_others_order_404(api_client, base_url, fresh_user, auth_headers):
    # Create order with fresh_user
    headers = fresh_user["headers"]
    order_id = _make_paid_order(api_client, base_url, headers, fresh_user["user_id"])

    # Attempt cancel from a different authenticated user
    r = api_client.post(
        f"{base_url}/api/orders/{order_id}/cancel",
        headers=auth_headers,
        json={},
    )
    assert r.status_code == 404
