"""Tests for Flash Sales / Deal of the Day (Phase 6).

Covers:
- GET  /api/flash-sales/active                    — public list, sorting, DoD
- POST /api/seller/flash-sales                    — validation (all rules)
- GET  /api/seller/flash-sales                    — owner-list sorted desc
- PATCH /api/seller/flash-sales/{id}              — owner update, recompute pct
- DELETE /api/seller/flash-sales/{id}             — owner delete
- Cart hydration: sale price substituted, original_price/flash_sale_id
- Best-discount-wins when two sales for same product
- Order persistence: flash_sale_id + original_price_nzd on items
- record_units_sold idempotent per (sale_id, order_id)
- Sold-out auto-deactivate
- Stacks with coupon + points
"""
from __future__ import annotations

import asyncio
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"

_LOOP = asyncio.new_event_loop()


def _mongo_run(coro_fn):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL, io_loop=_LOOP)
        db = cli[DB_NAME]
        try:
            return await coro_fn(db)
        finally:
            cli.close()
    return _LOOP.run_until_complete(go())


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _new_user(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_fs_{label}_{suffix}_{uuid.uuid4().hex[:4]}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"FS {label}"},
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


def _promote_to_seller(user_id):
    from _helpers import make_gstin_pan

    async def go(db):
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"is_seller": True, "seller_verification_status": "auto_verified"}},
        )
        gstin, pan = make_gstin_pan()
        await db.sellers.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "business_type": "private_limited",
                "company_name": f"FS Seller {user_id[-6:].upper()}",
                "gstin": gstin, "pan": pan,
                "address_line1": "10 Test Rd", "city": "Mumbai",
                "state": "Maharashtra", "pincode": "400001",
                "contact_name": "Tester", "contact_phone": "+919811112222",
                "verification_status": "auto_verified",
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    _mongo_run(go)


def _seed_product(seller_user_id: str, price_nzd: float, name: str = "TEST_FS_Prod") -> str:
    pid = f"prod_{uuid.uuid4().hex[:12]}"
    async def go(db):
        await db.products.insert_one({
            "id": pid, "name": name,
            "description": "Test product for flash sales",
            "category": "Bags & Luggage", "subcategory": "Test",
            "price_nzd": float(price_nzd), "price_inr": float(price_nzd) * 50,
            "image": "https://example.com/x.jpg",
            "images": ["https://example.com/x.jpg"],
            "rating": 0, "reviews_count": 0,
            "in_stock": True, "stock_count": 1000,
            "colors": [], "sizes": [],
            "shipping_days_min": 5, "shipping_days_max": 10,
            "origin": "India", "seller_id": seller_user_id,
            "seller_name": "FS Seller Co",
            "created_at": datetime.now(timezone.utc),
        })
    _mongo_run(go)
    return pid


def _clear_cart(user_id: str):
    async def go(db):
        await db.carts.delete_one({"user_id": user_id})
    _mongo_run(go)


def _patch_sale(sale_id: str, patch: dict):
    async def go(db):
        await db.flash_sales.update_one({"id": sale_id}, {"$set": patch})
    _mongo_run(go)


def _make_sale_body(product_id, sale_price=49.0,
                    days=1, units_max=100, featured=False, active=True,
                    from_offset_sec=-60):
    now = datetime.now(timezone.utc)
    return {
        "product_id": product_id,
        "sale_price_nzd": sale_price,
        "valid_from": _iso(now + timedelta(seconds=from_offset_sec)),
        "valid_to": _iso(now + timedelta(days=days)),
        "units_max": units_max,
        "featured": featured,
        "active": active,
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def buyer(api_client, base_url):
    return _new_user(api_client, base_url, "buyer")


@pytest.fixture
def seller(api_client, base_url):
    s = _new_user(api_client, base_url, "seller")
    _promote_to_seller(s["user_id"])
    return s


@pytest.fixture
def seller_b(api_client, base_url):
    s = _new_user(api_client, base_url, "sellerB")
    _promote_to_seller(s["user_id"])
    return s


@pytest.fixture
def seller_product(seller):
    pid = _seed_product(seller["user_id"], price_nzd=89.0, name="TEST_FS_A")
    return {"product_id": pid, "price_nzd": 89.0, "seller_id": seller["user_id"]}


# ============================================================================
# Public — GET /flash-sales/active
# ============================================================================
class TestPublicActive:
    def test_no_auth_required(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/flash-sales/active")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_returns_only_active_within_window(
        self, api_client, base_url, seller, seller_product
    ):
        # Active sale
        active = api_client.post(
            f"{base_url}/api/seller/flash-sales",
            headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        # Inactive sale on another product
        pid2 = _seed_product(seller["user_id"], 50.0, "TEST_FS_Inactive")
        inactive = api_client.post(
            f"{base_url}/api/seller/flash-sales",
            headers=seller["headers"],
            json=_make_sale_body(pid2, sale_price=20.0, active=False),
        ).json()
        # Future sale on another product
        pid3 = _seed_product(seller["user_id"], 50.0, "TEST_FS_Future")
        future_body = _make_sale_body(pid3, sale_price=20.0)
        future_body["valid_from"] = _iso(datetime.now(timezone.utc) + timedelta(hours=2))
        future_body["valid_to"] = _iso(datetime.now(timezone.utc) + timedelta(days=2))
        future = api_client.post(
            f"{base_url}/api/seller/flash-sales",
            headers=seller["headers"], json=future_body,
        ).json()

        r = api_client.get(f"{base_url}/api/flash-sales/active")
        ids = {s["id"] for s in r.json()}
        assert active["id"] in ids
        assert inactive["id"] not in ids
        assert future["id"] not in ids

    def test_excludes_sold_out(self, api_client, base_url, seller, seller_product):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales",
            headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0, units_max=5),
        ).json()
        _patch_sale(s["id"], {"units_sold": 5})
        ids = {x["id"] for x in api_client.get(f"{base_url}/api/flash-sales/active").json()}
        assert s["id"] not in ids

    def test_featured_first_then_discount(self, api_client, base_url, seller):
        # Three sales — one featured low discount, one non-featured high discount,
        # one non-featured mid discount.
        p1 = _seed_product(seller["user_id"], 100.0, "TEST_FS_Feat")
        p2 = _seed_product(seller["user_id"], 100.0, "TEST_FS_HighD")
        p3 = _seed_product(seller["user_id"], 100.0, "TEST_FS_MidD")
        feat = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(p1, sale_price=85.0, featured=True),  # 15%
        ).json()
        high = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(p2, sale_price=50.0),  # 50%
        ).json()
        mid = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(p3, sale_price=70.0),  # 30%
        ).json()

        r = api_client.get(f"{base_url}/api/flash-sales/active").json()
        # Filter only ours
        ours = [s for s in r if s["id"] in {feat["id"], high["id"], mid["id"]}]
        assert ours[0]["id"] == feat["id"], "featured should be first"
        assert ours[0]["is_deal_of_the_day"] is True
        # After featured, by highest discount
        non_feat = [s for s in ours if s["id"] != feat["id"]]
        assert non_feat[0]["id"] == high["id"]

    def test_hydration_product_name_image(
        self, api_client, base_url, seller, seller_product
    ):
        api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        )
        r = api_client.get(f"{base_url}/api/flash-sales/active").json()
        ours = [s for s in r if s["product_id"] == seller_product["product_id"]]
        assert ours, "expected our sale to be in active list"
        assert ours[0]["product_name"]
        assert ours[0]["product_image"]


# ============================================================================
# Seller CRUD validation
# ============================================================================
class TestSellerCreate:
    def test_unverified_buyer_403(self, api_client, base_url, buyer):
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=buyer["headers"],
            json=_make_sale_body("noexist", 10.0),
        )
        assert r.status_code == 403

    def test_product_not_owned_404(
        self, api_client, base_url, seller, seller_b
    ):
        # Product belongs to seller_b — seller A tries to discount it.
        pid = _seed_product(seller_b["user_id"], 100.0, "TEST_FS_NotMine")
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(pid, sale_price=49.0),
        )
        assert r.status_code == 404

    def test_sale_price_above_list_400(
        self, api_client, base_url, seller, seller_product
    ):
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=89.0),
        )
        assert r.status_code == 400
        # equal to list price → reject
        r2 = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=100.0),
        )
        assert r2.status_code == 400

    def test_min_discount_10_pct(
        self, api_client, base_url, seller, seller_product
    ):
        # 89 -> 85 = 4.5% < 10% → reject
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=85.0),
        )
        assert r.status_code == 400
        assert "10" in r.text

    def test_valid_to_must_be_after_from(
        self, api_client, base_url, seller, seller_product
    ):
        body = _make_sale_body(seller_product["product_id"], sale_price=49.0)
        body["valid_to"] = body["valid_from"]
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"], json=body
        )
        assert r.status_code == 400

    def test_valid_to_must_be_future(
        self, api_client, base_url, seller, seller_product
    ):
        now = datetime.now(timezone.utc)
        body = _make_sale_body(seller_product["product_id"], sale_price=49.0)
        body["valid_from"] = _iso(now - timedelta(days=2))
        body["valid_to"] = _iso(now - timedelta(days=1))
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"], json=body
        )
        assert r.status_code == 400

    def test_max_duration_7_days(
        self, api_client, base_url, seller, seller_product
    ):
        now = datetime.now(timezone.utc)
        body = _make_sale_body(seller_product["product_id"], sale_price=49.0)
        body["valid_from"] = _iso(now)
        body["valid_to"] = _iso(now + timedelta(days=8))
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"], json=body
        )
        assert r.status_code == 400
        assert "7" in r.text

    def test_max_active_per_seller_10(
        self, api_client, base_url, seller
    ):
        # Create 10 sales — 11th must reject
        for i in range(10):
            pid = _seed_product(seller["user_id"], 100.0, f"TEST_FS_Cap_{i}")
            r = api_client.post(
                f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
                json=_make_sale_body(pid, sale_price=50.0),
            )
            assert r.status_code == 201, f"#{i}: {r.text}"
        pid = _seed_product(seller["user_id"], 100.0, "TEST_FS_Cap_11th")
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(pid, sale_price=50.0),
        )
        assert r.status_code == 400
        assert "10" in r.text or "active" in r.text.lower()

    def test_create_computes_discount_pct_and_sets_seller(
        self, api_client, base_url, seller, seller_product
    ):
        # 89 -> 49 = 44.94%, rounded → 45
        r = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["discount_pct"] == 45
        assert body["original_price_nzd"] == 89.0
        assert body["sale_price_nzd"] == 49.0
        assert body["units_sold"] == 0
        assert body["seller_id"] == seller["user_id"]
        assert body["seller_name"]
        assert body["created_at"] is not None
        assert body["id"].startswith("fs_")


# ============================================================================
# Seller List / Patch / Delete
# ============================================================================
class TestSellerManage:
    def test_list_sorted_desc(self, api_client, base_url, seller):
        p1 = _seed_product(seller["user_id"], 100.0, "TEST_FS_L1")
        p2 = _seed_product(seller["user_id"], 100.0, "TEST_FS_L2")
        s1 = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(p1, sale_price=50.0),
        ).json()
        time.sleep(0.1)
        s2 = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(p2, sale_price=50.0),
        ).json()
        r = api_client.get(f"{base_url}/api/seller/flash-sales", headers=seller["headers"])
        assert r.status_code == 200
        items = r.json()
        ids = [s["id"] for s in items]
        # s2 (newer) before s1
        assert ids.index(s2["id"]) < ids.index(s1["id"])

    def test_patch_recomputes_discount(
        self, api_client, base_url, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        assert s["discount_pct"] == 45
        # Drop price to 30 → 89 -> 30 = 66.29% → 66
        r = api_client.patch(
            f"{base_url}/api/seller/flash-sales/{s['id']}",
            headers=seller["headers"], json={"sale_price_nzd": 30.0},
        )
        assert r.status_code == 200, r.text
        assert r.json()["discount_pct"] == 66
        assert r.json()["sale_price_nzd"] == 30.0

    def test_patch_rejects_price_above_list(
        self, api_client, base_url, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        r = api_client.patch(
            f"{base_url}/api/seller/flash-sales/{s['id']}",
            headers=seller["headers"], json={"sale_price_nzd": 100.0},
        )
        assert r.status_code == 400

    def test_patch_other_owner_403(
        self, api_client, base_url, seller, seller_b, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        r = api_client.patch(
            f"{base_url}/api/seller/flash-sales/{s['id']}",
            headers=seller_b["headers"], json={"active": False},
        )
        assert r.status_code == 403

    def test_delete_owner(self, api_client, base_url, seller, seller_product):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        r = api_client.delete(
            f"{base_url}/api/seller/flash-sales/{s['id']}", headers=seller["headers"]
        )
        assert r.status_code == 204

    def test_delete_other_403(
        self, api_client, base_url, seller, seller_b, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        r = api_client.delete(
            f"{base_url}/api/seller/flash-sales/{s['id']}", headers=seller_b["headers"]
        )
        assert r.status_code == 403


# ============================================================================
# Cart hydration with flash sale
# ============================================================================
class TestCartHydration:
    def test_cart_uses_sale_price(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 1},
        )
        r = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"])
        assert r.status_code == 200
        cart = r.json()
        item = next(i for i in cart["items"] if i["product_id"] == seller_product["product_id"])
        assert item["price_nzd"] == 49.0
        assert item["original_price_nzd"] == 89.0
        assert item["flash_sale_id"] == s["id"]
        assert cart["subtotal_nzd"] == 49.0

    def test_inactive_sale_uses_list_price(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0, active=False),
        ).json()
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 1},
        )
        cart = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"]).json()
        item = next(i for i in cart["items"] if i["product_id"] == seller_product["product_id"])
        assert item["price_nzd"] == 89.0
        assert item["original_price_nzd"] == 89.0
        assert item["flash_sale_id"] is None
        assert s["id"]  # silence unused

    def test_sold_out_uses_list_price(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0, units_max=2),
        ).json()
        _patch_sale(s["id"], {"units_sold": 2})
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 1},
        )
        cart = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"]).json()
        item = cart["items"][0]
        assert item["price_nzd"] == 89.0
        assert item["flash_sale_id"] is None

    def test_non_sale_item_has_null_flash_sale_id(
        self, api_client, base_url, buyer, seller
    ):
        # Backward compat: product without sale → flash_sale_id null, original==price
        pid = _seed_product(seller["user_id"], 30.0, "TEST_FS_NoSale")
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": pid, "quantity": 1},
        )
        cart = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"]).json()
        item = cart["items"][0]
        assert item["flash_sale_id"] is None
        assert item["price_nzd"] == 30.0
        assert item["original_price_nzd"] == 30.0


# ============================================================================
# get_active_for_product — best discount wins
# ============================================================================
class TestBestDiscount:
    def test_best_discount_picked(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        # Two active sales on same product — 45% & 66%. Cart should use the deeper one.
        api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        )
        s2 = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=30.0),
        ).json()
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 1},
        )
        cart = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"]).json()
        item = cart["items"][0]
        assert item["price_nzd"] == 30.0
        assert item["flash_sale_id"] == s2["id"]


# ============================================================================
# Order persistence + record_units_sold idempotency
# ============================================================================
class TestOrderAndUnits:
    def test_record_units_sold_idempotent(self):
        async def go(db):
            from services.flash_sales import record_units_sold
            sale_id = f"fs_test_{uuid.uuid4().hex[:8]}"
            await db.flash_sales.insert_one({
                "id": sale_id, "product_id": "p", "seller_id": "s",
                "sale_price_nzd": 10.0, "original_price_nzd": 50.0,
                "discount_pct": 80, "units_max": 100, "units_sold": 0,
                "valid_from": datetime.now(timezone.utc) - timedelta(hours=1),
                "valid_to": datetime.now(timezone.utc) + timedelta(hours=1),
                "active": True, "featured": False,
            })
            oid = f"ord_test_{uuid.uuid4().hex[:8]}"
            a = await record_units_sold(sale_id=sale_id, order_id=oid, qty=3)
            b = await record_units_sold(sale_id=sale_id, order_id=oid, qty=3)
            doc = await db.flash_sales.find_one({"id": sale_id}, {"_id": 0, "units_sold": 1})
            await db.flash_sales.delete_one({"id": sale_id})
            await db.flash_sale_usage.delete_many({"sale_id": sale_id})
            return a, b, doc["units_sold"]
        a, b, total = _mongo_run(go)
        assert a == 3
        assert b == 0
        assert total == 3

    def test_checkout_order_persists_flash_sale_fields(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        ).json()
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        addr = {
            "full_name": "FS Tester", "phone": "+64211234567",
            "line1": "1 Queen St", "city": "Auckland",
            "region": "Auckland", "postcode": "1010",
            "country": "New Zealand",
        }
        r = api_client.post(
            f"{base_url}/api/checkout/session", headers=buyer["headers"],
            json={"address": addr, "origin_url": base_url},
        )
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]

        async def fetch(db):
            return await db.orders.find_one({"id": order_id}, {"_id": 0})
        doc = _mongo_run(fetch)
        assert doc is not None
        it = next(i for i in doc["items"] if i["product_id"] == seller_product["product_id"])
        assert it["flash_sale_id"] == s["id"]
        assert it["original_price_nzd"] == 89.0
        assert it["price_nzd"] == 49.0

    def test_payment_success_increments_units_sold_idempotent(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0, units_max=100),
        ).json()
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        addr = {
            "full_name": "FS Tester", "phone": "+64211234567",
            "line1": "1 Queen St", "city": "Auckland",
            "region": "Auckland", "postcode": "1010",
            "country": "New Zealand",
        }
        r = api_client.post(
            f"{base_url}/api/checkout/session", headers=buyer["headers"],
            json={"address": addr, "origin_url": base_url},
        )
        order_id = r.json()["order_id"]
        session_id = r.json()["session_id"]

        async def go(db):
            from routers.checkout import _on_payment_succeeded
            await _on_payment_succeeded(session_id, buyer["user_id"], order_id)
            await _on_payment_succeeded(session_id, buyer["user_id"], order_id)
            doc = await db.flash_sales.find_one({"id": s["id"]}, {"_id": 0, "units_sold": 1})
            usage_rows = await db.flash_sale_usage.count_documents(
                {"sale_id": s["id"], "order_id": order_id}
            )
            return doc["units_sold"], usage_rows
        units_sold, usage_rows = _mongo_run(go)
        assert units_sold == 2
        assert usage_rows == 1


# ============================================================================
# Sold-out auto-deactivate via get_active_for_product
# ============================================================================
class TestSoldOutAuto:
    def test_get_active_for_product_returns_none_when_sold_out(
        self, api_client, base_url, seller, seller_product
    ):
        s = api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0, units_max=3),
        ).json()
        _patch_sale(s["id"], {"units_sold": 3})

        async def go(db):
            from services.flash_sales import get_active_for_product
            return await get_active_for_product(seller_product["product_id"])
        result = _mongo_run(go)
        assert result is None


# ============================================================================
# Stacks: flash + coupon + points
# ============================================================================
class TestStacks:
    def test_flash_plus_coupon_plus_points(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        # Flash: 89 → 49
        api_client.post(
            f"{base_url}/api/seller/flash-sales", headers=seller["headers"],
            json=_make_sale_body(seller_product["product_id"], sale_price=49.0),
        )
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart", headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 1},
        )
        # Add a $10 fixed coupon (admin-scope so it applies to any seller)
        code = f"FSCPN{int(time.time())}"
        async def seed_cpn(db):
            await db.coupons.insert_one({
                "id": f"cp_{uuid.uuid4().hex[:8]}",
                "code": code, "description": "FS test coupon",
                "type": "fixed", "value": 10.0,
                "min_order_nzd": 0.0, "max_discount_nzd": None,
                "valid_from": None, "valid_to": None,
                "usage_limit_total": None, "used_count": 0,
                "per_user_limit": 10, "scope": "all",
                "scope_value": [], "countries": [],
                "owner_id": "admin", "owner_name": "Allsale",
                "active": True,
                "created_at": datetime.now(timezone.utc),
            })
        _mongo_run(seed_cpn)
        rc = api_client.post(
            f"{base_url}/api/cart/coupon", headers=buyer["headers"], json={"code": code}
        )
        assert rc.status_code == 200, rc.text
        cart_c = rc.json()
        # Subtotal must be 49 (sale price)
        assert cart_c["subtotal_nzd"] == 49.0
        coupon_disc = float(cart_c["discount_nzd"])
        assert coupon_disc >= 10.0 - 0.01

        # 1000 points = $10
        rp = api_client.post(
            f"{base_url}/api/cart/points", headers=buyer["headers"], json={"points": 1000}
        )
        # Welcome bonus is only 500, so points_used should max at 500 → $5
        # Verify stacking still works (no error).
        assert rp.status_code == 200, rp.text
        cart = rp.json()
        # subtotal still uses sale price
        assert cart["subtotal_nzd"] == 49.0
        # discount = coupon + points_discount
        assert cart["points_used"] <= 500
        assert cart["discount_nzd"] >= coupon_disc + cart["points_discount_nzd"] - 0.01
