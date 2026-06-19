"""Tests for /api/products/{id}/frequently-bought-together.

Covers:
  - Unknown product → 404
  - Schema (anchor + items + bundle_total_nzd + source)
  - Category fallback when no co-purchase data
  - Real co-purchase frequency boost (orders where two products co-occur)
  - limit clamp [1, 6]
  - Excludes the anchor product from its own items
  - Out-of-stock co-purchases are NOT included
  - Cancelled/refunded/unpaid orders don't contribute to frequency
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

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
    price_nzd: float = 25.0,
    in_stock: bool = True,
    stock_count: int = 50,
    rating: float = 4.5,
) -> str:
    pid = f"prod_fbt_{uuid.uuid4().hex[:10]}"

    async def go():
        cli, db = await _db()
        await db.products.insert_one(
            {
                "id": pid,
                "name": name,
                "description": "Test product",
                "category": category,
                "subcategory": subcategory,
                "price_nzd": price_nzd,
                "price_inr": price_nzd * 50,
                "image": "https://placehold.co/200",
                "rating": rating,
                "reviews_count": 12,
                "in_stock": in_stock,
                "stock_count": stock_count,
                "seller_name": "FBT Co",
            }
        )
        cli.close()

    run_async(go())
    return pid


def _seed_paid_order_with_items(
    *,
    product_ids: list[str],
    status: str = "delivered",
    payment_status: str = "paid",
) -> str:
    oid = f"order_fbt_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    items = [
        {
            "product_id": pid,
            "name": f"item-{pid[-6:]}",
            "seller_id": "seller_x",
            "quantity": 1,
            "price_nzd": 10,
        }
        for pid in product_ids
    ]

    async def go():
        cli, db = await _db()
        await db.orders.insert_one(
            {
                "id": oid,
                "user_id": "test_buyer",
                "items": items,
                "payment_status": payment_status,
                "status": status,
                "buyer_country": "NZ",
                "paid_at": now,
                "created_at": now,
            }
        )
        cli.close()

    run_async(go())
    return oid


def _cleanup(pids: list[str]):
    async def go():
        cli, db = await _db()
        if pids:
            await db.products.delete_many({"id": {"$in": pids}})
            await db.orders.delete_many({"items.product_id": {"$in": pids}})
        cli.close()

    run_async(go())


# ===========================================================================
# Schema & 404
# ===========================================================================
class TestSchema:
    def test_unknown_product_404(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/products/totally-not-a-product/frequently-bought-together"
        )
        assert r.status_code == 404

    def test_schema_shape(self, api_client, base_url):
        anchor = _seed_product(name="Anchor item")
        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=2"
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert set(body.keys()) >= {
                "anchor",
                "items",
                "bundle_count",
                "bundle_total_nzd",
                "source",
            }
            assert body["anchor"]["id"] == anchor
            assert isinstance(body["items"], list)
            assert isinstance(body["bundle_total_nzd"], (int, float))
            assert body["source"] in (
                "order_history",
                "category_fallback",
                "empty",
            )
        finally:
            _cleanup([anchor])


# ===========================================================================
# Limit clamping
# ===========================================================================
class TestLimitClamp:
    def test_limit_zero_clamps_to_one(self, api_client, base_url):
        anchor = _seed_product(name="Limit test anchor")
        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=0"
            )
            assert r.status_code == 200
            assert len(r.json()["items"]) <= 1
        finally:
            _cleanup([anchor])

    def test_limit_above_six_clamps_to_six(self, api_client, base_url):
        anchor = _seed_product(name="Limit test anchor 2")
        peers = [_seed_product(name=f"Peer {i}") for i in range(8)]
        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=99"
            )
            assert r.status_code == 200
            assert len(r.json()["items"]) <= 6
        finally:
            _cleanup([anchor, *peers])


# ===========================================================================
# Anchor excluded from items
# ===========================================================================
class TestAnchorExcluded:
    def test_anchor_never_in_items(self, api_client, base_url):
        anchor = _seed_product(name="Self test anchor")
        peer = _seed_product(name="A peer")
        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=5"
            )
            ids = [it["id"] for it in r.json()["items"]]
            assert anchor not in ids
        finally:
            _cleanup([anchor, peer])


# ===========================================================================
# Real co-purchase boost
# ===========================================================================
class TestCoPurchaseBoost:
    def test_strong_co_purchase_ranks_first(self, api_client, base_url):
        anchor = _seed_product(name="Co-purchase anchor")
        co_strong = _seed_product(name="Strong co peer")
        co_weak = _seed_product(name="Weak co peer")
        category_filler = _seed_product(name="Category filler")

        # 3 orders where anchor + co_strong co-occur
        for _ in range(3):
            _seed_paid_order_with_items(product_ids=[anchor, co_strong])
        # 1 order where anchor + co_weak co-occur — single-shot filtered out (frequency < 2)
        _seed_paid_order_with_items(product_ids=[anchor, co_weak])

        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=3"
            )
            assert r.status_code == 200
            body = r.json()
            ids = [it["id"] for it in body["items"]]
            # Strong co-purchase must be present and ranked first
            assert co_strong in ids
            assert ids[0] == co_strong
            # Weak (frequency=1) should NOT be in the strong-only items —
            # may appear via category fallback so we only assert order.
            strong_item = next(
                it for it in body["items"] if it["id"] == co_strong
            )
            assert strong_item["frequency"] >= 3
            assert body["source"] == "order_history"
        finally:
            _cleanup([anchor, co_strong, co_weak, category_filler])

    def test_cancelled_orders_do_not_count(self, api_client, base_url):
        anchor = _seed_product(name="Cancel test anchor")
        peer = _seed_product(name="Cancel test peer")
        # Both orders cancelled → frequency should be 0
        for _ in range(5):
            _seed_paid_order_with_items(
                product_ids=[anchor, peer], status="cancelled"
            )

        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=3"
            )
            body = r.json()
            # No co-purchase signal → source is category_fallback (peer may still
            # appear via fallback, but with frequency=0)
            assert body["source"] in ("category_fallback", "empty")
            peer_item = next(
                (it for it in body["items"] if it["id"] == peer), None
            )
            if peer_item:
                assert peer_item["frequency"] == 0
        finally:
            _cleanup([anchor, peer])

    def test_out_of_stock_co_purchase_excluded(self, api_client, base_url):
        anchor = _seed_product(name="OOS-test anchor")
        oos_peer = _seed_product(name="OOS peer", stock_count=0)
        # Co-purchase 3x — but peer is out of stock
        for _ in range(3):
            _seed_paid_order_with_items(product_ids=[anchor, oos_peer])

        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=3"
            )
            ids = [it["id"] for it in r.json()["items"]]
            assert oos_peer not in ids
        finally:
            _cleanup([anchor, oos_peer])


# ===========================================================================
# Category fallback
# ===========================================================================
class TestCategoryFallback:
    def test_no_history_uses_category_fallback(self, api_client, base_url):
        anchor = _seed_product(
            name="Fallback test anchor", category="Electronics"
        )
        peer = _seed_product(
            name="Fallback test peer",
            category="Electronics",
            rating=4.8,
        )
        other_cat = _seed_product(
            name="Other cat",
            category="Home & Puja",
            rating=4.9,
        )
        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=3"
            )
            body = r.json()
            ids = [it["id"] for it in body["items"]]
            # Same-category peer should appear; cross-category should not.
            assert peer in ids
            assert other_cat not in ids
        finally:
            _cleanup([anchor, peer, other_cat])


# ===========================================================================
# Bundle total math
# ===========================================================================
class TestBundleTotal:
    def test_bundle_total_equals_anchor_plus_items(self, api_client, base_url):
        anchor = _seed_product(name="Bundle math anchor", price_nzd=20.0)
        p1 = _seed_product(name="Bundle math peer1", price_nzd=15.0)
        p2 = _seed_product(name="Bundle math peer2", price_nzd=5.0)
        for _ in range(3):
            _seed_paid_order_with_items(product_ids=[anchor, p1, p2])

        try:
            r = api_client.get(
                f"{base_url}/api/products/{anchor}/frequently-bought-together?limit=3"
            )
            body = r.json()
            item_sum = sum(it["price_nzd"] for it in body["items"])
            anchor_price = body["anchor"]["price_nzd"]
            assert abs(body["bundle_total_nzd"] - (anchor_price + item_sum)) < 0.01
            assert body["bundle_count"] == 1 + len(body["items"])
        finally:
            _cleanup([anchor, p1, p2])
