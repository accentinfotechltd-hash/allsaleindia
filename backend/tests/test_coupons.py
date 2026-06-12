"""Tests for Coupons & Promo Codes (Phase 2).

Covers:
- POST /api/coupons/validate — buyer-side validation against cart
- GET /api/coupons/active — public list (auth required)
- POST/GET/PATCH/DELETE /api/seller/coupons — seller CRUD (verified-only)
- POST/DELETE /api/cart/coupon — persistent cart coupon
- Cart hydrate: discount_nzd / coupon_code / coupon_label + stale-coupon auto-drop
- Checkout: discount/coupon persisted on order; redemption is idempotent
"""
from __future__ import annotations

import asyncio
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

# Make backend/ importable so we can call record_coupon_redemption directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Per-run prefix to keep coupon codes unique across iterations.
import secrets
_RUN_PFX = secrets.token_hex(2).upper()

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"

# Shared event loop for service-layer calls so motor's `db` binding stays
# valid across multiple tests. (asyncio.run creates a fresh loop each call,
# which breaks the singleton motor client in services/coupons.py.)
_SVC_LOOP = asyncio.new_event_loop()


def _run_on_service_loop(coro):
    return _SVC_LOOP.run_until_complete(coro)


# ---------- helpers ----------
def _new_user(api_client, base_url, label, country: str = "New Zealand"):
    suffix = int(time.time() * 1000)
    email = f"TEST_cpn_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"Cpn {label}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    out = {
        "email": email,
        "user_id": d["user"]["id"],
        "token": d["access_token"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {d['access_token']}",
        },
    }
    # Force country on user doc to make tests deterministic.
    async def _set_country():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.users.update_one(
            {"id": out["user_id"]}, {"$set": {"country": country}}
        )
        cli.close()
    asyncio.run(_set_country())
    return out


def _promote_to_seller(user_id):
    from _helpers import make_gstin_pan

    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
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
                "company_name": f"Cpn Seller {user_id[-6:].upper()}",
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
            }},
            upsert=True,
        )
        cli.close()
    asyncio.run(go())


def _seed_product(seller_user_id: str, price_nzd: float, name: str = "TEST_Cpn_Prod") -> str:
    """Insert a product directly so we know the price + seller exactly."""
    import uuid
    pid = f"prod_{uuid.uuid4().hex[:12]}"
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.products.insert_one({
            "id": pid,
            "name": name,
            "description": "Test product for coupon flows",
            "category": "Bags & Luggage",
            "subcategory": "Test",
            "price_nzd": float(price_nzd),
            "price_inr": float(price_nzd) * 50,
            "image": "https://example.com/x.jpg",
            "images": ["https://example.com/x.jpg"],
            "rating": 0,
            "reviews_count": 0,
            "in_stock": True,
            "stock_count": 1000,
            "colors": [],
            "sizes": [],
            "shipping_days_min": 5,
            "shipping_days_max": 10,
            "origin": "India",
            "seller_id": seller_user_id,
            "seller_name": "Cpn Seller Co",
            "seller_city": None,
            "created_at": datetime.now(timezone.utc),
        })
        cli.close()
    asyncio.run(go())
    return pid


def _clear_cart(user_id: str):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.carts.delete_one({"user_id": user_id})
        cli.close()
    asyncio.run(go())


def _set_coupon_field(coupon_id: str, patch: dict):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.coupons.update_one({"id": coupon_id}, {"$set": patch})
        cli.close()
    asyncio.run(go())


# ---------- fixtures ----------
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
    pid = _seed_product(seller["user_id"], price_nzd=50.0, name="TEST_Cpn_SellerA")
    return {"product_id": pid, "price_nzd": 50.0, "seller_id": seller["user_id"]}


@pytest.fixture
def seller_b_product(seller_b):
    pid = _seed_product(seller_b["user_id"], price_nzd=50.0, name="TEST_Cpn_SellerB")
    return {"product_id": pid, "price_nzd": 50.0, "seller_id": seller_b["user_id"]}


def _create_coupon(api_client, base_url, headers, **overrides):
    """Helper: create a coupon for a verified seller with sensible defaults."""
    suffix = int(time.time() * 1_000_000) % 1_000_000
    body = {
        "code": f"TST{suffix}",
        "description": "Test coupon",
        "type": "percent",
        "value": 10,
        "min_order_nzd": 0,
        "scope": "seller",  # will get re-forced to seller anyway
        "active": True,
    }
    body.update(overrides)
    # Make explicit codes unique per test run to avoid 409 collisions with
    # leftover data from previous iterations.
    body["code"] = f"{_RUN_PFX}{body['code']}"[:20]
    r = api_client.post(f"{base_url}/api/seller/coupons", headers=headers, json=body)
    return r


# ============================================================================
# Seller CRUD
# ============================================================================
class TestSellerCRUD:
    def test_unverified_seller_cannot_create(self, api_client, base_url, buyer):
        r = _create_coupon(api_client, base_url, buyer["headers"])
        # buyer is not a seller at all → 403
        assert r.status_code == 403

    def test_verified_seller_create_percent(self, api_client, base_url, seller):
        r = _create_coupon(api_client, base_url, seller["headers"], code="WELCOME10")
        assert r.status_code == 201, r.text
        body = r.json()
        # Force seller scope
        assert body["scope"] == "seller"
        assert body["scope_value"] == [seller["user_id"]]
        assert body["owner_id"] == seller["user_id"]
        assert body["code"].endswith("WELCOME10")
        assert body["type"] == "percent"
        assert body["value"] == 10
        assert body["used_count"] == 0
        assert body["active"] is True

    def test_create_forces_seller_scope_even_when_all_requested(self, api_client, base_url, seller):
        r = _create_coupon(
            api_client, base_url, seller["headers"], code="SITEWIDE99", scope="all"
        )
        assert r.status_code == 201, r.text
        assert r.json()["scope"] == "seller"
        assert r.json()["scope_value"] == [seller["user_id"]]

    def test_reject_invalid_type(self, api_client, base_url, seller):
        r = _create_coupon(api_client, base_url, seller["headers"], code="BADTYPE1", type="bogus")
        assert r.status_code == 400

    def test_reject_percent_outside_1_to_90(self, api_client, base_url, seller):
        r1 = _create_coupon(api_client, base_url, seller["headers"], code="PCTHIGH1", type="percent", value=91)
        assert r1.status_code == 400
        r2 = _create_coupon(api_client, base_url, seller["headers"], code="PCTZERO1", type="percent", value=0)
        assert r2.status_code == 400

    def test_duplicate_code_409(self, api_client, base_url, seller):
        r1 = _create_coupon(api_client, base_url, seller["headers"], code="DUPE111")
        assert r1.status_code == 201, r1.text
        r2 = _create_coupon(api_client, base_url, seller["headers"], code="DUPE111")
        assert r2.status_code == 409

    def test_list_seller_own(self, api_client, base_url, seller):
        c1 = _create_coupon(api_client, base_url, seller["headers"], code="LIST111").json()
        c2 = _create_coupon(api_client, base_url, seller["headers"], code="LIST222").json()
        r = api_client.get(f"{base_url}/api/seller/coupons", headers=seller["headers"])
        assert r.status_code == 200
        codes = {c["code"] for c in r.json()}
        assert {c1["code"], c2["code"]} <= codes

    def test_patch_toggle_active(self, api_client, base_url, seller):
        c = _create_coupon(api_client, base_url, seller["headers"], code="PATCH111").json()
        r = api_client.patch(
            f"{base_url}/api/seller/coupons/{c['id']}",
            headers=seller["headers"],
            json={"active": False, "description": "Updated desc"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["active"] is False
        assert r.json()["description"] == "Updated desc"

    def test_patch_other_owner_403(self, api_client, base_url, seller, seller_b):
        c = _create_coupon(api_client, base_url, seller["headers"], code="OWN111").json()
        r = api_client.patch(
            f"{base_url}/api/seller/coupons/{c['id']}",
            headers=seller_b["headers"],
            json={"active": False},
        )
        assert r.status_code == 403

    def test_delete_owner(self, api_client, base_url, seller):
        c = _create_coupon(api_client, base_url, seller["headers"], code="DEL111").json()
        r = api_client.delete(
            f"{base_url}/api/seller/coupons/{c['id']}", headers=seller["headers"]
        )
        assert r.status_code == 204

    def test_delete_other_403(self, api_client, base_url, seller, seller_b):
        c = _create_coupon(api_client, base_url, seller["headers"], code="DELOTH1").json()
        r = api_client.delete(
            f"{base_url}/api/seller/coupons/{c['id']}", headers=seller_b["headers"]
        )
        assert r.status_code == 403


# ============================================================================
# Validate against cart
# ============================================================================
class TestValidate:
    def test_empty_cart(self, api_client, base_url, buyer):
        _clear_cart(buyer["user_id"])
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": "ANY"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is False
        assert "empty" in (body["error"] or "").lower()

    def test_invalid_code(self, api_client, base_url, buyer, seller_product):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": "NOPECODE"},
        )
        assert r.status_code == 200
        assert r.json()["ok"] is False
        assert "invalid" in r.json()["error"].lower()

    def test_percent_discount(self, api_client, base_url, buyer, seller, seller_product):
        _clear_cart(buyer["user_id"])
        # 2 x $50 = $100 cart, 10% → $10 off
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="PCT10A", type="percent", value=10
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["discount_nzd"] == 10.0
        assert body["free_shipping"] is False

    def test_percent_with_max_cap(self, api_client, base_url, buyer, seller, seller_product):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="PCT10CAP",
            type="percent", value=10, max_discount_nzd=5,
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is True
        assert r.json()["discount_nzd"] == 5.0

    def test_fixed_discount(self, api_client, base_url, buyer, seller, seller_product):
        _clear_cart(buyer["user_id"])
        # 2 x $50 = $100, $15 off
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="FIX15A", type="fixed", value=15
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is True
        assert r.json()["discount_nzd"] == 15.0

    def test_fixed_capped_at_eligible_subtotal(self, api_client, base_url, buyer, seller):
        # 1 x $10 product, $15 coupon → capped at $10
        _clear_cart(buyer["user_id"])
        pid = _seed_product(seller["user_id"], price_nzd=10.0, name="TEST_Cpn_Small")
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": pid, "quantity": 1},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="FIX15B", type="fixed", value=15
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is True
        assert r.json()["discount_nzd"] == 10.0

    def test_free_shipping(self, api_client, base_url, buyer, seller):
        # Use a product priced below free-shipping threshold so shipping > 0.
        _clear_cart(buyer["user_id"])
        pid = _seed_product(seller["user_id"], price_nzd=20.0, name="TEST_Cpn_Ship")
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": pid, "quantity": 1},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="FREESHIPA",
            type="free_shipping", value=0,
        ).json()
        # Validate first
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is True
        assert r.json()["free_shipping"] is True
        # Apply on cart — discount_nzd should include shipping savings ($12).
        rc = api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert rc.status_code == 200, rc.text
        cart = rc.json()
        assert cart["shipping_nzd"] == 0.0
        assert cart["discount_nzd"] >= 12.0
        assert cart["coupon_code"] == c["code"]

    def test_min_order(self, api_client, base_url, buyer, seller):
        _clear_cart(buyer["user_id"])
        # $30 cart, min_order=$50 → error suggesting $20 more
        pid = _seed_product(seller["user_id"], price_nzd=30.0, name="TEST_Cpn_Min")
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": pid, "quantity": 1},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="MIN50A",
            type="fixed", value=10, min_order_nzd=50,
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is False
        assert "20" in r.json()["error"]

    def test_scope_seller_other_seller_not_eligible(
        self, api_client, base_url, buyer, seller, seller_b, seller_b_product
    ):
        # Cart contains seller_b's product, but coupon is owned by seller A → must NOT apply
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_b_product["product_id"], "quantity": 1},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="OTHER1",
            type="percent", value=10,
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is False
        err = (r.json()["error"] or "").lower()
        assert "seller" in err or "applicable" in err or "specific" in err

    def test_per_user_limit_after_redemption(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="ONCE1A",
            type="percent", value=10, per_user_limit=1,
        ).json()
        # First validate works
        r1 = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r1.json()["ok"] is True

        # Simulate a redemption recorded for this buyer
        from services.coupons import record_coupon_redemption

        async def go():
            await record_coupon_redemption(
                coupon_id=c["id"],
                user_id=buyer["user_id"],
                order_id=f"ord_test_{int(time.time()*1000)}",
                discount_nzd=5.0,
            )
        _run_on_service_loop(go())

        r2 = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r2.json()["ok"] is False
        assert "already used" in (r2.json()["error"] or "").lower()

    def test_expired(self, api_client, base_url, buyer, seller, seller_product):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="EXP111",
            type="percent", value=10,
        ).json()
        # Force valid_to in the past
        _set_coupon_field(c["id"], {"valid_to": datetime.now(timezone.utc) - timedelta(days=1)})
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is False
        assert "expired" in r.json()["error"].lower()

    def test_inactive(self, api_client, base_url, buyer, seller, seller_product):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="INAC1A",
            type="percent", value=10, active=False,
        ).json()
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is False
        assert "no longer active" in r.json()["error"].lower()

    def test_country_lock_excludes_other_region(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="AUONLY1",
            type="percent", value=10, countries=["AU"],
        ).json()
        # Force buyer's country to NZ
        async def set_country():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            await db.users.update_one(
                {"id": buyer["user_id"]}, {"$set": {"country": "NZ"}}
            )
            cli.close()
        asyncio.run(set_country())
        r = api_client.post(
            f"{base_url}/api/coupons/validate",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.json()["ok"] is False
        assert "region" in r.json()["error"].lower()


# ============================================================================
# Cart integration (apply/remove + stale auto-drop)
# ============================================================================
class TestCartCoupon:
    def test_apply_then_remove(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="APPLY1A",
            type="percent", value=10,
        ).json()
        r = api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.status_code == 200, r.text
        cart = r.json()
        assert cart["discount_nzd"] == 10.0
        assert cart["coupon_code"] == c["code"]
        assert cart["coupon_label"]
        # subtotal 100, shipping 0 (>=100 threshold), total = 100 - 10 = 90
        assert cart["total_nzd"] == 90.0

        # GET /cart reflects persistence
        g = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"]).json()
        assert g["coupon_code"] == c["code"]
        assert g["discount_nzd"] == 10.0

        # Remove
        rd = api_client.delete(
            f"{base_url}/api/cart/coupon", headers=buyer["headers"]
        )
        assert rd.status_code == 200
        assert rd.json()["coupon_code"] is None
        assert rd.json()["discount_nzd"] == 0.0

    def test_apply_invalid_code_400(
        self, api_client, base_url, buyer, seller_product
    ):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 1},
        )
        r = api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": "NOPENOPE"},
        )
        assert r.status_code == 400

    def test_apply_empty_cart_400(self, api_client, base_url, buyer):
        _clear_cart(buyer["user_id"])
        r = api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": "ANY"},
        )
        assert r.status_code == 400

    def test_stale_coupon_silently_dropped_on_get(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="STALE1A",
            type="percent", value=10,
        ).json()
        r = api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        assert r.status_code == 200

        # Now disable coupon out-of-band
        _set_coupon_field(c["id"], {"active": False})

        # GET should NOT error; should drop coupon silently
        g = api_client.get(f"{base_url}/api/cart", headers=buyer["headers"])
        assert g.status_code == 200
        cart = g.json()
        assert cart.get("coupon_code") in (None, "")
        assert cart["discount_nzd"] == 0.0


# ============================================================================
# Active list
# ============================================================================
class TestActive:
    def test_active_list_excludes_inactive(
        self, api_client, base_url, buyer, seller
    ):
        c_active = _create_coupon(
            api_client, base_url, seller["headers"], code="ACTV111A",
            type="percent", value=10,
        ).json()
        c_inactive = _create_coupon(
            api_client, base_url, seller["headers"], code="ACTV222A",
            type="percent", value=10, active=False,
        ).json()
        r = api_client.get(
            f"{base_url}/api/coupons/active", headers=buyer["headers"]
        )
        assert r.status_code == 200, r.text
        codes = {c["code"] for c in r.json()}
        assert c_active["code"] in codes
        assert c_inactive["code"] not in codes

    def test_active_list_excludes_expired(
        self, api_client, base_url, buyer, seller
    ):
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="ACTVEXP1",
            type="percent", value=10,
        ).json()
        _set_coupon_field(c["id"], {"valid_to": datetime.now(timezone.utc) - timedelta(days=1)})
        r = api_client.get(
            f"{base_url}/api/coupons/active", headers=buyer["headers"]
        )
        codes = {x["code"] for x in r.json()}
        assert c["code"] not in codes

    def test_active_list_region_locked(self, api_client, base_url, buyer, seller):
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="ACTVAU1A",
            type="percent", value=10, countries=["AU"],
        ).json()
        # buyer is NZ — should NOT see AU-only coupon
        async def set_country():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            await db.users.update_one(
                {"id": buyer["user_id"]}, {"$set": {"country": "NZ"}}
            )
            cli.close()
        asyncio.run(set_country())
        r = api_client.get(
            f"{base_url}/api/coupons/active", headers=buyer["headers"]
        )
        codes = {x["code"] for x in r.json()}
        assert c["code"] not in codes

    def test_active_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/coupons/active")
        assert r.status_code == 401


# ============================================================================
# Checkout — order persists coupon fields; redemption is idempotent
# ============================================================================
class TestCheckoutAndRedemption:
    def test_checkout_persists_discount_on_order(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="CHKOUT1A",
            type="percent", value=10,
        ).json()
        api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        # Initiate checkout
        addr = {
            "full_name": "Coupon Tester",
            "phone": "+64211234567",
            "line1": "1 Queen St",
            "city": "Auckland",
            "region": "Auckland",
            "postcode": "1010",
            "country": "New Zealand",
        }
        r = api_client.post(
            f"{base_url}/api/checkout/session",
            headers=buyer["headers"],
            json={"address": addr, "origin_url": base_url},
        )
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]

        # Verify order doc directly
        async def fetch():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            doc = await db.orders.find_one({"id": order_id}, {"_id": 0})
            cli.close()
            return doc
        doc = asyncio.run(fetch())
        assert doc is not None
        assert doc["coupon_code"] == c["code"]
        assert doc["coupon_label"]
        assert round(doc["discount_nzd"], 2) == 10.0
        # total_nzd = 100 - 10 + 0 shipping (>=$100 free shipping) = 90
        assert round(doc["total_nzd"], 2) == 90.0

    def test_redemption_idempotent(self, api_client, base_url, buyer, seller):
        # Create a coupon
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="IDEMP1A",
            type="percent", value=10,
        ).json()

        from services.coupons import record_coupon_redemption

        order_id = f"ord_idem_{int(time.time()*1000)}"

        async def run_twice():
            await record_coupon_redemption(
                coupon_id=c["id"], user_id=buyer["user_id"],
                order_id=order_id, discount_nzd=5.0,
            )
            await record_coupon_redemption(
                coupon_id=c["id"], user_id=buyer["user_id"],
                order_id=order_id, discount_nzd=5.0,
            )
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            cpn = await db.coupons.find_one({"id": c["id"]}, {"_id": 0, "used_count": 1})
            rows = await db.coupon_usage.count_documents(
                {"coupon_id": c["id"], "order_id": order_id}
            )
            cli.close()
            return cpn, rows
        cpn, rows = _run_on_service_loop(run_twice())
        assert cpn["used_count"] == 1, "used_count must be 1, not 2"
        assert rows == 1, "coupon_usage must have exactly one row"

    def test_on_payment_succeeded_records_once(
        self, api_client, base_url, buyer, seller, seller_product
    ):
        """Drive _on_payment_succeeded directly (Stripe webhook surrogate)."""
        _clear_cart(buyer["user_id"])
        api_client.post(
            f"{base_url}/api/cart",
            headers=buyer["headers"],
            json={"product_id": seller_product["product_id"], "quantity": 2},
        )
        c = _create_coupon(
            api_client, base_url, seller["headers"], code="ONPAY1A",
            type="percent", value=10,
        ).json()
        api_client.post(
            f"{base_url}/api/cart/coupon",
            headers=buyer["headers"],
            json={"code": c["code"]},
        )
        addr = {
            "full_name": "Coupon Tester",
            "phone": "+64211234567",
            "line1": "1 Queen St",
            "city": "Auckland",
            "region": "Auckland",
            "postcode": "1010",
            "country": "New Zealand",
        }
        r = api_client.post(
            f"{base_url}/api/checkout/session",
            headers=buyer["headers"],
            json={"address": addr, "origin_url": base_url},
        )
        assert r.status_code == 200, r.text
        order_id = r.json()["order_id"]
        session_id = r.json()["session_id"]

        from routers.checkout import _on_payment_succeeded

        async def run_twice():
            await _on_payment_succeeded(session_id, buyer["user_id"], order_id)
            await _on_payment_succeeded(session_id, buyer["user_id"], order_id)
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            cpn = await db.coupons.find_one({"id": c["id"]}, {"_id": 0, "used_count": 1})
            rows = await db.coupon_usage.count_documents(
                {"coupon_id": c["id"], "order_id": order_id}
            )
            cli.close()
            return cpn, rows
        cpn, rows = _run_on_service_loop(run_twice())
        assert cpn["used_count"] == 1
        assert rows == 1
