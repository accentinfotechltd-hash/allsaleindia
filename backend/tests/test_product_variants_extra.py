"""Iter-10 follow-on coverage: PUT cart quantity-check, stock decrement on
payment, idempotency, restock on cancel, sizes-cap, seeded saree variants."""
import asyncio
import time
from datetime import datetime, timezone, timedelta

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


# ---------- helpers (mirroring test_product_variants.py patterns) ----------
def _new_user(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_stk2_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Stock Tester"},
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


def _promote_seller(user_id: str):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        suffix = user_id[-6:].upper()
        from _helpers import make_gstin_pan

        _gstin_pan = make_gstin_pan()
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"is_seller": True, "seller_verification_status": "auto_verified"}},
        )
        await db.sellers.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "business_type": "private_limited",
                    "company_name": f"Stock Seller {suffix}",
                    "gstin": _gstin_pan[0],
                    "pan": _gstin_pan[1],
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


def _make_listing(api_client, base_url, headers, user_id, **overrides):
    _promote_seller(user_id)
    body = {
        "name": overrides.get("name", "TEST stk2 listing"),
        "description": "A great test listing with plenty of description text.",
        "category": "Fashion",
        "price_nzd": 30.0,
        "image": "https://images.unsplash.com/photo-x",
        **overrides,
    }
    r = api_client.post(f"{base_url}/api/seller/products", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. PUT /api/cart/{pid} guards stock ----------
def test_put_cart_blocked_when_quantity_over_stock(api_client, base_url):
    seller = _new_user(api_client, base_url)
    p = _make_listing(
        api_client,
        base_url,
        seller["headers"],
        seller["user_id"],
        name="TEST put-cart over-stock",
        stock_count=3,
    )
    buyer = _new_user(api_client, base_url)
    # Add 1 first
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=buyer["headers"],
        json={"product_id": p["id"], "quantity": 1},
    )
    assert r.status_code == 200, r.text
    # PUT quantity=5 (over stock=3) — should be 400
    r = api_client.put(
        f"{base_url}/api/cart/{p['id']}",
        headers=buyer["headers"],
        json={"quantity": 5},
    )
    assert r.status_code == 400, r.text
    detail = r.json()["detail"].lower()
    assert "available" in detail or "stock" in detail


def test_put_cart_zero_stock_returns_400(api_client, base_url):
    """Even if PUT quantity is small, OOS product cannot have its cart row touched."""
    seller = _new_user(api_client, base_url)
    p = _make_listing(
        api_client,
        base_url,
        seller["headers"],
        seller["user_id"],
        name="TEST put-cart oos",
        stock_count=2,
    )
    buyer = _new_user(api_client, base_url)
    api_client.post(
        f"{base_url}/api/cart",
        headers=buyer["headers"],
        json={"product_id": p["id"], "quantity": 1},
    )
    # Flip product to OOS directly
    async def oos():
        cli = AsyncIOMotorClient(MONGO_URL)
        await cli[DB_NAME].products.update_one(
            {"id": p["id"]}, {"$set": {"stock_count": 0, "in_stock": False}}
        )
        cli.close()

    asyncio.run(oos())
    r = api_client.put(
        f"{base_url}/api/cart/{p['id']}",
        headers=buyer["headers"],
        json={"quantity": 1},
    )
    assert r.status_code == 400, r.text
    assert "out of stock" in r.json()["detail"].lower()


# ---------- 2. Sizes capped at 12 ----------
def test_sizes_capped_at_12(api_client, base_url):
    user = _new_user(api_client, base_url)
    p = _make_listing(
        api_client,
        base_url,
        user["headers"],
        user["user_id"],
        name="TEST cap sizes",
        sizes=[f"S{i}" for i in range(25)],
    )
    assert len(p["sizes"]) == 12


# ---------- 3. Seeded Saree has expected variants ----------
def test_seeded_saree_has_colors_sizes_and_stock(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products")
    assert r.status_code == 200
    products = r.json()
    sarees = [
        p for p in products
        if "saree" in (p.get("name") or "").lower()
        and p.get("seller_id") is None  # seeded only
    ]
    assert sarees, "expected at least one seeded saree"
    s = sarees[0]
    assert isinstance(s.get("colors"), list) and len(s["colors"]) >= 1
    # iter-10 spec: Saree colors=['Indigo','Maroon','Saffron','Emerald']
    colors_lc = [c.lower() for c in s["colors"]]
    for expected in ("indigo", "maroon", "saffron", "emerald"):
        assert expected in colors_lc, f"missing color {expected} in {s['colors']}"
    assert s.get("sizes") == ["Free Size"] or "Free Size" in (s.get("sizes") or [])
    assert isinstance(s.get("stock_count"), int) and s["stock_count"] >= 0
    assert s.get("in_stock") is True


# ---------- 4. decrement_stock_for_order is idempotent + restock helper ----------
def test_decrement_and_restock_helpers_idempotent():
    """Combined: directly seed a product + order in Mongo, exercise the
    decrement helper (twice — idempotent), then the restock helper (twice —
    idempotent). Single test to avoid Motor + asyncio.run() event-loop
    aliasing between tests when server.db is reused across loops.
    """
    async def go():
        import sys
        sys.path.insert(0, "/app/backend")
        from server import decrement_stock_for_order, restock_for_order  # type: ignore

        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        suffix = str(int(time.time() * 1000))
        pid = f"TEST_p_{suffix}"
        oid = f"TEST_o_{suffix}"
        await db.products.insert_one({
            "id": pid,
            "name": "TEST decrement product",
            "price_nzd": 10.0,
            "category": "Fashion",
            "image": "x",
            "in_stock": True,
            "stock_count": 10,
            "colors": [], "sizes": [],
        })
        await db.orders.insert_one({
            "id": oid,
            "user_id": "TEST_buyer",
            "status": "paid",
            "payment_status": "paid",
            "items": [{"product_id": pid, "quantity": 3, "seller_id": None}],
        })

        # Decrement
        await decrement_stock_for_order(oid)
        p1 = await db.products.find_one({"id": pid})
        assert p1["stock_count"] == 7

        # Double-call — must NOT double-debit (stock_decremented flag)
        await decrement_stock_for_order(oid)
        p2 = await db.products.find_one({"id": pid})
        assert p2["stock_count"] == 7

        o1 = await db.orders.find_one({"id": oid})
        assert o1.get("stock_decremented") is True

        # Restock (cancel path)
        await restock_for_order(oid)
        p3 = await db.products.find_one({"id": pid})
        assert p3["stock_count"] == 10
        assert p3["in_stock"] is True

        # Double-restock — idempotent
        await restock_for_order(oid)
        p4 = await db.products.find_one({"id": pid})
        assert p4["stock_count"] == 10

        o2 = await db.orders.find_one({"id": oid})
        assert o2.get("stock_restocked") is True

        # Cleanup
        await db.products.delete_one({"id": pid})
        await db.orders.delete_one({"id": oid})
        cli.close()

    asyncio.run(go())


# ---------- 5. Restock via /api/orders/{id}/cancel ----------
def test_cancel_endpoint_restocks_product(api_client, base_url):
    """Drive the cancel route end-to-end: seed an order in 'paid' state with
    a fresh seller product (stock_count=5, decremented to 3), call
    /api/orders/{id}/cancel as the buyer, and verify product stock returns
    to 5 + in_stock=true."""
    seller = _new_user(api_client, base_url)
    p = _make_listing(
        api_client,
        base_url,
        seller["headers"],
        seller["user_id"],
        name="TEST cancel-restock",
        stock_count=5,
    )

    buyer = _new_user(api_client, base_url)

    async def seed_paid_order():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        oid = f"TEST_ord_cancel_{int(time.time()*1000)}"
        now = datetime.now(timezone.utc)
        await db.orders.insert_one({
            "id": oid,
            "user_id": buyer["user_id"],
            "items": [{
                "product_id": p["id"],
                "quantity": 2,
                "seller_id": seller["user_id"],
                "price_nzd": 30.0,
                "name": p["name"],
                "image": "https://images.unsplash.com/photo-x",
            }],
            "subtotal_nzd": 60.0,
            "shipping_nzd": 0.0,
            "total_nzd": 60.0,
            "address": {
                "full_name": "TEST Buyer",
                "phone": "+64211111111",
                "line1": "1 Test St",
                "city": "Auckland",
                "region": "Auckland",
                "postcode": "1010",
                "country": "NZ",
            },
            "status": "paid",
            "payment_status": "paid",
            "paid_at": now,
            "cancellable_until": now + timedelta(hours=12),
            "created_at": now,
            "estimated_delivery": "12-18 Mar 2026",
        })
        # Manually decrement (simulating paid pipeline)
        await db.products.update_one({"id": p["id"]}, {"$set": {"stock_count": 3}})
        await db.orders.update_one({"id": oid}, {"$set": {"stock_decremented": True}})
        cli.close()
        return oid

    oid = asyncio.run(seed_paid_order())

    # Buyer cancels within window
    r = api_client.post(
        f"{base_url}/api/orders/{oid}/cancel",
        headers=buyer["headers"],
        json={"reason": "Changed my mind"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "cancelled"

    # Verify product re-stocked
    rp = api_client.get(f"{base_url}/api/products/{p['id']}")
    assert rp.status_code == 200
    pp = rp.json()
    assert pp["stock_count"] == 5, f"expected restocked to 5, got {pp['stock_count']}"
    assert pp["in_stock"] is True
