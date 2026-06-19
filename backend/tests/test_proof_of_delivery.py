"""Tests for the Phase 1.5 seller proof-of-delivery upload flow.

Covers:
- POST /api/seller/orders/{id}/proof-of-delivery — happy path, status promotion,
  carrier-wins guard, non-seller 403, foreign-order 403, validation.
- Carrier-provided pod_url captured by Shiprocket webhook (test_shiprocket_webhook
  already covers webhook flow, this tests the schema field flow).
- Tracking endpoint exposes proof_of_delivery.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"
DATA_URI = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _address():
    return {
        "full_name": "POD Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def _new_user(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_pod_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"POD {label}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "user_id": d["user"]["id"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {d['access_token']}",
        },
    }


def _promote_to_seller(user_id):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.users.update_one(
            {"id": user_id}, {"$set": {"is_seller": True}}
        )
        cli.close()
    asyncio.run(go())


def _make_order_with_seller(api_client, base_url, buyer_headers, seller_id):
    products = api_client.get(f"{base_url}/api/products").json()
    p = next((x for x in products if x.get("in_stock") and (x.get("stock_count") or 0) > 5), products[0])
    api_client.post(
        f"{base_url}/api/cart", headers=buyer_headers,
        json={"product_id": p["id"], "quantity": 1},
    )
    r = api_client.post(
        f"{base_url}/api/checkout/session", headers=buyer_headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 200, r.text
    order_id = r.json()["order_id"]

    async def link():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "items.0.seller_id": seller_id,
                "status": "out_for_delivery",
                "payment_status": "paid",
            }},
        )
        cli.close()
    asyncio.run(link())
    return order_id, p["id"]


@pytest.fixture
def seller(api_client, base_url):
    s = _new_user(api_client, base_url, "seller")
    _promote_to_seller(s["user_id"])
    return s


@pytest.fixture
def buyer(api_client, base_url):
    return _new_user(api_client, base_url, "buyer")


@pytest.fixture
def order_with_seller(api_client, base_url, buyer, seller):
    oid, pid = _make_order_with_seller(api_client, base_url, buyer["headers"], seller["user_id"])
    return {"order_id": oid, "product_id": pid, "buyer": buyer, "seller": seller}


def test_seller_can_upload_proof_promotes_to_delivered(api_client, base_url, order_with_seller):
    r = api_client.post(
        f"{base_url}/api/seller/orders/{order_with_seller['order_id']}/proof-of-delivery",
        headers=order_with_seller["seller"]["headers"],
        json={"image": DATA_URI, "note": "Left at the front door"},
    )
    assert r.status_code == 200, r.text
    proof = r.json()
    assert proof["uploaded_by"] == "seller"
    assert proof["image"] == DATA_URI
    assert proof["note"] == "Left at the front door"
    # Order should have been promoted to delivered + tracking exposes it
    t = api_client.get(
        f"{base_url}/api/orders/{order_with_seller['order_id']}/tracking",
        headers=order_with_seller["buyer"]["headers"],
    ).json()
    assert t["status"] == "delivered"
    assert t["progress_pct"] == 100
    assert t["proof_of_delivery"]["uploaded_by"] == "seller"


def test_proof_rejects_non_seller(api_client, base_url, order_with_seller):
    intruder = _new_user(api_client, base_url, "intruder")
    r = api_client.post(
        f"{base_url}/api/seller/orders/{order_with_seller['order_id']}/proof-of-delivery",
        headers=intruder["headers"],
        json={"image": DATA_URI},
    )
    # Not a seller at all → 403
    assert r.status_code == 403


def test_proof_rejects_different_seller(api_client, base_url, order_with_seller):
    other = _new_user(api_client, base_url, "other_seller")
    _promote_to_seller(other["user_id"])
    r = api_client.post(
        f"{base_url}/api/seller/orders/{order_with_seller['order_id']}/proof-of-delivery",
        headers=other["headers"],
        json={"image": DATA_URI},
    )
    assert r.status_code == 403


def test_proof_rejects_invalid_image_format(api_client, base_url, order_with_seller):
    r = api_client.post(
        f"{base_url}/api/seller/orders/{order_with_seller['order_id']}/proof-of-delivery",
        headers=order_with_seller["seller"]["headers"],
        json={"image": "not-a-valid-image"},
    )
    assert r.status_code == 400


def test_proof_rejects_when_carrier_already_provided(api_client, base_url, order_with_seller):
    # Seed a carrier pod
    async def seed():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_with_seller["order_id"]},
            {"$set": {
                "status": "delivered",
                "delivered_at": datetime.now(timezone.utc),
                "proof_of_delivery": {
                    "image": "https://shiprocket.co/pod/x.jpg",
                    "uploaded_by": "carrier",
                    "uploaded_at": datetime.now(timezone.utc),
                },
            }},
        )
        cli.close()
    asyncio.run(seed())

    r = api_client.post(
        f"{base_url}/api/seller/orders/{order_with_seller['order_id']}/proof-of-delivery",
        headers=order_with_seller["seller"]["headers"],
        json={"image": DATA_URI},
    )
    assert r.status_code == 409


def test_proof_rejects_pre_dispatch(api_client, base_url, order_with_seller):
    # Reset order to "paid"
    async def reset():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_with_seller["order_id"]},
            {"$set": {"status": "paid"}, "$unset": {"proof_of_delivery": ""}},
        )
        cli.close()
    asyncio.run(reset())

    r = api_client.post(
        f"{base_url}/api/seller/orders/{order_with_seller['order_id']}/proof-of-delivery",
        headers=order_with_seller["seller"]["headers"],
        json={"image": DATA_URI},
    )
    assert r.status_code == 400
