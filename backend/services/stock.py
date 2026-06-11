"""Stock decrement / restock for orders. Idempotent via flags on order doc."""
from __future__ import annotations

from db import db


async def decrement_stock_for_order(order_id: str) -> None:
    """Decrement stock_count for each ordered product. Idempotent via a flag
    on the order doc so a double-call (webhook + polling) does not double-debit."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order or order.get("stock_decremented"):
        return
    for it in order.get("items", []):
        pid = it.get("product_id")
        qty = int(it.get("quantity", 0))
        if not pid or qty <= 0:
            continue
        await db.products.update_one(
            {"id": pid, "stock_count": {"$gte": qty}},
            [
                {"$set": {"stock_count": {"$subtract": ["$stock_count", qty]}}},
                {"$set": {"in_stock": {"$gt": ["$stock_count", 0]}}},
            ],
        )
    await db.orders.update_one({"id": order_id}, {"$set": {"stock_decremented": True}})


async def restock_for_order(order_id: str) -> None:
    """Restore stock_count when an order is cancelled."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order or not order.get("stock_decremented") or order.get("stock_restocked"):
        return
    for it in order.get("items", []):
        pid = it.get("product_id")
        qty = int(it.get("quantity", 0))
        if not pid or qty <= 0:
            continue
        await db.products.update_one(
            {"id": pid},
            [
                {"$set": {"stock_count": {"$add": [{"$ifNull": ["$stock_count", 0]}, qty]}}},
                {"$set": {"in_stock": {"$gt": ["$stock_count", 0]}}},
            ],
        )
    await db.orders.update_one({"id": order_id}, {"$set": {"stock_restocked": True}})
