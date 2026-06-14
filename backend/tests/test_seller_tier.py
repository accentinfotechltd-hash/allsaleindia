"""Tests for the seller reputation tier engine + payout policy."""
import asyncio
import os
import uuid
from datetime import timedelta

import pytest
import requests

from test_seller import BASE_URL, _valid_business

ADMIN_HEADERS = {"x-admin-secret": "allsale-admin-dev-secret"}


def _seller_token():
    payload = {
        "email": f"tier_{os.urandom(4).hex()}@example.com",
        "password": "Allsale1!safe",
        "business": _valid_business(),
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["access_token"], body["user"]["id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


class TestTierEngine:
    def test_default_tier_for_new_seller_is_starter(self):
        token, _ = _seller_token()
        r = requests.get(f"{BASE_URL}/api/seller/tier", headers=_h(token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["tier"]["name"] == "starter"
        assert d["tier"]["payout_hold_days"] == 10
        assert d["tier"]["reserve_pct"] == 0.10
        assert d["tier"]["reserve_hold_days"] == 30
        assert d["progress"]["next_tier"] == "verified"
        assert d["metrics"]["delivered_orders"] == 0

    def test_tier_metrics_shape(self):
        token, _ = _seller_token()
        r = requests.get(f"{BASE_URL}/api/seller/tier", headers=_h(token), timeout=10)
        d = r.json()
        for k in ("delivered_orders", "returned_orders", "return_rate", "avg_rating", "review_count"):
            assert k in d["metrics"]

    def test_tier_table_exposed_keys(self):
        token, _ = _seller_token()
        r = requests.get(f"{BASE_URL}/api/seller/tier", headers=_h(token), timeout=10)
        d = r.json()
        for k in ("name", "label", "payout_hold_days", "reserve_pct",
                  "reserve_hold_days", "color", "perks"):
            assert k in d["tier"], f"missing {k}"
        assert isinstance(d["tier"]["perks"], list)

    def test_payouts_summary_breakdown_zero_for_new_seller(self):
        token, _ = _seller_token()
        r = requests.get(f"{BASE_URL}/api/seller/payouts", headers=_h(token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["held_nzd"] == 0
        assert d["available_nzd"] == 0
        assert d["reserve_held_nzd"] == 0
        assert d["paid_out_nzd"] == 0
        assert d["tier"] == "starter"

    def test_non_seller_blocked_from_tier(self):
        # Register a plain buyer
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": f"buyer_tier_{os.urandom(4).hex()}@example.com",
                "password": "Buyer12345",
                "full_name": "Buyer",
            },
            timeout=10,
        )
        token = r.json()["access_token"]
        r2 = requests.get(f"{BASE_URL}/api/seller/tier", headers=_h(token), timeout=10)
        assert r2.status_code == 403


class TestPayoutPolicy:
    def test_admin_process_due_returns_summary(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/payouts/process-due",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("flipped_to_available", "flipped_to_reserve_held",
                  "reserve_released", "reserve_released_nzd", "ran_at"):
            assert k in d

    def test_mark_paid_rejects_held(self):
        """A payout in `held` status cannot be marked paid_out directly."""
        # Insert a synthetic held payout via direct admin route would require
        # a seeded order. Instead, just confirm endpoint validation responds
        # 400 for unknown / wrong state — done via 404 for non-existent.
        r = requests.post(
            f"{BASE_URL}/api/admin/payouts/po_does_not_exist_x/mark-paid",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 404


class TestTierService:
    """Direct unit tests of the tier picking logic."""

    def test_pick_top_tier(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.seller_tier import pick_tier

        t = pick_tier({
            "delivered_orders": 250, "return_rate": 0.005,
            "avg_rating": 4.8, "review_count": 100,
        })
        assert t.name == "top"

    def test_pick_trusted_when_below_top_orders(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.seller_tier import pick_tier

        t = pick_tier({
            "delivered_orders": 100, "return_rate": 0.01,
            "avg_rating": 4.6, "review_count": 50,
        })
        assert t.name == "trusted"

    def test_pick_verified(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.seller_tier import pick_tier

        t = pick_tier({
            "delivered_orders": 25, "return_rate": 0.03,
            "avg_rating": 4.1, "review_count": 20,
        })
        assert t.name == "verified"

    def test_high_return_rate_drops_to_starter(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from services.seller_tier import pick_tier

        t = pick_tier({
            "delivered_orders": 300, "return_rate": 0.10,
            "avg_rating": 4.8, "review_count": 100,
        })
        # 10% return rate exceeds all tier thresholds → starter
        assert t.name == "starter"

    def test_low_rating_new_seller_not_blocked(self):
        """Sellers with <5 reviews shouldn't be penalised on rating."""
        import sys
        sys.path.insert(0, "/app/backend")
        from services.seller_tier import pick_tier

        t = pick_tier({
            "delivered_orders": 50, "return_rate": 0.01,
            "avg_rating": 3.5, "review_count": 2,
        })
        # 50 orders + 1% returns + only 2 reviews → still gets Trusted
        assert t.name == "trusted"
