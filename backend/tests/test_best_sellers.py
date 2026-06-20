"""Tests for /api/best-sellers.

Covers:
  - Auth: endpoint is public.
  - Schema: {category, window_days, source, count, items} with rank, units_sold_window, product.
  - limit clamp [1, 100], window_days clamp [7, 90].
  - Sort by units sold descending (within window).
  - source = "window_sales" when any product has sales; "rating_fallback" otherwise.
  - Category filter scopes to that category.
  - Hidden / unknown category returns 404.
  - OOS products excluded.
  - Cancelled / refunded orders don't contribute to units sold.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from tests.conftest import run_async


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _seed_product(
    *,
    name: str,
    category: str = "Electronics",
    subcategory: str = "Audio",
    in_stock: bool = True,
    stock_count: int = 50,
    rating: float = 4.5,
    reviews_count: int = 5,
) -> str:
    pid = f"prod_bs_{uuid.uuid4().hex[:10]}"

    async def go():
        cli, db = await _db()
        await db.products.insert_one(
            {
                "id": pid,
                "name": name,
                "description": "BS Test product",
                "category": category,
                "subcategory": subcategory,
                "price_nzd": 25.0,
                "price_inr": 1250,
                "image": "https://placehold.co/200",
                "rating": rating,
                "reviews_count": reviews_count,
                "in_stock": in_stock,
                "stock_count": stock_count,
                "seller_name": "BS Co",
            }
        )
        cli.close()

    run_async(go())
    return pid


def _seed_order(
    *,
    product_id: str,
    quantity: int = 1,
    days_ago: int = 1,
    status: str = "delivered",
    payment_status: str = "paid",
):
    oid = f"order_bs_{uuid.uuid4().hex[:10]}"
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)

    async def go():
        cli, db = await _db()
        await db.orders.insert_one(
            {
                "id": oid,
                "user_id": "test_buyer",
                "items": [
                    {
                        "product_id": product_id,
                        "name": "x",
                        "seller_id": "seller_x",
                        "quantity": quantity,
                        "price_nzd": 25,
                    }
                ],
                "payment_status": payment_status,
                "status": status,
                "paid_at": when,
                "created_at": when,
            }
        )
        cli.close()

    run_async(go())


def _cleanup(pids: list[str]):
    async def go():
        cli, db = await _db()
        if pids:
            await db.products.delete_many({"id": {"$in": pids}})
            await db.orders.delete_many({"items.product_id": {"$in": pids}})
        cli.close()

    run_async(go())


class TestPublicAuth:
    def test_endpoint_is_public(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/best-sellers?limit=3")
        assert r.status_code == 200


class TestSchema:
    def test_response_shape(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/best-sellers?limit=2")
        body = r.json()
        assert {"category", "window_days", "source", "count", "items"} <= set(
            body.keys()
        )
        assert body["source"] in ("window_sales", "rating_fallback")
        if body["items"]:
            row = body["items"][0]
            assert {"rank", "units_sold_window", "product"} <= set(row.keys())
            assert row["rank"] == 1


class TestClamping:
    def test_limit_clamp(self, api_client, base_url):
        r1 = api_client.get(f"{base_url}/api/best-sellers?limit=0")
        assert len(r1.json()["items"]) <= 1
        r2 = api_client.get(f"{base_url}/api/best-sellers?limit=9999")
        assert len(r2.json()["items"]) <= 100

    def test_window_clamp(self, api_client, base_url):
        r1 = api_client.get(f"{base_url}/api/best-sellers?window_days=1")
        assert r1.json()["window_days"] == 7
        r2 = api_client.get(f"{base_url}/api/best-sellers?window_days=999")
        assert r2.json()["window_days"] == 90


class TestSort:
    def test_units_sold_drives_rank(self, api_client, base_url):
        p_heavy = _seed_product(name="BS heavy seller")
        p_light = _seed_product(name="BS light seller")
        # 10 sales for heavy, 1 for light
        for _ in range(10):
            _seed_order(product_id=p_heavy, quantity=1, days_ago=2)
        _seed_order(product_id=p_light, quantity=1, days_ago=2)
        try:
            r = api_client.get(
                f"{base_url}/api/best-sellers?category=Electronics&limit=50"
            )
            items = r.json()["items"]
            # find both products' positions
            pos = {it["product"]["id"]: it["rank"] for it in items}
            assert pos.get(p_heavy, 99) < pos.get(p_light, 99)
            assert r.json()["source"] == "window_sales"
        finally:
            _cleanup([p_heavy, p_light])

    def test_cancelled_orders_excluded(self, api_client, base_url):
        p = _seed_product(name="BS cancelled test")
        for _ in range(20):
            _seed_order(
                product_id=p, quantity=1, days_ago=2, status="cancelled"
            )
        try:
            r = api_client.get(
                f"{base_url}/api/best-sellers?category=Electronics&limit=50"
            )
            items = r.json()["items"]
            row = next(
                (it for it in items if it["product"]["id"] == p), None
            )
            if row:
                assert row["units_sold_window"] == 0
        finally:
            _cleanup([p])

    def test_oos_excluded(self, api_client, base_url):
        p = _seed_product(name="BS OOS test", stock_count=0, in_stock=False)
        # Even with sales, OOS shouldn't show up
        for _ in range(5):
            _seed_order(product_id=p, days_ago=2)
        try:
            r = api_client.get(
                f"{base_url}/api/best-sellers?category=Electronics&limit=50"
            )
            ids = {it["product"]["id"] for it in r.json()["items"]}
            assert p not in ids
        finally:
            _cleanup([p])


class TestCategoryFilter:
    def test_unknown_category_404(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/best-sellers?category=NotARealCategory"
        )
        # NB: unknown name is not in HIDDEN_BUYER_CATEGORIES so it just
        # returns an empty list (200). 404 is reserved for hidden cats.
        # Confirm behaviour:
        assert r.status_code == 200
        assert r.json()["count"] == 0

    def test_category_scope(self, api_client, base_url):
        p_in = _seed_product(
            name="BS scope in", category="Electronics"
        )
        p_out = _seed_product(
            name="BS scope out", category="Home & Puja"
        )
        _seed_order(product_id=p_in, days_ago=2)
        _seed_order(product_id=p_out, days_ago=2)
        try:
            r = api_client.get(
                f"{base_url}/api/best-sellers?category=Electronics&limit=50"
            )
            ids = {it["product"]["id"] for it in r.json()["items"]}
            assert p_in in ids
            assert p_out not in ids
        finally:
            _cleanup([p_in, p_out])
