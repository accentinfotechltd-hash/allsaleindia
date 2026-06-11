"""Tests for the buyer Return Request flow + seller approve/reject."""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"

# A tiny base64-encoded PNG used as photo proof in tests. Any non-empty
# string is enough — the API only validates count + format prefix.
PROOF_PHOTO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _address():
    return {
        "full_name": "Return Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def _new_user(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_rtn_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"Return {label}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "email": email,
        "user_id": d["user"]["id"],
        "token": d["access_token"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {d['access_token']}",
        },
    }


def _register_seller(api_client, base_url, headers, user_id):
    """Directly flip the user to seller in Mongo (faster than going through
    the public /api/seller/register endpoint which expects a nested payload)."""

    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"is_seller": True, "seller_verification_status": "auto_verified"}},
        )
        # Generate a guaranteed-unique (GSTIN, PAN) pair via uuid.
        from _helpers import make_gstin_pan

        gstin, pan = make_gstin_pan()
        unique_suffix = user_id[-6:].upper()
        await db.sellers.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "business_type": "private_limited",
                    "company_name": f"Return Seller {unique_suffix}",
                    "gstin": gstin,
                    "pan": pan,
                    "address_line1": "10 Test Rd",
                    "city": "Mumbai",
                    "state": "Maharashtra",
                    "pincode": "400001",
                    "contact_name": "Tester",
                    "contact_phone": "+919811112222",
                    "verification_status": "auto_verified",
                    "created_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )
        cli.close()

    asyncio.run(go())


def _make_delivered_order(api_client, base_url, headers, user_id):
    """Create a paid+delivered order eligible for return."""
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

    async def force_delivered():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_id},
            {
                "$set": {
                    "status": "delivered",
                    "payment_status": "paid",
                    "delivered_at": datetime.now(timezone.utc) - timedelta(days=1),
                    "return_window_until": datetime.now(timezone.utc) + timedelta(days=6),
                }
            },
        )
        cli.close()

    asyncio.run(force_delivered())
    return order_id, p["id"], p.get("seller_id")


@pytest.fixture
def buyer_with_delivered_order(api_client, base_url):
    buyer = _new_user(api_client, base_url, "buyer")
    order_id, pid, sid = _make_delivered_order(api_client, base_url, buyer["headers"], buyer["user_id"])
    return {**buyer, "order_id": order_id, "product_id": pid, "seller_id": sid}


@pytest.fixture
def seller_for_order(api_client, base_url, buyer_with_delivered_order):
    """Promote a fresh user → seller, and link them as the seller of the buyer's product."""
    seller = _new_user(api_client, base_url, "seller")
    _register_seller(api_client, base_url, seller["headers"], seller["user_id"])

    # Re-point the product → this seller, and the order's item.seller_id too.
    async def relink():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.products.update_one(
            {"id": buyer_with_delivered_order["product_id"]},
            {"$set": {"seller_id": seller["user_id"], "seller_name": "Return Seller Co"}},
        )
        await db.orders.update_one(
            {"id": buyer_with_delivered_order["order_id"]},
            {"$set": {"items.$[elem].seller_id": seller["user_id"]}},
            array_filters=[{"elem.product_id": buyer_with_delivered_order["product_id"]}],
        )
        cli.close()

    asyncio.run(relink())
    return seller


# ---------------- buyer side -----------------------------------------------
def test_create_return_request_defective(api_client, base_url, buyer_with_delivered_order):
    body = {
        "order_id": buyer_with_delivered_order["order_id"],
        "reason": "defective",
        "note": "Stopped working on day 1",
        "photos": [PROOF_PHOTO],
    }
    r = api_client.post(f"{base_url}/api/returns/request", headers=buyer_with_delivered_order["headers"], json=body)
    assert r.status_code == 200, r.text
    items = r.json()
    assert items, "expected at least one return doc"
    rtn = items[0]
    assert rtn["status"] == "pending_seller"
    assert rtn["reason"] == "defective"
    assert rtn["buyer_pays_shipping"] is False
    assert rtn["restocking_fee_nzd"] == 0


def test_change_of_mind_has_restocking_fee(api_client, base_url, buyer_with_delivered_order):
    body = {
        "order_id": buyer_with_delivered_order["order_id"],
        "reason": "changed_my_mind",
    }
    r = api_client.post(f"{base_url}/api/returns/request", headers=buyer_with_delivered_order["headers"], json=body)
    assert r.status_code == 200, r.text
    rtn = r.json()[0]
    assert rtn["buyer_pays_shipping"] is True
    assert rtn["restocking_fee_nzd"] > 0
    # 15% of price
    gross = sum(i["price_nzd"] * i["quantity"] for i in rtn["items"])
    assert abs(rtn["restocking_fee_nzd"] - round(gross * 0.15, 2)) < 0.01
    assert abs(rtn["refund_amount_nzd"] - round(gross - rtn["restocking_fee_nzd"], 2)) < 0.01


def test_invalid_reason_400(api_client, base_url, buyer_with_delivered_order):
    body = {
        "order_id": buyer_with_delivered_order["order_id"],
        "reason": "i_just_dont_like_it",
    }
    r = api_client.post(f"{base_url}/api/returns/request", headers=buyer_with_delivered_order["headers"], json=body)
    assert r.status_code == 400


def test_return_outside_window_400(api_client, base_url, buyer_with_delivered_order):
    # Move return_window_until to the past
    async def expire():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": buyer_with_delivered_order["order_id"]},
            {"$set": {"return_window_until": datetime.now(timezone.utc) - timedelta(days=1)}},
        )
        cli.close()
    asyncio.run(expire())

    r = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    )
    assert r.status_code == 400
    assert "delivered within" in r.json()["detail"] or "eligible" in r.json()["detail"].lower()


def test_return_unauth(api_client, base_url):
    r = api_client.post(f"{base_url}/api/returns/request", json={"order_id": "x", "reason": "defective"})
    assert r.status_code == 401


def test_return_other_users_order(api_client, base_url, buyer_with_delivered_order, auth_headers):
    r = api_client.post(
        f"{base_url}/api/returns/request",
        headers=auth_headers,
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    )
    assert r.status_code == 404


# ---------------- listing & seller side ------------------------------------
def test_my_returns_lists(api_client, base_url, buyer_with_delivered_order):
    api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    )
    r = api_client.get(f"{base_url}/api/returns/me", headers=buyer_with_delivered_order["headers"])
    assert r.status_code == 200
    assert any(rt["order_id"] == buyer_with_delivered_order["order_id"] for rt in r.json())


def test_seller_returns_visibility(api_client, base_url, buyer_with_delivered_order, seller_for_order):
    api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    )
    r = api_client.get(f"{base_url}/api/seller/returns", headers=seller_for_order["headers"])
    assert r.status_code == 200, r.text
    assert any(rt["order_id"] == buyer_with_delivered_order["order_id"] for rt in r.json())


def test_seller_approve_creates_buyer_notification(
    api_client, base_url, buyer_with_delivered_order, seller_for_order
):
    rtn = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    ).json()[0]

    r = api_client.post(
        f"{base_url}/api/returns/{rtn['id']}/approve",
        headers=seller_for_order["headers"],
        json={"note": "Acknowledged — refunding"},
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["status"] in {"approved", "refunded"}

    notifs = api_client.get(f"{base_url}/api/notifications", headers=buyer_with_delivered_order["headers"]).json()
    assert any(n["type"] == "return_approved" for n in notifs)


def test_seller_reject_creates_buyer_notification(
    api_client, base_url, buyer_with_delivered_order, seller_for_order
):
    rtn = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "changed_my_mind"},
    ).json()[0]

    r = api_client.post(
        f"{base_url}/api/returns/{rtn['id']}/reject",
        headers=seller_for_order["headers"],
        json={"note": "Item is in non-returnable condition"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"

    notifs = api_client.get(f"{base_url}/api/notifications", headers=buyer_with_delivered_order["headers"]).json()
    rej = [n for n in notifs if n["type"] == "return_rejected"]
    assert rej and "non-returnable" in (rej[0]["body"] or "").lower()


def test_cannot_double_decide(api_client, base_url, buyer_with_delivered_order, seller_for_order):
    rtn = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    ).json()[0]
    api_client.post(
        f"{base_url}/api/returns/{rtn['id']}/approve",
        headers=seller_for_order["headers"],
        json={},
    )
    r = api_client.post(
        f"{base_url}/api/returns/{rtn['id']}/reject",
        headers=seller_for_order["headers"],
        json={},
    )
    assert r.status_code == 400


def test_seller_cannot_decide_others_return(
    api_client, base_url, buyer_with_delivered_order, seller_for_order
):
    rtn = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    ).json()[0]

    # A fresh different seller
    other = _new_user(api_client, base_url, "seller2")
    _register_seller(api_client, base_url, other["headers"], other["user_id"])

    r = api_client.post(
        f"{base_url}/api/returns/{rtn['id']}/approve",
        headers=other["headers"],
        json={},
    )
    assert r.status_code == 404


def test_returns_for_order_visibility(api_client, base_url, buyer_with_delivered_order, seller_for_order):
    api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective", "photos": [PROOF_PHOTO]},
    )
    # Buyer sees their returns
    r = api_client.get(
        f"{base_url}/api/returns/order/{buyer_with_delivered_order['order_id']}",
        headers=buyer_with_delivered_order["headers"],
    )
    assert r.status_code == 200
    assert len(r.json()) >= 1


# ---------------- photo proof validation -----------------------------------
def test_seller_paid_reason_without_photos_400(api_client, base_url, buyer_with_delivered_order):
    """damaged/wrong/defective/not_as_described REQUIRE >=1 photo."""
    r = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "defective"},
    )
    assert r.status_code == 400
    assert "photo" in r.json()["detail"].lower()


def test_change_of_mind_without_photos_ok(api_client, base_url, buyer_with_delivered_order):
    """changed_my_mind keeps photos optional."""
    r = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={"order_id": buyer_with_delivered_order["order_id"], "reason": "changed_my_mind"},
    )
    assert r.status_code == 200


def test_max_photos_enforced(api_client, base_url, buyer_with_delivered_order):
    """API rejects > 4 photos with 400."""
    r = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={
            "order_id": buyer_with_delivered_order["order_id"],
            "reason": "defective",
            "photos": [PROOF_PHOTO] * 5,
        },
    )
    assert r.status_code == 400
    assert "maximum" in r.json()["detail"].lower() or "4" in r.json()["detail"]


def test_seller_sees_proof_photos(api_client, base_url, buyer_with_delivered_order, seller_for_order):
    """Submitted proof URLs reach the seller-side endpoint as `photos`."""
    submit = api_client.post(
        f"{base_url}/api/returns/request",
        headers=buyer_with_delivered_order["headers"],
        json={
            "order_id": buyer_with_delivered_order["order_id"],
            "reason": "damaged_on_arrival",
            "photos": [PROOF_PHOTO, PROOF_PHOTO],
        },
    )
    assert submit.status_code == 200, submit.text
    r = api_client.get(f"{base_url}/api/seller/returns", headers=seller_for_order["headers"])
    assert r.status_code == 200
    match = [rt for rt in r.json() if rt["order_id"] == buyer_with_delivered_order["order_id"]]
    assert match and len(match[0]["photos"]) == 2
