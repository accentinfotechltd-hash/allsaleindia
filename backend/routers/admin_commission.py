"""Admin commission analytics — revenue / take-rate / category breakdown.

  GET /api/admin/commission/analytics?period=30d
       → totals + per-category breakdown + modelling helper

The endpoint aggregates ALL paid orders within the window, then for each
order multiplies each line by the resolved commission_bps via the same
helper used at charge time.  This gives a single-source-of-truth analytics
view that always reflects whatever tiering structure is configured today.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import db
from services.admin_auth import require_roles
from services.stripe_connect_svc import (
    CATEGORY_COMMISSION_BPS,
    DEFAULT_COMMISSION_BPS,
    get_commission_bps_for_product,
)

router = APIRouter(tags=["admin-commission"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CategoryBreakdown(BaseModel):
    category: str
    bps: int
    orders: int
    units: int
    gmv_cents: int
    commission_cents: int


class CommissionAnalyticsResponse(BaseModel):
    period_days: int
    period_start: datetime
    period_end: datetime
    total_orders: int
    total_gmv_cents: int
    total_commission_cents: int
    effective_take_rate_bps: int
    categories: List[CategoryBreakdown]
    tier_map: dict[str, int]


# ---------------------------------------------------------------------------
# GET /api/admin/commission/analytics
# ---------------------------------------------------------------------------
@router.get("/admin/commission/analytics", response_model=CommissionAnalyticsResponse)
async def commission_analytics(
    period: str = Query("30d", description="Window: 7d | 30d | 90d | 365d | all"),
    admin: dict = Depends(require_roles("manager", "support")),
):
    end = datetime.now(timezone.utc)
    m = re.match(r"^(\d+)d$", period)
    if period == "all":
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        period_days = (end - start).days
    else:
        period_days = int(m.group(1)) if m else 30
        start = end - timedelta(days=period_days)

    # Pull all paid orders in window — orders without payment_status='paid' are
    # excluded (they don't represent realized commission).
    query: dict = {
        "created_at": {"$gte": start, "$lte": end},
        "$or": [
            {"payment_status": "paid"},
            {"status": {"$in": ["confirmed", "shipped", "delivered"]}},
        ],
    }
    orders = []
    async for o in db.orders.find(query, {"_id": 0}).limit(10000):
        orders.append(o)

    # Build a product-id → product lookup so the inner loop is cheap.
    product_ids: set[str] = set()
    for o in orders:
        for it in o.get("items") or []:
            pid = it.get("product_id") or it.get("id")
            if pid:
                product_ids.add(pid)
    products: dict[str, dict] = {}
    if product_ids:
        async for p in db.products.find(
            {"id": {"$in": list(product_ids)}},
            {"_id": 0, "id": 1, "category": 1, "tags": 1},
        ):
            products[p["id"]] = p

    # Aggregate per-category buckets.
    bucket: dict[str, dict] = {}
    total_gmv = 0
    total_commission = 0
    for o in orders:
        for it in o.get("items") or []:
            pid = it.get("product_id") or it.get("id")
            qty = int(it.get("quantity") or it.get("qty") or 1)
            # Use NZD line total in cents — try a few common field names.
            line_cents = int(
                it.get("subtotal_cents")
                or it.get("total_cents")
                or round((float(it.get("price_nzd") or it.get("price") or 0) * qty) * 100)
            )
            product = products.get(pid) or {}
            cat = (product.get("category") or it.get("category") or "uncategorised").lower()
            bps = get_commission_bps_for_product(product)
            commission = (line_cents * bps) // 10_000

            b = bucket.setdefault(
                cat,
                {"category": cat, "bps": bps, "orders": set(),
                 "units": 0, "gmv_cents": 0, "commission_cents": 0},
            )
            b["orders"].add(o.get("id"))
            b["units"] += qty
            b["gmv_cents"] += line_cents
            b["commission_cents"] += commission

            total_gmv += line_cents
            total_commission += commission

    categories = [
        CategoryBreakdown(
            category=b["category"],
            bps=b["bps"],
            orders=len(b["orders"]),
            units=b["units"],
            gmv_cents=b["gmv_cents"],
            commission_cents=b["commission_cents"],
        )
        for b in bucket.values()
    ]
    categories.sort(key=lambda c: c.commission_cents, reverse=True)

    effective_bps = int(round(total_commission / total_gmv * 10_000)) if total_gmv else 0

    return CommissionAnalyticsResponse(
        period_days=period_days,
        period_start=start,
        period_end=end,
        total_orders=len(orders),
        total_gmv_cents=total_gmv,
        total_commission_cents=total_commission,
        effective_take_rate_bps=effective_bps,
        categories=categories,
        tier_map={**CATEGORY_COMMISSION_BPS, "default": DEFAULT_COMMISSION_BPS},
    )
