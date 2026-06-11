"""Mongo client singleton.

Keep imports light — every module that touches the DB pulls `db` from here
to avoid duplicating client instances.
"""
from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient

from config import DB_NAME, MONGO_URL

logger = logging.getLogger("allsale")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


async def ensure_indexes() -> None:
    """Create idempotent indexes on the collections we use."""
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.products.create_index("id", unique=True)
    await db.products.create_index("category")
    await db.products.create_index("subcategory")
    await db.carts.create_index("user_id", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("user_id")
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.sellers.create_index("user_id", unique=True)
    # GSTIN is OPTIONAL for sole proprietors → keep uniqueness but
    # only on docs that actually have a GSTIN (partial index).
    try:
        await db.sellers.drop_index("gstin_1")
    except Exception:
        pass
    await db.sellers.create_index(
        "gstin",
        unique=True,
        partialFilterExpression={"gstin": {"$type": "string"}},
    )
    await db.products.create_index("seller_id")
    await db.payouts.create_index("id", unique=True)
    await db.payouts.create_index([("seller_id", 1), ("status", 1)])
    await db.payouts.create_index([("order_id", 1), ("seller_id", 1)], unique=True)
    await db.orders.create_index("items.seller_id")
    await db.shipments.create_index("order_id", unique=True)
    await db.shipments.create_index("awb_code", unique=True)
    await db.notifications.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read", 1)])
    await db.returns.create_index("id", unique=True)
    await db.returns.create_index([("user_id", 1), ("created_at", -1)])
    await db.returns.create_index([("seller_id", 1), ("status", 1)])
    await db.returns.create_index("order_id")
