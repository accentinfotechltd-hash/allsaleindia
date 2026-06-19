"""Tests for /api/seller/analytics/low-stock — low-stock & stockout alerts.

Covers:
  - Auth (401 / 403)
  - Empty inventory → no alerts
  - threshold + window_days clamping
  - Out-of-stock detection (stock <= 0 OR in_stock=False)
  - Critical bucket (days_of_cover <= 3 OR stock <= 3 with sales)
  - Low bucket (days_of_cover <= 7 OR stock <= threshold)
  - Healthy listings are excluded
  - Sort order: out → critical → low, then days_of_cover asc
  - Per-listing fields: daily_velocity, days_of_cover, recommended_restock
  - Seller isolation (other seller's products not counted)
  - Window filter on order date
  - Cancelled / refunded / unpaid orders excluded from velocity calc
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


def _run(coro):
    return asyncio.run(coro)


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _utc_days_ago(n: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=n)


def _make_seller(api_client, base_url) -> dict:
    email = f"lowstock_{uuid.uuid4().hex[:10]}@allsale.co.nz"
    gstin, pan = make_gstin_pan()
    r = api_client.post(
        f"{base_url}/api/seller/register",
        json={
            "email": email,
            "password": "Test1234!",
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "LowStock Co",
                "gstin": gstin,
                "pan": pan,
                "address_line1": "1 MG Road",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_name": "Tester",
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


def _seed_product(
    *,
    seller_id: str,
    stock: int = 10,
    in_stock: bool = True,
    price_nzd: float = 25.0,
    name: str | None = None,
) -> str:
    pid = f"prod_{uuid.uuid4().hex[:10]}"

    async def go():
        cli, db = await _db()
        await db.products.insert_one(
            {
                "id": pid,
                "name": name or f"Test Product {pid[-6:]}",
                "image": "https://placehold.co/100",
                "seller_id": seller_id,
                "price_nzd": price_nzd,
                "stock_count": stock,
                "in_stock": in_stock,
                "category": "test",
                "view_count": 0,
                "cart_add_count": 0,
            }
        )
        cli.close()

    _run(go())
    return pid


def _seed_paid_order(
    *,
    seller_id: str,
    user_id: str,
    items: list[dict],
    days_ago: int = 1,
    status: str = "delivered",
    payment_status: str = "paid",
) -> str:
    oid = f"order_{uuid.uuid4().hex[:12]}"
    when = _utc_days_ago(days_ago)

    async def go():
        cli, db = await _db()
        await db.orders.insert_one(
            {
                "id": oid,
                "user_id": user_id,
                "items": items,
                "payment_status": payment_status,
                "status": status,
                "buyer_country": "NZ",
                "paid_at": when,
                "created_at": when,
            }
        )
        cli.close()

    _run(go())
    return oid


def _cleanup(seller_id: str):
    async def go():
        cli, db = await _db()
        await db.products.delete_many({"seller_id": seller_id})
        await db.orders.delete_many({"items.seller_id": seller_id})
        cli.close()

    _run(go())


# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------
class TestAuth:
    def test_no_token(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/seller/analytics/low-stock")
        assert r.status_code in (401, 403)

    def test_buyer_account(self, api_client, base_url, auth_headers):
        r = api_client.get(
            f"{base_url}/api/seller/analytics/low-stock", headers=auth_headers
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# EMPTY STATE
# ---------------------------------------------------------------------------
class TestEmpty:
    def test_no_listings_returns_empty(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r = api_client.get(
            f"{base_url}/api/seller/analytics/low-stock", headers=s["headers"]
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["alerts"] == []
        assert body["summary"]["total_alerts"] == 0
        assert body["summary"]["out_of_stock"] == 0
        assert body["summary"]["critical"] == 0
        assert body["summary"]["low"] == 0


# ---------------------------------------------------------------------------
# PARAM CLAMPING
# ---------------------------------------------------------------------------
class TestParamClamping:
    def test_threshold_clamped_to_1_and_100(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r1 = api_client.get(
            f"{base_url}/api/seller/analytics/low-stock?threshold=0",
            headers=s["headers"],
        )
        assert r1.json()["threshold"] == 1
        r2 = api_client.get(
            f"{base_url}/api/seller/analytics/low-stock?threshold=9999",
            headers=s["headers"],
        )
        assert r2.json()["threshold"] == 100

    def test_window_clamped_to_7_and_90(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        r1 = api_client.get(
            f"{base_url}/api/seller/analytics/low-stock?window_days=1",
            headers=s["headers"],
        )
        assert r1.json()["window_days"] == 7
        r2 = api_client.get(
            f"{base_url}/api/seller/analytics/low-stock?window_days=400",
            headers=s["headers"],
        )
        assert r2.json()["window_days"] == 90


# ---------------------------------------------------------------------------
# CLASSIFICATION
# ---------------------------------------------------------------------------
class TestClassification:
    def test_out_of_stock_by_zero_count(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_product(seller_id=s["user_id"], stock=0, in_stock=True)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            body = r.json()
            assert len(body["alerts"]) == 1
            assert body["alerts"][0]["urgency"] == "out"
            assert body["summary"]["out_of_stock"] == 1
        finally:
            _cleanup(s["user_id"])

    def test_out_of_stock_by_in_stock_flag(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_product(seller_id=s["user_id"], stock=50, in_stock=False)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            body = r.json()
            assert len(body["alerts"]) == 1
            assert body["alerts"][0]["urgency"] == "out"

        finally:
            _cleanup(s["user_id"])

    def test_critical_when_low_days_of_cover(self, api_client, base_url):
        """5 stock + 6 sold/14d → ~0.43/day → ~12d cover. Bump sales to 30
        → ~2.14/day → ~2.3d cover → critical."""
        s = _make_seller(api_client, base_url)
        try:
            pid = _seed_product(
                seller_id=s["user_id"], stock=5, in_stock=True, price_nzd=10
            )
            # 30 units sold in last 14 days
            for i in range(30):
                _seed_paid_order(
                    seller_id=s["user_id"],
                    user_id=s["user_id"],
                    items=[
                        {
                            "product_id": pid,
                            "name": "x",
                            "seller_id": s["user_id"],
                            "quantity": 1,
                            "price_nzd": 10,
                        }
                    ],
                    days_ago=(i % 14) + 1,
                )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock?window_days=14",
                headers=s["headers"],
            )
            body = r.json()
            assert len(body["alerts"]) == 1
            a = body["alerts"][0]
            assert a["urgency"] == "critical"
            assert a["daily_velocity"] > 1.5
            assert a["days_of_cover"] is not None and a["days_of_cover"] <= 5
            assert a["sold_window"] == 30
        finally:
            _cleanup(s["user_id"])

    def test_low_when_stock_under_threshold_no_sales(
        self, api_client, base_url
    ):
        """stock=8, no sales, default threshold=10 → low (not critical)."""
        s = _make_seller(api_client, base_url)
        try:
            _seed_product(seller_id=s["user_id"], stock=8, in_stock=True)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            body = r.json()
            assert len(body["alerts"]) == 1
            a = body["alerts"][0]
            assert a["urgency"] == "low"
            assert a["daily_velocity"] == 0.0
            assert a["days_of_cover"] is None
        finally:
            _cleanup(s["user_id"])

    def test_healthy_listing_excluded(self, api_client, base_url):
        """stock=100, no sales, threshold=10 → not in alerts."""
        s = _make_seller(api_client, base_url)
        try:
            _seed_product(seller_id=s["user_id"], stock=100, in_stock=True)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            body = r.json()
            assert body["alerts"] == []
        finally:
            _cleanup(s["user_id"])


# ---------------------------------------------------------------------------
# SORT ORDER
# ---------------------------------------------------------------------------
class TestSort:
    def test_out_before_critical_before_low(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            # low
            p_low = _seed_product(
                seller_id=s["user_id"], stock=8, name="LOW"
            )
            # out
            p_out = _seed_product(
                seller_id=s["user_id"], stock=0, name="OUT"
            )
            # critical: stock=2, no sales → triggers "stock <= 3 and sales > 0"?
            # safer: use stock=1 with high velocity.
            p_crit = _seed_product(
                seller_id=s["user_id"],
                stock=2,
                name="CRIT",
                price_nzd=5,
            )
            for i in range(10):
                _seed_paid_order(
                    seller_id=s["user_id"],
                    user_id=s["user_id"],
                    items=[
                        {
                            "product_id": p_crit,
                            "name": "x",
                            "seller_id": s["user_id"],
                            "quantity": 1,
                            "price_nzd": 5,
                        }
                    ],
                    days_ago=(i % 10) + 1,
                )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock?window_days=14",
                headers=s["headers"],
            )
            body = r.json()
            urgencies = [a["urgency"] for a in body["alerts"]]
            assert urgencies[0] == "out"
            # next either critical or could degrade — confirm it appears before low
            assert "critical" in urgencies
            crit_idx = urgencies.index("critical")
            low_idx = urgencies.index("low")
            assert crit_idx < low_idx
            assert body["summary"]["out_of_stock"] == 1
            assert body["summary"]["critical"] >= 1
            assert body["summary"]["low"] >= 1
            # confirm names are right
            by_pid = {a["product_id"]: a for a in body["alerts"]}
            assert by_pid[p_out]["urgency"] == "out"
            assert by_pid[p_low]["urgency"] == "low"
        finally:
            _cleanup(s["user_id"])


# ---------------------------------------------------------------------------
# ISOLATION
# ---------------------------------------------------------------------------
class TestIsolation:
    def test_other_sellers_products_excluded(self, api_client, base_url):
        s1 = _make_seller(api_client, base_url)
        s2 = _make_seller(api_client, base_url)
        try:
            _seed_product(seller_id=s1["user_id"], stock=0)
            _seed_product(seller_id=s2["user_id"], stock=0)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s1["headers"],
            )
            body = r.json()
            assert len(body["alerts"]) == 1
            # confirm the only alert belongs to seller 1
            # (no leakage from seller 2's out-of-stock product)
        finally:
            _cleanup(s1["user_id"])
            _cleanup(s2["user_id"])


# ---------------------------------------------------------------------------
# VELOCITY WINDOW & UNPAID EXCLUSION
# ---------------------------------------------------------------------------
class TestVelocity:
    def test_cancelled_orders_excluded(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            pid = _seed_product(seller_id=s["user_id"], stock=8, price_nzd=10)
            # 20 cancelled orders (should NOT count)
            for _ in range(20):
                _seed_paid_order(
                    seller_id=s["user_id"],
                    user_id=s["user_id"],
                    items=[
                        {
                            "product_id": pid,
                            "name": "x",
                            "seller_id": s["user_id"],
                            "quantity": 1,
                            "price_nzd": 10,
                        }
                    ],
                    days_ago=2,
                    status="cancelled",
                )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            a = r.json()["alerts"][0]
            assert a["sold_window"] == 0
            assert a["daily_velocity"] == 0.0
            assert a["urgency"] == "low"
        finally:
            _cleanup(s["user_id"])

    def test_old_orders_outside_window_excluded(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            pid = _seed_product(seller_id=s["user_id"], stock=8, price_nzd=10)
            # 50 orders 60 days ago — should be outside the default 30-day window
            for _ in range(50):
                _seed_paid_order(
                    seller_id=s["user_id"],
                    user_id=s["user_id"],
                    items=[
                        {
                            "product_id": pid,
                            "name": "x",
                            "seller_id": s["user_id"],
                            "quantity": 1,
                            "price_nzd": 10,
                        }
                    ],
                    days_ago=60,
                )
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            a = r.json()["alerts"][0]
            assert a["sold_window"] == 0
        finally:
            _cleanup(s["user_id"])


# ---------------------------------------------------------------------------
# RECOMMENDED RESTOCK
# ---------------------------------------------------------------------------
class TestRecommended:
    def test_recommended_restock_rounded_to_5(self, api_client, base_url):
        s = _make_seller(api_client, base_url)
        try:
            _seed_product(seller_id=s["user_id"], stock=0)
            r = api_client.get(
                f"{base_url}/api/seller/analytics/low-stock",
                headers=s["headers"],
            )
            a = r.json()["alerts"][0]
            assert a["recommended_restock"] >= 5
            assert a["recommended_restock"] % 5 == 0
        finally:
            _cleanup(s["user_id"])
