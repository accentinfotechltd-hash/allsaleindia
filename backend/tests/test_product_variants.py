"""Tests for product colors / sizes / stock_count + stock-aware cart."""
import asyncio
import time
from datetime import datetime, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def _new_user(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_stk_{suffix}@allsale.co.nz"
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


def _make_seller_listing(api_client, base_url, headers, user_id, **overrides):
    """Promote user to seller and create a listing with given overrides."""

    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        suffix = user_id[-6:].upper()
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
                    "gstin": f"07AAA{suffix[:3]}1234A1Z5"[:15].ljust(15, "X"),
                    "pan": f"AAA{suffix[:3]}1234A"[:10],
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
    body = {
        "name": overrides.get("name", "TEST stk listing"),
        "description": "A great test listing with plenty of description text.",
        "category": "Fashion",
        "price_nzd": 30.0,
        "image": "https://images.unsplash.com/photo-x",
        **overrides,
    }
    r = api_client.post(f"{base_url}/api/seller/products", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_listing_with_colors_sizes_stock(api_client, base_url):
    user = _new_user(api_client, base_url)
    p = _make_seller_listing(
        api_client,
        base_url,
        user["headers"],
        user["user_id"],
        colors=["Indigo", "  Indigo  ", "Maroon", "", "Saffron"],
        sizes=["S", "M", "L", "M"],
        stock_count=5,
    )
    # Dedupe (case-insensitive) + trim + drop empties
    assert p["colors"] == ["Indigo", "Maroon", "Saffron"]
    assert p["sizes"] == ["S", "M", "L"]
    assert p["stock_count"] == 5
    assert p["in_stock"] is True


def test_listing_zero_stock_is_out_of_stock(api_client, base_url):
    user = _new_user(api_client, base_url)
    p = _make_seller_listing(
        api_client,
        base_url,
        user["headers"],
        user["user_id"],
        name="TEST out-of-stock item",
        stock_count=0,
    )
    assert p["stock_count"] == 0
    assert p["in_stock"] is False


def test_add_to_cart_blocked_when_out_of_stock(api_client, base_url):
    seller = _new_user(api_client, base_url)
    p = _make_seller_listing(
        api_client,
        base_url,
        seller["headers"],
        seller["user_id"],
        name="TEST OOS for cart",
        stock_count=0,
    )
    buyer = _new_user(api_client, base_url)
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=buyer["headers"],
        json={"product_id": p["id"], "quantity": 1},
    )
    assert r.status_code == 400
    assert "out of stock" in r.json()["detail"].lower()


def test_add_to_cart_blocked_when_over_stock(api_client, base_url):
    seller = _new_user(api_client, base_url)
    p = _make_seller_listing(
        api_client,
        base_url,
        seller["headers"],
        seller["user_id"],
        name="TEST limited-stock for cart",
        stock_count=2,
    )
    buyer = _new_user(api_client, base_url)
    # Add 2 (limit)
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=buyer["headers"],
        json={"product_id": p["id"], "quantity": 2},
    )
    assert r.status_code == 200
    # Try to add 1 more — should be blocked
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=buyer["headers"],
        json={"product_id": p["id"], "quantity": 1},
    )
    assert r.status_code == 400
    assert "available" in r.json()["detail"].lower()


def test_colors_capped_at_10(api_client, base_url):
    user = _new_user(api_client, base_url)
    p = _make_seller_listing(
        api_client,
        base_url,
        user["headers"],
        user["user_id"],
        name="TEST cap colors",
        colors=[f"Color{i}" for i in range(20)],
    )
    assert len(p["colors"]) == 10


def test_default_stock_count_listing(api_client, base_url):
    """When ListingCreate omits stock_count, default is 99 (in stock)."""
    user = _new_user(api_client, base_url)
    body = {
        "name": "TEST default stock",
        "description": "Some default-stock product description.",
        "category": "Fashion",
        "price_nzd": 10.0,
        "image": "https://images.unsplash.com/photo-default",
    }
    # promote to seller first
    _make_seller_listing(
        api_client,
        base_url,
        user["headers"],
        user["user_id"],
        name="TEST_DEFAULT_PRECREATE",
    )
    r = api_client.post(f"{base_url}/api/seller/products", headers=user["headers"], json=body)
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["stock_count"] == 99
    assert p["in_stock"] is True
