"""Verify seed reseed preserves per-product analytics counters."""
from __future__ import annotations

import asyncio
import uuid

from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def _run_with_fresh_loop(coro):
    """Use a brand-new event loop so Motor's client lives & dies cleanly.

    This avoids the "Event loop is closed" cleanup flake that can occur when
    Motor's background tasks try to schedule shutdown work on a loop that
    pytest has already disposed.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        try:
            # Drain pending tasks before closing.
            pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
            for t in pending:
                t.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        except Exception:
            pass
        loop.close()


def test_reseed_carries_over_view_counters():
    """seed_products() should preserve view_count / cart_add_count on platform
    listings by matching on product `name` (since UUIDs change on reseed)."""
    _run_with_fresh_loop(_run_inline())


async def _run_inline():
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    try:
        from services import seed as seed_module

        unique_name = f"_seed_counter_test_{uuid.uuid4().hex[:8]}"
        backup = seed_module.SEED_PRODUCTS
        try:
            seed_module.SEED_PRODUCTS = [
                {
                    "name": unique_name,
                    "description": "x x x x x x x x x x",
                    "category": "Ethnic Fashion",
                    "subcategory": "Sarees",
                    "price_nzd": 1.0,
                    "image": "https://example.com/x.jpg",
                    "rating": 4.0,
                    "reviews_count": 0,
                }
            ]
            await seed_module.seed_products()
            await db.products.update_one(
                {"seller_id": None, "name": unique_name},
                {"$set": {"view_count": 1337, "cart_add_count": 42}},
            )
            seed_module.SEED_PRODUCTS = seed_module.SEED_PRODUCTS + [
                {
                    "name": f"{unique_name}_TEMP_EXTRA",
                    "description": "x x x x x x x x x x",
                    "category": "Ethnic Fashion",
                    "subcategory": "Sarees",
                    "price_nzd": 1.0,
                    "image": "https://example.com/x.jpg",
                    "rating": 4.0,
                    "reviews_count": 0,
                }
            ]
            await seed_module.seed_products()
            new_doc = await db.products.find_one(
                {"seller_id": None, "name": unique_name}, {"_id": 0}
            )
            assert new_doc, "platform product should still exist after reseed"
            assert int(new_doc.get("view_count") or 0) == 1337
            assert int(new_doc.get("cart_add_count") or 0) == 42
        finally:
            seed_module.SEED_PRODUCTS = backup
            await seed_module.seed_products()
    finally:
        cli.close()
