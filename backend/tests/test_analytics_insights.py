"""Tests for the new seller analytics insights endpoint.

Endpoint: GET /api/seller/analytics/insights?days=N

Covers:
  - Auth (401 / 403)
  - days clamping (1..365) and default (30)
  - Empty state (no paid orders)
  - Returns rate math + divide-by-zero
  - Refund total filtering (only refunded/approved)
  - Window filtering on orders & returns
  - Excluded orders (cancelled/refunded)
  - Seller isolation (other seller's items in same order not counted)
  - Region grouping (uppercase + missing -> NZ) & share_pct math
  - AOV math
  - Repeat-rate math
  - by_reason normalization (lowercase) + sort by count desc
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from tests._helpers import make_gstin_pan


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


# ---------------------------------------------------------------------------
# DB helpers (sync wrappers around motor for test ergonomics)
# ---------------------------------------------------------------------------
def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _utc_days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


def _make_seller(api_client, base_url) -> dict:
    """Register a fresh verified seller. Returns headers + ids."""
    email = f"insights_{uuid.uuid4().hex[:10]}@allsale.co.nz"
    gstin, pan = make_gstin_pan()
    r = api_client.post(
        f"{base_url}/api/seller/register",
        json={
            "email": email,
            "password": "Test1234!",
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "Insights Co",
                "gstin": gstin,
                "pan": pan,
                "address_line1": "1 MG Road",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_name": "Insights Tester",
                "contact_phone": "+919999999999",
            },
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return {
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {body['access_token']}",
        },
        "user_id": body["user"]["id"],
        "email": email,
    }


def _seed_paid_order(
    *,
    seller_id: str,
    user_id: str,
    buyer_country: str | None = "NZ",
    items: list[dict] | None = None,
    days_ago: int = 1,
    status: str = "delivered",
    payment_status: str = "paid",
    extra_seller_items: list[dict] | None = None,
) -> str:
    """Insert a paid order directly into db.orders.

    `items` are this seller's items. `extra_seller_items` are items belonging
    to OTHER sellers (used for the isolation test).
    """
    if items is None:
        items = [
            {
                "product_id": f"p_{uuid.uuid4().hex[:8]}",
                "name": "Test Item",
                "seller_id": seller_id,
                "quantity": 1,
                "price_nzd": 50.0,
            }
        ]
    all_items = list(items) + list(extra_seller_items or [])
    order_id = f"order_{uuid.uuid4().hex[:12]}"
    when = _utc_days_ago(days_ago)
    doc = {
        "id": order_id,
        "user_id": user_id,
        "items": all_items,
        "payment_status": payment_status,
        "status": status,
        "buyer_country": buyer_country,
        "paid_at": when,
        "created_at": when,
    }

    async def go():
        cli, db = await _db()
        await db.orders.insert_one(doc)
        cli.close()

    _run(go())
    return order_id


def _seed_return(
    *,
    seller_id: str,
    reason: str = "defective",
    status: str = "refunded",
    refund_amount_nzd: float = 25.0,
    days_ago: int = 1,
) -> str:
    rid = f"rtn_{uuid.uuid4().hex[:10]}"

    async def go():
        cli, db = await _db()
        await db.returns.insert_one(
            {
                "id": rid,
                "seller_id": seller_id,
                "reason": reason,
                "status": status,
                "refund_amount_nzd": refund_amount_nzd,
                "created_at": _utc_days_ago(days_ago),
            }
        )
        cli.close()

    _run(go())
    return rid


def _cleanup(seller_id: str):
    """Best-effort cleanup of seeded test data for the given seller."""

    async def go():
        cli, db = await _db()
        await db.orders.delete_many({"items.seller_id": seller_id})
        await db.returns.delete_many({"seller_id": seller_id})
        cli.close()

    _run(go())


# ---------------------------------------------------------------------------
# AUTH TESTS
# ---------------------------------------------------------------------------
class TestAuth:
    def test_no_token_returns_401_or_403(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/seller/analytics/insights")
        assert r.status_code in (401, 403), r.text

    def test_buyer_account_returns_403(self, api_client, base_url, auth_headers):
        # auth_headers is the default non-seller test user from conftest
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights", headers=auth_headers
        )
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# QUERY PARAM HANDLING
# ---------------------------------------------------------------------------
class TestDaysParam:
    def test_default_days_is_30(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights", headers=s["headers"]
        )
        assert r.status_code == 200, r.text
        assert r.json()["window_days"] == 30

    def test_days_clamped_high(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights?days=9999",
            headers=s["headers"],
        )
        assert r.status_code == 200
        assert r.json()["window_days"] == 365

    def test_days_clamped_low(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights?days=0",
            headers=s["headers"],
        )
        assert r.status_code == 200
        assert r.json()["window_days"] == 1

    def test_days_negative_clamped_to_1(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights?days=-7",
            headers=s["headers"],
        )
        assert r.status_code == 200
        assert r.json()["window_days"] == 1


# ---------------------------------------------------------------------------
# EMPTY-STATE
# ---------------------------------------------------------------------------
class TestEmptyState:
    def test_empty_seller_has_zero_everything(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights?days=30",
            headers=s["headers"],
        )
        assert r.status_code == 200
        body = r.json()
        assert body["window_days"] == 30
        ret = body["returns"]
        assert ret["total_returns"] == 0
        assert ret["total_paid_orders"] == 0
        assert ret["returns_rate_pct"] == 0.0  # no divide-by-zero
        assert ret["refund_total_nzd"] == 0.0
        assert ret["by_reason"] == []
        assert body["by_region"] == []
        cust = body["customers"]
        assert cust["total_unique"] == 0
        assert cust["repeat_buyers"] == 0
        assert cust["repeat_rate_pct"] == 0.0
        assert cust["aov_nzd"] == 0.0
        assert cust["by_country"] == []


# ---------------------------------------------------------------------------
# RETURNS MATH
# ---------------------------------------------------------------------------
class TestReturns:
    def test_returns_rate_math(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            # 4 paid orders + 1 return -> rate = 25.0
            for _ in range(4):
                _seed_paid_order(seller_id=s["user_id"], user_id=f"u_{uuid.uuid4().hex[:8]}")
            _seed_return(seller_id=s["user_id"])
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200, r.text
            ret = r.json()["returns"]
            assert ret["total_paid_orders"] == 4
            assert ret["total_returns"] == 1
            assert ret["returns_rate_pct"] == 25.0
        finally:
            _cleanup(s["user_id"])

    def test_refund_total_only_counts_refunded_and_approved(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_paid_order(seller_id=s["user_id"], user_id="u_a")
            _seed_return(seller_id=s["user_id"], status="refunded", refund_amount_nzd=10.0)
            _seed_return(seller_id=s["user_id"], status="approved", refund_amount_nzd=15.0)
            _seed_return(seller_id=s["user_id"], status="pending_seller", refund_amount_nzd=999.0)
            _seed_return(seller_id=s["user_id"], status="rejected", refund_amount_nzd=999.0)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            ret = r.json()["returns"]
            assert ret["total_returns"] == 4
            assert ret["refund_total_nzd"] == 25.0
        finally:
            _cleanup(s["user_id"])

    def test_returns_outside_window_excluded(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_paid_order(seller_id=s["user_id"], user_id="u_in", days_ago=1)
            _seed_return(seller_id=s["user_id"], days_ago=2)            # inside
            _seed_return(seller_id=s["user_id"], days_ago=20)           # outside (7-day window)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=7",
                headers=s["headers"],
            )
            assert r.status_code == 200
            assert r.json()["returns"]["total_returns"] == 1
        finally:
            _cleanup(s["user_id"])

    def test_by_reason_sorted_desc_and_lowercase(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_paid_order(seller_id=s["user_id"], user_id="u_a")
            for _ in range(3):
                _seed_return(seller_id=s["user_id"], reason="DEFECTIVE")
            for _ in range(2):
                _seed_return(seller_id=s["user_id"], reason="Damaged_On_Arrival")
            _seed_return(seller_id=s["user_id"], reason="other")
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            br = r.json()["returns"]["by_reason"]
            # All lowercased
            for entry in br:
                assert entry["reason"] == entry["reason"].lower()
            # Sorted desc by count
            counts = [e["count"] for e in br]
            assert counts == sorted(counts, reverse=True)
            # Specific values
            by_reason = {e["reason"]: e["count"] for e in br}
            assert by_reason.get("defective") == 3
            assert by_reason.get("damaged_on_arrival") == 2
            assert by_reason.get("other") == 1
        finally:
            _cleanup(s["user_id"])


# ---------------------------------------------------------------------------
# REGION / REVENUE / SELLER ISOLATION
# ---------------------------------------------------------------------------
class TestByRegion:
    def test_seller_isolation_other_sellers_items_excluded(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            # This seller's item: 2 x $50 = $100
            my_items = [{
                "product_id": "p1",
                "name": "Mine",
                "seller_id": s["user_id"],
                "quantity": 2,
                "price_nzd": 50.0,
            }]
            # Other seller's items in the SAME order: should NOT inflate numbers
            other_items = [{
                "product_id": "p_other",
                "name": "Not mine",
                "seller_id": "seller_other_xyz",
                "quantity": 5,
                "price_nzd": 999.0,
            }]
            _seed_paid_order(
                seller_id=s["user_id"],
                user_id="u_iso",
                buyer_country="NZ",
                items=my_items,
                extra_seller_items=other_items,
            )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            body = r.json()
            nz = next(b for b in body["by_region"] if b["country"] == "NZ")
            assert nz["revenue_nzd"] == 100.0
            assert nz["units"] == 2
            assert nz["orders"] == 1
            # AOV matches just this seller's revenue, not other seller's
            assert body["customers"]["aov_nzd"] == 100.0
        finally:
            _cleanup(s["user_id"])

    def test_country_grouping_uppercase_and_missing_default_to_NZ(
        self, api_client, base_url
    ):
        s = _make_seller(api_client, base_url)
        try:
            # lowercase 'au'
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_au", buyer_country="au"
            )
            # missing buyer_country -> NZ
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_nz", buyer_country=None
            )
            # mixed case 'Us'
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_us", buyer_country="Us"
            )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            countries = {b["country"]: b for b in r.json()["by_region"]}
            assert "AU" in countries
            assert "NZ" in countries
            assert "US" in countries
            # flags applied
            assert countries["AU"]["flag"] == "🇦🇺"
            assert countries["NZ"]["flag"] == "🇳🇿"
            assert countries["US"]["flag"] == "🇺🇸"
        finally:
            _cleanup(s["user_id"])

    def test_share_pct_math_sums_to_100(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            # NZ: $200, AU: $100, US: $100 -> NZ 50%, AU 25%, US 25%
            for _ in range(2):
                _seed_paid_order(
                    seller_id=s["user_id"],
                    user_id=f"u_nz_{uuid.uuid4().hex[:6]}",
                    buyer_country="NZ",
                    items=[{
                        "product_id": "p", "name": "x",
                        "seller_id": s["user_id"], "quantity": 1, "price_nzd": 100.0,
                    }],
                )
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_au_x", buyer_country="AU",
                items=[{"product_id": "p", "name": "x",
                        "seller_id": s["user_id"], "quantity": 1, "price_nzd": 100.0}],
            )
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_us_x", buyer_country="US",
                items=[{"product_id": "p", "name": "x",
                        "seller_id": s["user_id"], "quantity": 1, "price_nzd": 100.0}],
            )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            by_region = r.json()["by_region"]
            # sorted desc by revenue
            revs = [b["revenue_nzd"] for b in by_region]
            assert revs == sorted(revs, reverse=True)
            # share_pct sums to ~100
            total_share = sum(b["share_pct"] for b in by_region)
            assert abs(total_share - 100.0) < 0.5
            # NZ should be at the top (highest revenue)
            assert by_region[0]["country"] == "NZ"
            assert by_region[0]["share_pct"] == 50.0
        finally:
            _cleanup(s["user_id"])

    def test_orders_outside_window_excluded(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_in", days_ago=2
            )
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u_out", days_ago=40
            )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=7",
                headers=s["headers"],
            )
            assert r.status_code == 200
            assert r.json()["returns"]["total_paid_orders"] == 1
        finally:
            _cleanup(s["user_id"])

    def test_cancelled_and_refunded_orders_excluded(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_paid_order(seller_id=s["user_id"], user_id="u_ok", status="delivered")
            _seed_paid_order(seller_id=s["user_id"], user_id="u_cx", status="cancelled")
            _seed_paid_order(seller_id=s["user_id"], user_id="u_rf", status="refunded")
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            body = r.json()
            assert body["returns"]["total_paid_orders"] == 1
            # only the 1 delivered NZ order shows up in regions
            assert len(body["by_region"]) == 1
            assert body["customers"]["total_unique"] == 1
        finally:
            _cleanup(s["user_id"])


# ---------------------------------------------------------------------------
# CUSTOMERS
# ---------------------------------------------------------------------------
class TestCustomers:
    def test_aov_math(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            # 2 orders, total seller revenue $100 + $50 = $150 / 2 = $75
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u1",
                items=[{"product_id": "p", "name": "x",
                        "seller_id": s["user_id"], "quantity": 1, "price_nzd": 100.0}],
            )
            _seed_paid_order(
                seller_id=s["user_id"], user_id="u2",
                items=[{"product_id": "p", "name": "x",
                        "seller_id": s["user_id"], "quantity": 1, "price_nzd": 50.0}],
            )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            assert r.json()["customers"]["aov_nzd"] == 75.0
        finally:
            _cleanup(s["user_id"])

    def test_repeat_rate(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            # u1 has 2 orders, u2 has 1, u3 has 1 -> repeat rate = 1/3 = 33.3
            for _ in range(2):
                _seed_paid_order(seller_id=s["user_id"], user_id="repeat_u1")
            _seed_paid_order(seller_id=s["user_id"], user_id="repeat_u2")
            _seed_paid_order(seller_id=s["user_id"], user_id="repeat_u3")
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            cust = r.json()["customers"]
            assert cust["total_unique"] == 3
            assert cust["repeat_buyers"] == 1
            assert cust["repeat_rate_pct"] == 33.3
        finally:
            _cleanup(s["user_id"])

    def test_customers_by_country_breakdown(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_paid_order(seller_id=s["user_id"], user_id="cust_nz1", buyer_country="NZ")
            _seed_paid_order(seller_id=s["user_id"], user_id="cust_nz2", buyer_country="NZ")
            _seed_paid_order(seller_id=s["user_id"], user_id="cust_au1", buyer_country="AU")
            r = api_client.get(
                f"{base_url}/api/seller/analytics/insights?days=30",
                headers=s["headers"],
            )
            assert r.status_code == 200
            bc = {b["country"]: b for b in r.json()["customers"]["by_country"]}
            assert bc["NZ"]["count"] == 2
            assert bc["AU"]["count"] == 1
            # shares add to 100
            assert abs(sum(b["share_pct"] for b in bc.values()) - 100.0) < 0.5
        finally:
            _cleanup(s["user_id"])


# ---------------------------------------------------------------------------
# RESPONSE SHAPE — sanity check the payload contract
# ---------------------------------------------------------------------------
class TestResponseShape:
    def test_response_keys(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/insights?days=30",
            headers=s["headers"],
        )
        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) == {"window_days", "returns", "by_region", "customers"}
        assert set(body["returns"].keys()) == {
            "total_returns", "total_paid_orders", "returns_rate_pct",
            "refund_total_nzd", "by_reason",
        }
        assert set(body["customers"].keys()) == {
            "total_unique", "repeat_buyers", "repeat_rate_pct", "by_country", "aov_nzd",
        }
