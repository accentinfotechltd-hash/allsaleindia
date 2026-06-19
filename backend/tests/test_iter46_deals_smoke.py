"""Iteration 46 — Smoke tests for /deals page backend dependencies.

Endpoints validated (no NEW endpoints in this sprint — regression only):
 - GET /api/flash-sales/active   (public, no auth)
 - GET /api/products?min_discount_pct=10  (public)
 - GET /api/coupons/active       (auth required)
"""
from __future__ import annotations
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://allsale-shop.preview.emergentagent.com").rstrip("/")
BUYER_EMAIL = "buyer@example.com"
BUYER_PASS = "Buyer2026!"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def buyer_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": BUYER_EMAIL, "password": BUYER_PASS})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


class TestFlashSalesActivePublic:
    def test_public_no_auth(self, session):
        r = session.get(f"{BASE_URL}/api/flash-sales/active")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_shape_when_present(self, session):
        r = session.get(f"{BASE_URL}/api/flash-sales/active?limit=20")
        assert r.status_code == 200
        for sale in r.json():
            # Required fields used by /deals UI
            for key in ("id", "product_id", "product_name", "product_image",
                        "sale_price_nzd", "original_price_nzd", "discount_pct",
                        "ends_at", "starts_at", "units_sold", "units_max",
                        "is_deal_of_the_day", "sold_out"):
                assert key in sale, f"missing {key} in flash sale doc"
            assert sale["discount_pct"] >= 0
            assert sale["sale_price_nzd"] < sale["original_price_nzd"]


class TestProductsMinDiscountFacet:
    def test_min_discount_pct_filter(self, session):
        r = session.get(f"{BASE_URL}/api/products?min_discount_pct=10&limit=20")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_unfiltered_returns_more_or_equal(self, session):
        r_all = session.get(f"{BASE_URL}/api/products?limit=100")
        r_filt = session.get(f"{BASE_URL}/api/products?min_discount_pct=10&limit=100")
        assert r_all.status_code == 200
        assert r_filt.status_code == 200
        # Filter is a subset
        assert len(r_filt.json()) <= len(r_all.json())


class TestCouponsActiveAuthGated:
    def test_anonymous_401(self, session):
        # Use a separate session to avoid carrying auth headers
        s2 = requests.Session()
        r = s2.get(f"{BASE_URL}/api/coupons/active")
        assert r.status_code == 401

    def test_auth_returns_list(self, session, buyer_token):
        r = session.get(
            f"{BASE_URL}/api/coupons/active",
            headers={"Authorization": f"Bearer {buyer_token}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        for c in data:
            for key in ("code", "description", "type", "value", "min_order_nzd", "scope"):
                assert key in c, f"missing {key}"
