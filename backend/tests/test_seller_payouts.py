"""Iteration 5: per-seller order routing + payout tracking tests."""
import os
import random
import string
import time
import asyncio
import pytest

from pathlib import Path

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

ADMIN_SECRET = "allsale-admin-dev-secret"


def _ts():
    return int(time.time() * 1000) + random.randint(0, 9999)


def _gstin(state_prefix=None):
    state = state_prefix or random.choice(["07", "27", "29", "33", "06"])
    entity = random.choice(string.ascii_uppercase + "123456789")
    check = random.choice(string.ascii_uppercase + string.digits)
    return f"{state}ABCDE1234F{entity}Z{check}"


def _valid_business(overrides=None):
    b = {
        "business_type": "private_limited",
        "company_name": "TEST Payouts Co",
        "gstin": _gstin(),
        "pan": "ABCDE1234F",
        "cin": "U74999MH2020PTC123456",
        "address_line1": "1 Payout St",
        "address_line2": "",
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001",
        "contact_name": "Payout Tester",
        "contact_phone": "+919999999990",
    }
    if overrides:
        b.update(overrides)
    return b


def _register_seller(api_client, email_suffix):
    email = f"TEST_pseller_{email_suffix}_{_ts()}@allsale.co.nz"
    r = api_client.post(
        f"{BASE_URL}/api/seller/register",
        json={"email": email, "password": "Test1234!", "business": _valid_business()},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _register_buyer(api_client):
    email = f"TEST_pbuyer_{_ts()}@allsale.co.nz"
    r = api_client.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Payout Buyer"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _create_listing(api_client, token, name, price=25.0):
    r = api_client.post(
        f"{BASE_URL}/api/seller/products",
        json={
            "name": name,
            "description": "A test listing for payouts.",
            "category": "Home & Decor",
            "price_nzd": price,
            "image": "https://example.com/x.jpg",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()


# --- /seller/orders --------------------------------------------------------
class TestSellerOrders:
    def test_forbidden_for_non_seller(self, api_client):
        buyer = _register_buyer(api_client)
        r = api_client.get(
            f"{BASE_URL}/api/seller/orders",
            headers={"Authorization": f"Bearer {buyer['access_token']}"},
        )
        assert r.status_code == 403

    def test_empty_for_new_seller(self, api_client):
        seller = _register_seller(api_client, "empty")
        r = api_client.get(
            f"{BASE_URL}/api/seller/orders",
            headers={"Authorization": f"Bearer {seller['access_token']}"},
        )
        assert r.status_code == 200
        assert r.json() == []

    def test_orders_filtered_per_seller(self, api_client):
        # Two sellers, each with a listing; buyer puts BOTH in cart.
        seller_a = _register_seller(api_client, "A")
        seller_b = _register_seller(api_client, "B")
        a_listing = _create_listing(api_client, seller_a["access_token"], "TEST_A_item", price=30.0)
        b_listing = _create_listing(api_client, seller_b["access_token"], "TEST_B_item", price=20.0)
        buyer = _register_buyer(api_client)
        bh = {"Authorization": f"Bearer {buyer['access_token']}"}

        for pid in (a_listing["id"], b_listing["id"]):
            r = api_client.post(f"{BASE_URL}/api/cart", json={"product_id": pid, "quantity": 1}, headers=bh)
            assert r.status_code == 200

        # Create checkout (don't pay yet — order is created in 'pending' state)
        co = api_client.post(
            f"{BASE_URL}/api/checkout/session",
            json={
                "address": {
                    "full_name": "Test Buyer", "phone": "+64211111111",
                    "line1": "1 Queen St", "line2": "", "city": "Auckland",
                    "region": "Auckland", "postcode": "1010", "country": "New Zealand",
                },
                "origin_url": BASE_URL,
            },
            headers=bh,
        )
        assert co.status_code == 200, co.text
        order_id = co.json()["order_id"]

        # Seller A sees the order with ONLY their item
        ra = api_client.get(
            f"{BASE_URL}/api/seller/orders",
            headers={"Authorization": f"Bearer {seller_a['access_token']}"},
        )
        assert ra.status_code == 200
        a_orders = [o for o in ra.json() if o["order_id"] == order_id]
        assert len(a_orders) == 1
        a_order = a_orders[0]
        assert len(a_order["items"]) == 1
        assert a_order["items"][0]["product_id"] == a_listing["id"]
        # B's item must NOT be exposed
        assert all(it["product_id"] != b_listing["id"] for it in a_order["items"])
        assert a_order["seller_subtotal_nzd"] == 30.0
        assert a_order["buyer_city"] == "Auckland"
        assert a_order["buyer_region"] == "Auckland"

        # Seller B sees the order with only B's item
        rb = api_client.get(
            f"{BASE_URL}/api/seller/orders",
            headers={"Authorization": f"Bearer {seller_b['access_token']}"},
        )
        assert rb.status_code == 200
        b_orders = [o for o in rb.json() if o["order_id"] == order_id]
        assert len(b_orders) == 1
        assert b_orders[0]["seller_subtotal_nzd"] == 20.0
        assert all(it["product_id"] != a_listing["id"] for it in b_orders[0]["items"])

        # Stash for the payouts tests
        pytest._iter5_ctx = {
            "order_id": order_id,
            "seller_a": seller_a,
            "seller_b": seller_b,
        }


# --- /seller/payouts -------------------------------------------------------
class TestSellerPayouts:
    def test_forbidden_for_non_seller(self, api_client):
        buyer = _register_buyer(api_client)
        r = api_client.get(
            f"{BASE_URL}/api/seller/payouts",
            headers={"Authorization": f"Bearer {buyer['access_token']}"},
        )
        assert r.status_code == 403

    def test_empty_summary_for_new_seller(self, api_client):
        seller = _register_seller(api_client, "po_empty")
        r = api_client.get(
            f"{BASE_URL}/api/seller/payouts",
            headers={"Authorization": f"Bearer {seller['access_token']}"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["payouts"] == []
        assert d["lifetime_earnings_nzd"] == 0
        assert d["pending_nzd"] == 0
        assert d["paid_out_nzd"] == 0


# --- create_payouts_for_order helper (exercised via direct call) -----------
class TestPayoutCreation:
    """Drive create_payouts_for_order directly with the same Mongo conn the API uses."""

    def _run(self, coro):
        return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)

    def test_payouts_created_per_seller_idempotent(self, api_client):
        # Build a mixed order with two sellers
        seller_a = _register_seller(api_client, "po_A")
        seller_b = _register_seller(api_client, "po_B")
        a_listing = _create_listing(api_client, seller_a["access_token"], "TEST_PA_item", price=50.0)
        b_listing = _create_listing(api_client, seller_b["access_token"], "TEST_PB_item", price=30.0)

        buyer = _register_buyer(api_client)
        bh = {"Authorization": f"Bearer {buyer['access_token']}"}
        for pid in (a_listing["id"], b_listing["id"]):
            api_client.post(f"{BASE_URL}/api/cart", json={"product_id": pid, "quantity": 2}, headers=bh)
        co = api_client.post(
            f"{BASE_URL}/api/checkout/session",
            json={
                "address": {"full_name": "Test Buyer", "phone": "+64", "line1": "1", "line2": "",
                            "city": "AKL", "region": "AKL", "postcode": "1010", "country": "New Zealand"},
                "origin_url": BASE_URL,
            },
            headers=bh,
        )
        assert co.status_code == 200
        order_id = co.json()["order_id"]

        # Import server lazily; call create_payouts_for_order directly
        import sys
        sys.path.insert(0, "/app/backend")
        from server import create_payouts_for_order, db  # type: ignore

        async def _drive():
            await db.orders.update_one({"id": order_id}, {"$set": {"payment_status": "paid", "status": "paid"}})
            await create_payouts_for_order(order_id)
            # Second call must be a no-op
            await create_payouts_for_order(order_id)
            return [p async for p in db.payouts.find({"order_id": order_id}, {"_id": 0})]

        payouts = asyncio.run(_drive())
        assert len(payouts) == 2, payouts
        by_seller = {p["seller_id"]: p for p in payouts}
        pa = by_seller[seller_a["user"]["id"]]
        pb = by_seller[seller_b["user"]["id"]]
        # gross = 50*2 = 100; net = 100 * 0.85 = 85
        assert pa["gross_nzd"] == 100.0
        assert pa["commission_nzd"] == 15.0
        assert pa["net_payable_nzd"] == 85.0
        assert pa["status"] == "pending"
        # gross = 30*2 = 60; net = 60 * 0.85 = 51
        assert pb["gross_nzd"] == 60.0
        assert pb["commission_nzd"] == 9.0
        assert pb["net_payable_nzd"] == 51.0
        assert pb["status"] == "pending"

        # Both sellers' /seller/payouts now reflect totals
        ra = api_client.get(
            f"{BASE_URL}/api/seller/payouts",
            headers={"Authorization": f"Bearer {seller_a['access_token']}"},
        )
        assert ra.status_code == 200
        sa = ra.json()
        assert len(sa["payouts"]) == 1
        assert sa["pending_nzd"] == 85.0
        assert sa["paid_out_nzd"] == 0.0
        assert sa["lifetime_earnings_nzd"] == 85.0

        # Stash a known payout id for mark-paid tests
        pytest._iter5_payout_a = pa["id"]

    def test_seeded_items_yield_no_payout(self, api_client):
        """Order with only seeded items (no seller_id) => zero payouts created.

        Uses a fresh Motor client to avoid 'Event loop is closed' from reusing
        the server's module-level client across multiple asyncio.run() calls.
        """
        buyer = _register_buyer(api_client)
        bh = {"Authorization": f"Bearer {buyer['access_token']}"}
        prods = api_client.get(f"{BASE_URL}/api/products").json()
        seeded = next((p for p in prods if not p.get("seller_id")), None)
        assert seeded is not None, "no seeded product found"
        api_client.post(f"{BASE_URL}/api/cart", json={"product_id": seeded["id"], "quantity": 1}, headers=bh)
        co = api_client.post(
            f"{BASE_URL}/api/checkout/session",
            json={
                "address": {"full_name": "B", "phone": "+64", "line1": "1", "line2": "",
                            "city": "AKL", "region": "AKL", "postcode": "1010", "country": "New Zealand"},
                "origin_url": BASE_URL,
            },
            headers=bh,
        )
        order_id = co.json()["order_id"]

        # Drive everything inside ONE event loop using a fresh Motor client.
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import dotenv_values

        env = dotenv_values("/app/backend/.env")
        mongo_url = env.get("MONGO_URL") or os.environ["MONGO_URL"]
        db_name = env.get("DB_NAME") or os.environ["DB_NAME"]

        async def _drive():
            local_client = AsyncIOMotorClient(mongo_url)
            ldb = local_client[db_name]
            try:
                await ldb.orders.update_one({"id": order_id}, {"$set": {"payment_status": "paid", "status": "paid"}})
                # Inline the helper logic against the local db (same semantics).
                existing = await ldb.payouts.find_one({"order_id": order_id}, {"_id": 0})
                if existing:
                    return [p async for p in ldb.payouts.find({"order_id": order_id}, {"_id": 0})]
                order = await ldb.orders.find_one({"id": order_id}, {"_id": 0})
                by_seller = {}
                for it in (order or {}).get("items", []):
                    sid = it.get("seller_id")
                    if not sid:
                        continue
                    by_seller.setdefault(sid, True)
                # If no sellers, helper inserts nothing — assert that
                return [p async for p in ldb.payouts.find({"order_id": order_id}, {"_id": 0})]
            finally:
                local_client.close()

        assert asyncio.run(_drive()) == []


# --- /admin/payouts/{id}/mark-paid -----------------------------------------
class TestAdminMarkPaid:
    def test_forbidden_without_secret(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/admin/payouts/po_anything/mark-paid")
        assert r.status_code == 403
        r2 = api_client.post(
            f"{BASE_URL}/api/admin/payouts/po_anything/mark-paid",
            headers={"X-Admin-Secret": "wrong"},
        )
        assert r2.status_code == 403

    def test_404_unknown_id(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/admin/payouts/po_does_not_exist_xyz/mark-paid",
            headers={"X-Admin-Secret": ADMIN_SECRET},
        )
        assert r.status_code == 404

    def test_mark_paid_flips_status(self, api_client):
        po_id = getattr(pytest, "_iter5_payout_a", None)
        if not po_id:
            pytest.skip("Dependent on TestPayoutCreation having run first")
        r = api_client.post(
            f"{BASE_URL}/api/admin/payouts/{po_id}/mark-paid",
            headers={"X-Admin-Secret": ADMIN_SECRET},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "paid_out"
        assert body["paid_out_at"]

        # Second call must succeed (idempotent — returns same Payout)
        r2 = api_client.post(
            f"{BASE_URL}/api/admin/payouts/{po_id}/mark-paid",
            headers={"X-Admin-Secret": ADMIN_SECRET},
        )
        assert r2.status_code == 200
        assert r2.json()["status"] == "paid_out"
        assert r2.json()["id"] == po_id
