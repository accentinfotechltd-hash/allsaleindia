"""Per-seller payouts derived from paid orders."""
from __future__ import annotations

import uuid

from config import PLATFORM_COMMISSION
from db import db
from utils import now_utc


async def create_payouts_for_order(order_id: str) -> None:
    """Idempotently materialize one Payout per seller present in the order.

    Items without a `seller_id` are platform-owned (seeded catalog) and
    generate no payout. Safe to call multiple times — duplicate (order_id,
    seller_id) inserts are absorbed.
    """
    existing = await db.payouts.find_one({"order_id": order_id}, {"_id": 0})
    if existing:
        return
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    by_seller: dict[str, dict] = {}
    for it in order.get("items", []):
        sid = it.get("seller_id")
        if not sid:
            continue
        bucket = by_seller.setdefault(
            sid,
            {
                "seller_name": it.get("seller_name") or "Seller",
                "items_count": 0,
                "gross": 0.0,
            },
        )
        bucket["items_count"] += int(it["quantity"])
        bucket["gross"] += float(it["price_nzd"]) * int(it["quantity"])
    docs = []
    for sid, agg in by_seller.items():
        gross = round(agg["gross"], 2)
        commission = round(gross * PLATFORM_COMMISSION, 2)
        net = round(gross - commission, 2)
        docs.append(
            {
                "id": f"po_{uuid.uuid4().hex[:12]}",
                "order_id": order_id,
                "seller_id": sid,
                "company_name": agg["seller_name"],
                "items_count": agg["items_count"],
                "gross_nzd": gross,
                "commission_nzd": commission,
                "net_payable_nzd": net,
                "status": "pending",
                "created_at": now_utc(),
                "paid_out_at": None,
            }
        )
    if docs:
        await db.payouts.insert_many(docs)
