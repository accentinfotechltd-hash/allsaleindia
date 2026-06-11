"""Tests for the Shiprocket webhook + tracking endpoint."""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def _address():
    return {
        "full_name": "Webhook Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


@pytest.fixture
def fresh_user_with_paid_order(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_ship_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Webhook Tester"},
    )
    assert r.status_code == 200
    data = r.json()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {data['access_token']}",
    }
    user_id = data["user"]["id"]

    # Add a product to cart + create checkout
    products = api_client.get(f"{base_url}/api/products").json()
    api_client.post(
        f"{base_url}/api/cart",
        headers=headers,
        json={"product_id": products[0]["id"], "quantity": 1},
    )
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=headers,
        json={"address": _address(), "origin_url": base_url},
    )
    order_id = r.json()["order_id"]

    # Mark paid + create shipment via Mongo (Stripe webhook would do this)
    async def setup():
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
        # Create shipment doc
        awb = f"SR_TEST_{suffix}"
        await db.shipments.insert_one(
            {
                "id": f"shp_test_{suffix}",
                "order_id": order_id,
                "user_id": user_id,
                "carrier": "Shiprocket X",
                "awb_code": awb,
                "tracking_url": f"https://shiprocket.co/tracking/{awb}",
                "status": "label_created",
                "estimated_delivery": "12-18 Jun 2026",
                "is_mocked": False,
                "created_at": datetime.now(timezone.utc),
            }
        )
        await db.orders.update_one({"id": order_id}, {"$set": {"awb_code": awb}})
        cli.close()
        return awb

    awb = asyncio.run(setup())
    return {"headers": headers, "order_id": order_id, "awb": awb, "user_id": user_id}


def test_webhook_requires_awb(api_client, base_url):
    r = api_client.post(f"{base_url}/api/shiprocket/webhook", json={"current_status": "Shipped"})
    assert r.status_code == 400
    assert "awb" in r.json()["detail"].lower()


def test_webhook_invalid_json(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        headers={"Content-Type": "application/json"},
        data="not-json",
    )
    assert r.status_code == 400


def test_webhook_unknown_awb_404(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": "DOES_NOT_EXIST", "current_status": "Shipped"},
    )
    assert r.status_code == 404


def test_webhook_shipped_transitions_order(api_client, base_url, fresh_user_with_paid_order):
    setup = fresh_user_with_paid_order
    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status": "Shipped"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["order_status"] == "shipped"

    # Now fetch the order and verify status flipped
    o = api_client.get(f"{base_url}/api/orders/{setup['order_id']}", headers=setup["headers"]).json()
    assert o["status"] == "shipped"

    # Should have created an order_shipped notification
    notifs = api_client.get(f"{base_url}/api/notifications", headers=setup["headers"]).json()
    shipped = [n for n in notifs if n["type"] == "order_shipped"]
    assert shipped, "expected order_shipped notification"


def test_webhook_status_id_mapping(api_client, base_url, fresh_user_with_paid_order):
    setup = fresh_user_with_paid_order
    # status_id 18 → out_for_delivery
    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status_id": 18, "current_status": "Out for Delivery"},
    )
    assert r.status_code == 200
    assert r.json()["order_status"] == "out_for_delivery"


def test_webhook_full_lifecycle(api_client, base_url, fresh_user_with_paid_order):
    """paid → shipped → out_for_delivery → delivered."""
    setup = fresh_user_with_paid_order
    for status in ["Shipped", "Out for Delivery", "Delivered"]:
        r = api_client.post(
            f"{base_url}/api/shiprocket/webhook",
            json={"awb": setup["awb"], "current_status": status},
        )
        assert r.status_code == 200, f"{status} -> {r.text}"

    o = api_client.get(f"{base_url}/api/orders/{setup['order_id']}", headers=setup["headers"]).json()
    assert o["status"] == "delivered"

    # Three transition notifications
    notifs = api_client.get(f"{base_url}/api/notifications", headers=setup["headers"]).json()
    types = {n["type"] for n in notifs}
    assert "order_shipped" in types
    assert "order_out_for_delivery" in types
    assert "order_delivered" in types


def test_webhook_idempotent_same_status(api_client, base_url, fresh_user_with_paid_order):
    setup = fresh_user_with_paid_order
    api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status": "Delivered"},
    )
    # Sending Delivered again should not error and not double-notify.
    notifs1 = api_client.get(f"{base_url}/api/notifications", headers=setup["headers"]).json()
    n_count1 = len([n for n in notifs1 if n["type"] == "order_delivered"])

    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status": "Delivered"},
    )
    assert r.status_code == 200
    notifs2 = api_client.get(f"{base_url}/api/notifications", headers=setup["headers"]).json()
    n_count2 = len([n for n in notifs2 if n["type"] == "order_delivered"])
    assert n_count1 == n_count2, "delivered notification should not duplicate on replay"


def test_webhook_unknown_status_returns_200_no_change(api_client, base_url, fresh_user_with_paid_order):
    setup = fresh_user_with_paid_order
    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status": "Some New Status We Have Not Mapped"},
    )
    assert r.status_code == 200
    assert r.json().get("ignored") is True

    o = api_client.get(f"{base_url}/api/orders/{setup['order_id']}", headers=setup["headers"]).json()
    assert o["status"] == "paid"  # unchanged


def test_order_shipment_endpoint(api_client, base_url, fresh_user_with_paid_order):
    setup = fresh_user_with_paid_order
    r = api_client.get(
        f"{base_url}/api/orders/{setup['order_id']}/shipment",
        headers=setup["headers"],
    )
    assert r.status_code == 200
    body = r.json()
    assert body["awb_code"] == setup["awb"]
    assert "shiprocket.co/tracking" in body["tracking_url"]


def test_order_shipment_endpoint_404_other_user(api_client, base_url, fresh_user_with_paid_order, auth_headers):
    setup = fresh_user_with_paid_order
    r = api_client.get(
        f"{base_url}/api/orders/{setup['order_id']}/shipment",
        headers=auth_headers,
    )
    assert r.status_code == 404


def test_webhook_does_not_regress_delivered_order(api_client, base_url, fresh_user_with_paid_order):
    setup = fresh_user_with_paid_order
    api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status": "Delivered"},
    )
    # Now try to flip back to 'Shipped' — order should stay delivered.
    r = api_client.post(
        f"{base_url}/api/shiprocket/webhook",
        json={"awb": setup["awb"], "current_status": "Shipped"},
    )
    assert r.status_code == 200
    o = api_client.get(
        f"{base_url}/api/orders/{setup['order_id']}", headers=setup["headers"]
    ).json()
    assert o["status"] == "delivered"
