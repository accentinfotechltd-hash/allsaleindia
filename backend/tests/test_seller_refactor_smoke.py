"""HTTP-level smoke test for the refactored seller router package.

The 1000-line ``routers/seller.py`` was split into the package
``routers/seller/`` with submodules onboarding / listings / orders / analytics
plus a shared ``_common.py``. This test exercises every route across all four
submodules to confirm route parity (URLs, methods, status codes, response
shape) after the refactor. NO behavior changes are expected.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

from _helpers import make_gstin_pan

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


def _ts() -> int:
    return int(time.time() * 1000) + uuid.uuid4().int % 1000


def _valid_business(overrides=None) -> dict:
    g, p = make_gstin_pan()
    b = {
        "business_type": "private_limited",
        "company_name": "TEST Refactor Co Pvt Ltd",
        "gstin": g,
        "pan": p,
        "cin": "U74999MH2020PTC123456",
        "address_line1": "12 Refactor Lane",
        "address_line2": "Bandra",
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001",
        "contact_name": "Refactor Tester",
        "contact_phone": "+919999999999",
    }
    if overrides:
        b.update(overrides)
    return b


# ---------------------------------------------------------------------------
# Module-scoped fixtures — a verified seller + a plain buyer + one listing
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def seller(api_client):
    """Register a fresh verified seller and return token + user_id."""
    email = f"TEST_refactor_seller_{_ts()}@allsale.co.nz"
    r = api_client.post(
        f"{BASE_URL}/api/seller/register",
        json={"email": email, "password": "Test1234!", "business": _valid_business()},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {
        "email": email,
        "token": body["access_token"],
        "user_id": body["user"]["id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


@pytest.fixture(scope="module")
def buyer(api_client):
    """Register a plain buyer for permission-gate testing."""
    email = f"TEST_refactor_buyer_{_ts()}@allsale.co.nz"
    r = api_client.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Refactor Buyer"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {
        "email": email,
        "token": body["access_token"],
        "user_id": body["user"]["id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


# ---------------------------------------------------------------------------
# onboarding.py — /seller/register, /seller/upgrade, /seller/me
# ---------------------------------------------------------------------------
class TestOnboarding:
    def test_register_returns_token_and_seller_flag(self, seller):
        assert seller["token"]
        assert seller["user_id"].startswith("user_")

    def test_seller_me_returns_profile(self, api_client, seller):
        r = api_client.get(f"{BASE_URL}/api/seller/me", headers=seller["headers"])
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["verification_status"] == "auto_verified"
        assert p["company_name"] == "TEST Refactor Co Pvt Ltd"
        assert p["user_id"] == seller["user_id"]

    def test_seller_me_404_for_buyer(self, api_client, buyer):
        r = api_client.get(f"{BASE_URL}/api/seller/me", headers=buyer["headers"])
        assert r.status_code == 404

    def test_seller_me_401_without_token(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/seller/me")
        assert r.status_code == 401

    def test_upgrade_buyer_to_seller(self, api_client):
        email = f"TEST_refactor_upg_{_ts()}@allsale.co.nz"
        reg = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "Test1234!", "full_name": "Upg Buyer"},
        )
        assert reg.status_code == 200
        h = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        up = api_client.post(
            f"{BASE_URL}/api/seller/upgrade",
            json={"business": _valid_business()},
            headers=h,
        )
        assert up.status_code == 200, up.text
        assert up.json()["is_seller"] is True

    def test_upgrade_twice_400(self, api_client, seller):
        # seller is already a seller → upgrade must 400
        r = api_client.post(
            f"{BASE_URL}/api/seller/upgrade",
            json={"business": _valid_business()},
            headers=seller["headers"],
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# listings.py — CRUD + bulk operations
# ---------------------------------------------------------------------------
def _make_listing(api_client, seller, name="TEST Refactor Item", price=29.99, stock=10):
    payload = {
        "name": name,
        "description": "Smoke test listing from refactor parity check.",
        "category": "Home & Decor",
        "price_nzd": price,
        "stock_count": stock,
        "image": "https://example.com/x.jpg",
    }
    r = api_client.post(
        f"{BASE_URL}/api/seller/products", json=payload, headers=seller["headers"]
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestListings:
    def test_create_listing(self, api_client, seller):
        p = _make_listing(api_client, seller)
        assert p["seller_id"] == seller["user_id"]
        assert p["price_nzd"] == 29.99
        assert p["in_stock"] is True

    def test_create_listing_no_image_400(self, api_client, seller):
        r = api_client.post(
            f"{BASE_URL}/api/seller/products",
            json={
                "name": "No image",
                "description": "Should fail — no images at all.",
                "category": "Misc",
                "price_nzd": 10.0,
            },
            headers=seller["headers"],
        )
        assert r.status_code == 400
        assert "photo" in r.json()["detail"].lower()

    def test_create_listing_forbidden_for_buyer(self, api_client, buyer):
        r = api_client.post(
            f"{BASE_URL}/api/seller/products",
            json={
                "name": "Buyer attempt",
                "description": "A test description over 10 chars.",
                "category": "Misc",
                "price_nzd": 10.0,
                "image": "https://example.com/x.jpg",
            },
            headers=buyer["headers"],
        )
        assert r.status_code == 403

    def test_list_my_listings(self, api_client, seller):
        # Ensure at least one
        _make_listing(api_client, seller, name="TEST list_me")
        r = api_client.get(
            f"{BASE_URL}/api/seller/products", headers=seller["headers"]
        )
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        assert all(p["seller_id"] == seller["user_id"] for p in items)

    def test_patch_update_listing(self, api_client, seller):
        p = _make_listing(api_client, seller, name="TEST patch base")
        pid = p["id"]
        r = api_client.patch(
            f"{BASE_URL}/api/seller/products/{pid}",
            json={"name": "TEST patched", "price_nzd": 99.5, "stock_count": 3},
            headers=seller["headers"],
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["name"] == "TEST patched"
        assert updated["price_nzd"] == 99.5
        assert updated["stock_count"] == 3
        assert updated["in_stock"] is True

    def test_patch_404_for_unknown(self, api_client, seller):
        r = api_client.patch(
            f"{BASE_URL}/api/seller/products/does-not-exist",
            json={"name": "x"},
            headers=seller["headers"],
        )
        assert r.status_code == 404

    def test_delete_listing(self, api_client, seller):
        p = _make_listing(api_client, seller, name="TEST delete me")
        pid = p["id"]
        r = api_client.delete(
            f"{BASE_URL}/api/seller/products/{pid}", headers=seller["headers"]
        )
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        # Second delete → 404
        r2 = api_client.delete(
            f"{BASE_URL}/api/seller/products/{pid}", headers=seller["headers"]
        )
        assert r2.status_code == 404

    def test_bulk_set_price(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST bulk A", price=10)
        b = _make_listing(api_client, seller, name="TEST bulk B", price=20)
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "set_price", "product_ids": [a["id"], b["id"]], "price_nzd": 55.5},
            headers=seller["headers"],
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["action"] == "set_price"
        assert data["matched"] == 2
        # Verify
        r2 = api_client.get(f"{BASE_URL}/api/seller/products", headers=seller["headers"])
        prices = {p["id"]: p["price_nzd"] for p in r2.json()}
        assert prices[a["id"]] == 55.5 and prices[b["id"]] == 55.5

    def test_bulk_adjust_price_pct(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST pct A", price=100)
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "adjust_price_pct", "product_ids": [a["id"]], "pct": -10},
            headers=seller["headers"],
        )
        assert r.status_code == 200
        assert r.json()["matched"] == 1

    def test_bulk_set_stock(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST stk", stock=5)
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "set_stock", "product_ids": [a["id"]], "stock_count": 0},
            headers=seller["headers"],
        )
        assert r.status_code == 200
        # Verify in_stock flipped to False
        r2 = api_client.get(f"{BASE_URL}/api/seller/products", headers=seller["headers"])
        match = next(p for p in r2.json() if p["id"] == a["id"])
        assert match["stock_count"] == 0
        assert match["in_stock"] is False

    def test_bulk_adjust_stock(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST adj", stock=5)
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "adjust_stock", "product_ids": [a["id"]], "stock_delta": 3},
            headers=seller["headers"],
        )
        assert r.status_code == 200

    def test_bulk_set_category(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST cat")
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "set_category", "product_ids": [a["id"]], "category": "Jewellery"},
            headers=seller["headers"],
        )
        assert r.status_code == 200

    def test_bulk_set_in_stock(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST in_stock")
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "set_in_stock", "product_ids": [a["id"]], "in_stock": False},
            headers=seller["headers"],
        )
        assert r.status_code == 200

    def test_bulk_delete(self, api_client, seller):
        a = _make_listing(api_client, seller, name="TEST bdel")
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "delete", "product_ids": [a["id"]]},
            headers=seller["headers"],
        )
        assert r.status_code == 200
        assert r.json()["deleted"] == 1

    def test_bulk_unknown_action_400(self, api_client, seller):
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "nuke", "product_ids": ["x"]},
            headers=seller["headers"],
        )
        assert r.status_code == 400

    def test_bulk_forbidden_for_buyer(self, api_client, buyer):
        r = api_client.post(
            f"{BASE_URL}/api/seller/products/bulk",
            json={"action": "delete", "product_ids": ["x"]},
            headers=buyer["headers"],
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# orders.py — /seller/orders, /seller/payouts, /seller/orders.csv
# ---------------------------------------------------------------------------
class TestSellerOrders:
    def test_seller_orders_empty(self, api_client, seller):
        r = api_client.get(f"{BASE_URL}/api/seller/orders", headers=seller["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_seller_orders_403_for_buyer(self, api_client, buyer):
        r = api_client.get(f"{BASE_URL}/api/seller/orders", headers=buyer["headers"])
        assert r.status_code == 403

    def test_seller_payouts_shape(self, api_client, seller):
        r = api_client.get(f"{BASE_URL}/api/seller/payouts", headers=seller["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("payouts", "lifetime_earnings_nzd", "pending_nzd", "paid_out_nzd"):
            assert key in body
        assert isinstance(body["payouts"], list)

    def test_seller_payouts_403_for_buyer(self, api_client, buyer):
        r = api_client.get(f"{BASE_URL}/api/seller/payouts", headers=buyer["headers"])
        assert r.status_code == 403

    def test_seller_orders_csv_stream(self, api_client, seller):
        r = api_client.get(
            f"{BASE_URL}/api/seller/orders.csv", headers=seller["headers"]
        )
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/csv")
        # First row is the header
        first_line = r.text.splitlines()[0]
        assert "order_id" in first_line and "awb_code" in first_line

    def test_seller_orders_csv_403_for_buyer(self, api_client, buyer):
        r = api_client.get(
            f"{BASE_URL}/api/seller/orders.csv", headers=buyer["headers"]
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# analytics.py — track-view, track-cart-add, analytics, timeseries, insights
# ---------------------------------------------------------------------------
class TestAnalytics:
    def test_track_view_anonymous(self, api_client, seller):
        p = _make_listing(api_client, seller, name="TEST track view")
        r = api_client.post(f"{BASE_URL}/api/products/{p['id']}/track-view")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_track_view_unknown_product(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/products/nope-not-real/track-view")
        assert r.status_code == 200
        assert r.json() == {"ok": False}

    def test_track_cart_add_anonymous(self, api_client, seller):
        p = _make_listing(api_client, seller, name="TEST track cart")
        r = api_client.post(f"{BASE_URL}/api/products/{p['id']}/track-cart-add")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_analytics_shape(self, api_client, seller):
        # Track a view first to ensure counter > 0
        p = _make_listing(api_client, seller, name="TEST analytics shape")
        api_client.post(f"{BASE_URL}/api/products/{p['id']}/track-view")
        r = api_client.get(f"{BASE_URL}/api/seller/analytics", headers=seller["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("listings", "summary", "top_by_views", "top_by_sold"):
            assert key in body
        for key in (
            "total_listings",
            "total_views",
            "total_cart_adds",
            "total_sold",
            "total_revenue_nzd",
            "overall_conversion_pct",
        ):
            assert key in body["summary"]
        assert isinstance(body["top_by_views"], list)
        assert len(body["top_by_views"]) <= 5
        assert len(body["top_by_sold"]) <= 5

    def test_analytics_403_for_buyer(self, api_client, buyer):
        r = api_client.get(f"{BASE_URL}/api/seller/analytics", headers=buyer["headers"])
        assert r.status_code == 403

    def test_timeseries_7_days(self, api_client, seller):
        r = api_client.get(
            f"{BASE_URL}/api/seller/analytics/timeseries?days=7",
            headers=seller["headers"],
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["days"] == 7
        assert isinstance(body["buckets"], list) and len(body["buckets"]) == 7
        sample = body["buckets"][0]
        for key in ("date", "views", "cart_adds", "sold", "revenue_nzd"):
            assert key in sample

    def test_timeseries_30_days(self, api_client, seller):
        r = api_client.get(
            f"{BASE_URL}/api/seller/analytics/timeseries?days=30",
            headers=seller["headers"],
        )
        assert r.status_code == 200
        body = r.json()
        assert body["days"] == 30
        assert len(body["buckets"]) == 30

    def test_timeseries_clamps_to_30(self, api_client, seller):
        r = api_client.get(
            f"{BASE_URL}/api/seller/analytics/timeseries?days=999",
            headers=seller["headers"],
        )
        assert r.status_code == 200
        assert r.json()["days"] == 30

    def test_timeseries_403_for_buyer(self, api_client, buyer):
        r = api_client.get(
            f"{BASE_URL}/api/seller/analytics/timeseries?days=7",
            headers=buyer["headers"],
        )
        assert r.status_code == 403

    def test_insights_30_days(self, api_client, seller):
        r = api_client.get(
            f"{BASE_URL}/api/seller/analytics/insights?days=30",
            headers=seller["headers"],
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["window_days"] == 30
        for k in ("returns", "by_region", "customers"):
            assert k in body
        for k in (
            "total_returns",
            "total_paid_orders",
            "returns_rate_pct",
            "refund_total_nzd",
            "by_reason",
        ):
            assert k in body["returns"]
        for k in (
            "total_unique",
            "repeat_buyers",
            "repeat_rate_pct",
            "by_country",
            "aov_nzd",
        ):
            assert k in body["customers"]
        assert isinstance(body["by_region"], list)

    def test_insights_403_for_buyer(self, api_client, buyer):
        r = api_client.get(
            f"{BASE_URL}/api/seller/analytics/insights?days=30",
            headers=buyer["headers"],
        )
        assert r.status_code == 403
