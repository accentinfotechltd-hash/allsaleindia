"""Seller-scoped earnings analytics — buyer-side of the commission story.

Mirrors the admin commission endpoints (`/api/admin/commission/{summary,
by-seller,by-category}`) but filtered to the currently authenticated
seller's orders.  Powers the new mobile "Earnings" dashboard at
`app/seller/earnings.tsx`.

  GET /api/seller/earnings/summary?period=30d
       → headline KPIs (gross, commission, net, take rate)
  GET /api/seller/earnings/by-category?period=30d
       → category breakdown for this seller only
  GET /api/seller/earnings/timeline?days=30
       → daily aggregates (for sparkline + bar chart)

All three share `_load_seller_window` so totals always reconcile.

Endpoints are deliberately seller-only — the buyer name is not exposed.
Pre-payment orders (status=pending, payment_status=initiated) are excluded.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import db
from deps import get_current_user
from services.stripe_connect_svc import (
    CATEGORY_COMMISSION_BPS,
    DEFAULT_COMMISSION_BPS,
    get_commission_bps_for_product,
)

router = APIRouter(tags=["seller-earnings"])


# ---------------------------------------------------------------------------
# Window resolver (shared)
# ---------------------------------------------------------------------------
def _resolve_window(period: str) -> tuple[datetime, datetime, int]:
    end = datetime.now(timezone.utc)
    if period == "all":
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        return start, end, (end - start).days
    m = re.match(r"^(\d+)d$", period)
    days = int(m.group(1)) if m else 30
    return end - timedelta(days=days), end, days


async def _load_seller_orders(
    seller_id: str, start: datetime, end: datetime,
) -> tuple[list[dict], dict[str, dict]]:
    """Return all paid orders in window that contain at least one line
    belonging to this seller, plus a product lookup keyed by product_id.

    Orders that contain a mix of sellers are included, but only this
    seller's lines contribute to the aggregates downstream.
    """
    query = {
        "created_at": {"$gte": start, "$lte": end},
        "items.seller_id": seller_id,
        "$or": [
            {"payment_status": "paid"},
            {"status": {"$in": ["confirmed", "shipped", "delivered"]}},
        ],
    }
    orders: list[dict] = []
    async for o in db.orders.find(query, {"_id": 0}).limit(10000):
        orders.append(o)

    pids: set[str] = set()
    for o in orders:
        for it in o.get("items") or []:
            if it.get("seller_id") == seller_id:
                pid = it.get("product_id") or it.get("id")
                if pid:
                    pids.add(pid)
    products: dict[str, dict] = {}
    if pids:
        async for p in db.products.find(
            {"id": {"$in": list(pids)}},
            {"_id": 0, "id": 1, "category": 1, "tags": 1, "name": 1},
        ):
            products[p["id"]] = p
    return orders, products


def _line_cents(it: dict) -> int:
    qty = int(it.get("quantity") or it.get("qty") or 1)
    return int(
        it.get("subtotal_cents")
        or it.get("total_cents")
        or round((float(it.get("price_nzd") or it.get("price") or 0) * qty) * 100)
    )


# ---------------------------------------------------------------------------
# GET /api/seller/earnings/summary
# ---------------------------------------------------------------------------
class SellerEarningsSummary(BaseModel):
    period: str
    period_days: int
    period_start: datetime
    period_end: datetime
    total_orders: int
    total_units: int
    gross_nzd: float
    gross_cents: int
    commission_paid_nzd: float
    commission_paid_cents: int
    net_earnings_nzd: float
    net_earnings_cents: int
    effective_take_rate_bps: int
    effective_take_rate_pct: float
    avg_order_value_nzd: float
    tier_map: dict[str, int]


@router.get("/seller/earnings/summary", response_model=SellerEarningsSummary)
async def seller_earnings_summary(
    period: str = Query("30d", description="Window: 7d | 30d | 90d | 365d | all"),
    seller=Depends(get_current_user),
):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    start, end, period_days = _resolve_window(period)
    orders, products = await _load_seller_orders(seller["id"], start, end)

    order_ids: set[str] = set()
    total_units = 0
    gross = 0
    commission = 0
    for o in orders:
        for it in (o.get("items") or []):
            if it.get("seller_id") != seller["id"]:
                continue
            pid = it.get("product_id") or it.get("id")
            qty = int(it.get("quantity") or it.get("qty") or 1)
            line_cents = _line_cents(it)
            bps = get_commission_bps_for_product(products.get(pid) or {})
            gross += line_cents
            commission += (line_cents * bps) // 10_000
            total_units += qty
            order_ids.add(o.get("id"))

    net = gross - commission
    effective_bps = int(round(commission / gross * 10_000)) if gross else 0
    aov_cents = int(round(gross / len(order_ids))) if order_ids else 0
    return SellerEarningsSummary(
        period=period,
        period_days=period_days,
        period_start=start,
        period_end=end,
        total_orders=len(order_ids),
        total_units=total_units,
        gross_nzd=round(gross / 100, 2),
        gross_cents=gross,
        commission_paid_nzd=round(commission / 100, 2),
        commission_paid_cents=commission,
        net_earnings_nzd=round(net / 100, 2),
        net_earnings_cents=net,
        effective_take_rate_bps=effective_bps,
        effective_take_rate_pct=round(effective_bps / 100, 2),
        avg_order_value_nzd=round(aov_cents / 100, 2),
        tier_map={**CATEGORY_COMMISSION_BPS, "default": DEFAULT_COMMISSION_BPS},
    )


# ---------------------------------------------------------------------------
# GET /api/seller/earnings/by-category
# ---------------------------------------------------------------------------
class SellerCategoryRow(BaseModel):
    category: str
    bps: int
    pct: float
    orders: int
    units: int
    gross_nzd: float
    commission_paid_nzd: float
    net_earnings_nzd: float
    share_of_total_pct: float  # this category's share of seller's gross


class SellerCategoryResponse(BaseModel):
    period: str
    period_days: int
    total_gross_nzd: float
    total_commission_paid_nzd: float
    total_net_earnings_nzd: float
    categories: List[SellerCategoryRow]


@router.get("/seller/earnings/by-category", response_model=SellerCategoryResponse)
async def seller_earnings_by_category(
    period: str = Query("30d"),
    seller=Depends(get_current_user),
):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    start, end, period_days = _resolve_window(period)
    orders, products = await _load_seller_orders(seller["id"], start, end)

    bucket: dict[str, dict] = {}
    total_gross = 0
    total_commission = 0
    for o in orders:
        for it in (o.get("items") or []):
            if it.get("seller_id") != seller["id"]:
                continue
            pid = it.get("product_id") or it.get("id")
            qty = int(it.get("quantity") or it.get("qty") or 1)
            line_cents = _line_cents(it)
            product = products.get(pid) or {}
            cat = (product.get("category") or it.get("category") or "uncategorised").lower()
            bps = get_commission_bps_for_product(product)
            line_commission = (line_cents * bps) // 10_000
            b = bucket.setdefault(
                cat,
                {"category": cat, "bps": bps,
                 "orders": set(), "units": 0,
                 "gross_cents": 0, "commission_cents": 0},
            )
            b["orders"].add(o.get("id"))
            b["units"] += qty
            b["gross_cents"] += line_cents
            b["commission_cents"] += line_commission
            total_gross += line_cents
            total_commission += line_commission

    rows: list[SellerCategoryRow] = []
    for b in bucket.values():
        gross_c = b["gross_cents"]
        comm_c = b["commission_cents"]
        rows.append(
            SellerCategoryRow(
                category=b["category"],
                bps=b["bps"],
                pct=round(b["bps"] / 100, 2),
                orders=len(b["orders"]),
                units=b["units"],
                gross_nzd=round(gross_c / 100, 2),
                commission_paid_nzd=round(comm_c / 100, 2),
                net_earnings_nzd=round((gross_c - comm_c) / 100, 2),
                share_of_total_pct=(
                    round(gross_c / total_gross * 100, 1) if total_gross else 0.0
                ),
            )
        )
    rows.sort(key=lambda r: r.gross_nzd, reverse=True)
    return SellerCategoryResponse(
        period=period,
        period_days=period_days,
        total_gross_nzd=round(total_gross / 100, 2),
        total_commission_paid_nzd=round(total_commission / 100, 2),
        total_net_earnings_nzd=round((total_gross - total_commission) / 100, 2),
        categories=rows,
    )


# ---------------------------------------------------------------------------
# GET /api/seller/earnings/timeline?days=30
# ---------------------------------------------------------------------------
class TimelineBucket(BaseModel):
    date: date
    orders: int
    units: int
    gross_nzd: float
    commission_paid_nzd: float
    net_earnings_nzd: float


class TimelineResponse(BaseModel):
    days: int
    period_start: datetime
    period_end: datetime
    buckets: List[TimelineBucket]
    peak_day: TimelineBucket | None
    avg_daily_net_nzd: float


@router.get("/seller/earnings/timeline", response_model=TimelineResponse)
async def seller_earnings_timeline(
    days: int = Query(30, ge=1, le=365),
    seller=Depends(get_current_user),
):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    orders, products = await _load_seller_orders(seller["id"], start, end)

    # Build a fully-padded day-by-day timeline so the frontend can render
    # a steady-width chart even when some days have no sales.
    by_day: dict[date, dict] = {}
    today = end.date()
    for offset in range(days, -1, -1):
        d = today - timedelta(days=offset)
        by_day[d] = {
            "date": d,
            "orders": set(),
            "units": 0,
            "gross_cents": 0,
            "commission_cents": 0,
        }

    for o in orders:
        created = o.get("created_at") or o.get("paid_at")
        if not isinstance(created, datetime):
            continue
        d = created.astimezone(timezone.utc).date()
        if d not in by_day:
            continue  # outside the padded range
        b = by_day[d]
        for it in (o.get("items") or []):
            if it.get("seller_id") != seller["id"]:
                continue
            pid = it.get("product_id") or it.get("id")
            qty = int(it.get("quantity") or it.get("qty") or 1)
            line_cents = _line_cents(it)
            bps = get_commission_bps_for_product(products.get(pid) or {})
            b["orders"].add(o.get("id"))
            b["units"] += qty
            b["gross_cents"] += line_cents
            b["commission_cents"] += (line_cents * bps) // 10_000

    buckets: list[TimelineBucket] = []
    total_net = 0
    peak: TimelineBucket | None = None
    for d in sorted(by_day.keys()):
        b = by_day[d]
        gross_c = b["gross_cents"]
        comm_c = b["commission_cents"]
        net_c = gross_c - comm_c
        total_net += net_c
        row = TimelineBucket(
            date=d,
            orders=len(b["orders"]),
            units=b["units"],
            gross_nzd=round(gross_c / 100, 2),
            commission_paid_nzd=round(comm_c / 100, 2),
            net_earnings_nzd=round(net_c / 100, 2),
        )
        buckets.append(row)
        if peak is None or row.net_earnings_nzd > peak.net_earnings_nzd:
            peak = row
    avg_daily_net = round((total_net / 100) / max(1, len(buckets)), 2)
    return TimelineResponse(
        days=days,
        period_start=start,
        period_end=end,
        buckets=buckets,
        peak_day=peak if peak and peak.net_earnings_nzd > 0 else None,
        avg_daily_net_nzd=avg_daily_net,
    )


# Suppress unused import noise (the defaultdict import is reserved for a
# future top-products endpoint that's not in this iteration).
_ = defaultdict
