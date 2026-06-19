"""Seller analytics: traffic counters, time-series, and returns/region insights."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from utils import now_utc

from ._common import COUNTRY_FLAGS

router = APIRouter(tags=["seller"])


@router.post("/products/{product_id}/track-view")
async def track_product_view(product_id: str):
    """Anonymous product-view counter. Fire-and-forget from the buyer client.

    Bumps the lifetime counter on the product doc AND writes a tiny event
    row in ``analytics_events`` so the seller dashboard can plot a
    7/30-day chart.
    """
    prod = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "seller_id": 1, "price_nzd": 1}
    )
    if not prod:
        return {"ok": False}
    await db.products.update_one(
        {"id": product_id}, {"$inc": {"view_count": 1}}
    )
    if prod.get("seller_id"):
        await db.analytics_events.insert_one(
            {
                "type": "view",
                "product_id": product_id,
                "seller_id": prod["seller_id"],
                "at": now_utc(),
            }
        )
    return {"ok": True}


@router.post("/products/{product_id}/track-cart-add")
async def track_cart_add(product_id: str):
    """Anonymous add-to-cart counter (with event row for time-series)."""
    prod = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "seller_id": 1, "price_nzd": 1}
    )
    if not prod:
        return {"ok": False}
    await db.products.update_one(
        {"id": product_id}, {"$inc": {"cart_add_count": 1}}
    )
    if prod.get("seller_id"):
        await db.analytics_events.insert_one(
            {
                "type": "cart_add",
                "product_id": product_id,
                "seller_id": prod["seller_id"],
                "at": now_utc(),
            }
        )
    return {"ok": True}


@router.get("/seller/analytics")
async def seller_analytics(seller=Depends(get_current_user)):
    """Aggregate per-listing analytics for the current seller.

    Returns view/cart-add/purchase counters per product plus a sellerwide
    summary (top 5 by views and by sold quantity).
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    cursor = db.products.find(
        {"seller_id": seller["id"]},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "image": 1,
            "price_nzd": 1,
            "stock_count": 1,
            "in_stock": 1,
            "view_count": 1,
            "cart_add_count": 1,
        },
    )
    products = [p async for p in cursor]

    sold_map: dict[str, dict] = {}
    orders_cursor = db.orders.find(
        {
            "items.seller_id": seller["id"],
            "payment_status": "paid",
            "status": {"$nin": ["cancelled", "refunded"]},
        },
        {"_id": 0, "items": 1, "created_at": 1},
    )
    async for o in orders_cursor:
        for it in o.get("items", []):
            if it.get("seller_id") != seller["id"]:
                continue
            pid = it.get("product_id")
            if not pid:
                continue
            bucket = sold_map.setdefault(pid, {"sold": 0, "revenue_nzd": 0.0})
            bucket["sold"] += int(it.get("quantity", 0))
            bucket["revenue_nzd"] += float(it.get("price_nzd", 0)) * int(
                it.get("quantity", 0)
            )

    listings = []
    for p in products:
        pid = p["id"]
        views = int(p.get("view_count") or 0)
        cart_adds = int(p.get("cart_add_count") or 0)
        sold = int(sold_map.get(pid, {}).get("sold", 0))
        revenue = round(float(sold_map.get(pid, {}).get("revenue_nzd", 0.0)), 2)
        conversion_pct = (
            round((sold / views) * 100, 1) if views > 0 else 0.0
        )
        listings.append(
            {
                "product_id": pid,
                "name": p.get("name"),
                "image": p.get("image"),
                "price_nzd": float(p.get("price_nzd", 0)),
                "stock_count": int(p.get("stock_count") or 0),
                "in_stock": bool(p.get("in_stock", True)),
                "views": views,
                "cart_adds": cart_adds,
                "sold": sold,
                "revenue_nzd": revenue,
                "conversion_pct": conversion_pct,
            }
        )

    total_views = sum(int(p.get("view_count") or 0) for p in products)
    total_cart_adds = sum(int(p.get("cart_add_count") or 0) for p in products)
    total_sold = sum(b["sold"] for b in sold_map.values())
    total_revenue = round(sum(b["revenue_nzd"] for b in sold_map.values()), 2)

    top_by_views = sorted(listings, key=lambda x: x["views"], reverse=True)[:5]
    top_by_sold = sorted(listings, key=lambda x: x["sold"], reverse=True)[:5]

    return {
        "listings": listings,
        "summary": {
            "total_listings": len(listings),
            "total_views": total_views,
            "total_cart_adds": total_cart_adds,
            "total_sold": total_sold,
            "total_revenue_nzd": total_revenue,
            "overall_conversion_pct": (
                round((total_sold / total_views) * 100, 1)
                if total_views > 0
                else 0.0
            ),
        },
        "top_by_views": top_by_views,
        "top_by_sold": top_by_sold,
    }


@router.get("/seller/analytics/timeseries")
async def seller_analytics_timeseries(
    days: int = 7, seller=Depends(get_current_user)
):
    """Per-day buckets of views / cart-adds / sold / revenue.

    Returns the last ``days`` calendar days (inclusive of today) in UTC.
    Supported values: 7 or 30. Larger values are clamped to 30.
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    days = max(1, min(int(days), 30))
    today = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    start = today - timedelta(days=days - 1)

    # 1) Views / cart-adds from analytics_events
    pipeline = [
        {"$match": {"seller_id": seller["id"], "at": {"$gte": start}}},
        {
            "$group": {
                "_id": {
                    "date": {
                        "$dateToString": {
                            "format": "%Y-%m-%d",
                            "date": "$at",
                        }
                    },
                    "type": "$type",
                },
                "count": {"$sum": 1},
            }
        },
    ]
    by_day_type: dict[str, dict[str, int]] = {}
    async for row in db.analytics_events.aggregate(pipeline):
        d = row["_id"]["date"]
        t = row["_id"]["type"]
        by_day_type.setdefault(d, {})[t] = int(row["count"])

    # 2) Sold / revenue from paid orders (use paid_at when present)
    orders_cursor = db.orders.find(
        {
            "items.seller_id": seller["id"],
            "payment_status": "paid",
            "status": {"$nin": ["cancelled", "refunded"]},
            "$or": [
                {"paid_at": {"$gte": start}},
                {
                    "$and": [
                        {"paid_at": None},
                        {"created_at": {"$gte": start}},
                    ]
                },
                {
                    "paid_at": {"$exists": False},
                    "created_at": {"$gte": start},
                },
            ],
        },
        {"_id": 0, "items": 1, "paid_at": 1, "created_at": 1},
    )
    sold_by_day: dict[str, dict[str, float]] = {}
    async for o in orders_cursor:
        when = o.get("paid_at") or o.get("created_at")
        if not when:
            continue
        if isinstance(when, datetime) and when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when < start:
            continue
        d = when.strftime("%Y-%m-%d")
        bucket = sold_by_day.setdefault(d, {"sold": 0, "revenue": 0.0})
        for it in o.get("items", []):
            if it.get("seller_id") != seller["id"]:
                continue
            qty = int(it.get("quantity", 0))
            bucket["sold"] += qty
            bucket["revenue"] += float(it.get("price_nzd", 0)) * qty

    # 3) Stitch per-day buckets for the whole range (zero-filled).
    buckets: list[dict] = []
    for i in range(days):
        d = start + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        ev = by_day_type.get(key, {})
        sb = sold_by_day.get(key, {"sold": 0, "revenue": 0.0})
        buckets.append(
            {
                "date": key,
                "views": int(ev.get("view", 0)),
                "cart_adds": int(ev.get("cart_add", 0)),
                "sold": int(sb["sold"]),
                "revenue_nzd": round(float(sb["revenue"]), 2),
            }
        )

    return {
        "days": days,
        "start": start.isoformat(),
        "end": today.isoformat(),
        "buckets": buckets,
    }


@router.get("/seller/analytics/insights")
async def seller_analytics_insights(
    days: int = 30, seller=Depends(get_current_user)
):
    """Returns-rate, revenue-by-region, and customer-demographics insights
    for the last ``days`` calendar days (default 30, clamped to 365).
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    days = max(1, min(int(days), 365))
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    # --- 1) Paid orders for this seller in the window
    paid_orders_q = {
        "items.seller_id": seller["id"],
        "payment_status": "paid",
        "status": {"$nin": ["cancelled", "refunded"]},
        "$or": [
            {"paid_at": {"$gte": start}},
            {
                "$and": [
                    {"paid_at": None},
                    {"created_at": {"$gte": start}},
                ]
            },
        ],
    }

    total_paid_orders = 0
    revenue_by_country: dict[str, dict] = {}
    customers_seen: dict[str, dict] = {}

    async for o in db.orders.find(
        paid_orders_q,
        {
            "_id": 0,
            "id": 1,
            "user_id": 1,
            "buyer_country": 1,
            "items": 1,
            "paid_at": 1,
            "created_at": 1,
        },
    ):
        total_paid_orders += 1
        cc = (o.get("buyer_country") or "NZ").upper()
        seller_revenue = 0.0
        seller_units = 0
        for it in o.get("items", []):
            if it.get("seller_id") != seller["id"]:
                continue
            qty = int(it.get("quantity", 0))
            seller_revenue += float(it.get("price_nzd", 0)) * qty
            seller_units += qty

        bucket = revenue_by_country.setdefault(
            cc, {"orders": 0, "revenue_nzd": 0.0, "units": 0}
        )
        bucket["orders"] += 1
        bucket["revenue_nzd"] += seller_revenue
        bucket["units"] += seller_units

        uid = o.get("user_id")
        if uid:
            c = customers_seen.setdefault(
                uid, {"country": cc, "revenue_nzd": 0.0, "orders": 0}
            )
            c["revenue_nzd"] += seller_revenue
            c["orders"] += 1

    # --- 2) Returns in the same window
    total_returns = 0
    returns_by_reason: dict[str, int] = {}
    returns_refund_total = 0.0
    async for r in db.returns.find(
        {
            "seller_id": seller["id"],
            "created_at": {"$gte": start},
        },
        {"_id": 0, "reason": 1, "refund_amount_nzd": 1, "status": 1},
    ):
        total_returns += 1
        reason = (r.get("reason") or "other").strip().lower()
        returns_by_reason[reason] = returns_by_reason.get(reason, 0) + 1
        if r.get("status") in {"refunded", "approved"}:
            returns_refund_total += float(r.get("refund_amount_nzd") or 0.0)

    returns_rate = (
        round((total_returns / total_paid_orders) * 100, 1)
        if total_paid_orders
        else 0.0
    )

    # --- 3) Region breakdown — sorted, with flags
    total_revenue = (
        sum(b["revenue_nzd"] for b in revenue_by_country.values()) or 1.0
    )
    by_region = [
        {
            "country": cc,
            "flag": COUNTRY_FLAGS.get(cc, "\U0001F30D"),
            "orders": v["orders"],
            "units": v["units"],
            "revenue_nzd": round(v["revenue_nzd"], 2),
            "share_pct": round((v["revenue_nzd"] / total_revenue) * 100, 1),
        }
        for cc, v in revenue_by_country.items()
    ]
    by_region.sort(key=lambda x: x["revenue_nzd"], reverse=True)

    # --- 4) Customer demographics
    total_unique = len(customers_seen)
    repeat_buyers = sum(1 for c in customers_seen.values() if c["orders"] > 1)
    repeat_rate = (
        round((repeat_buyers / total_unique) * 100, 1)
        if total_unique
        else 0.0
    )

    cust_by_country: dict[str, int] = {}
    for c in customers_seen.values():
        cc = c.get("country") or "NZ"
        cust_by_country[cc] = cust_by_country.get(cc, 0) + 1
    customer_countries = [
        {
            "country": cc,
            "flag": COUNTRY_FLAGS.get(cc, "\U0001F30D"),
            "count": n,
            "share_pct": (
                round((n / total_unique) * 100, 1) if total_unique else 0.0
            ),
        }
        for cc, n in cust_by_country.items()
    ]
    customer_countries.sort(key=lambda x: x["count"], reverse=True)

    aov = (
        round(
            sum(b["revenue_nzd"] for b in revenue_by_country.values())
            / total_paid_orders,
            2,
        )
        if total_paid_orders
        else 0.0
    )

    return {
        "window_days": days,
        "returns": {
            "total_returns": total_returns,
            "total_paid_orders": total_paid_orders,
            "returns_rate_pct": returns_rate,
            "refund_total_nzd": round(returns_refund_total, 2),
            "by_reason": [
                {"reason": k, "count": v}
                for k, v in sorted(
                    returns_by_reason.items(),
                    key=lambda kv: kv[1],
                    reverse=True,
                )
            ],
        },
        "by_region": by_region,
        "customers": {
            "total_unique": total_unique,
            "repeat_buyers": repeat_buyers,
            "repeat_rate_pct": repeat_rate,
            "by_country": customer_countries,
            "aov_nzd": aov,
        },
    }



@router.get("/seller/analytics/low-stock")
async def seller_low_stock_alerts(
    threshold: int = 10,
    window_days: int = 30,
    seller=Depends(get_current_user),
):
    """Low-stock & stockout alerts for the current seller, ranked by urgency.

    For each listing belonging to the seller we compute:

    * ``stock_count`` (current inventory)
    * ``sold_window`` — units sold in the last ``window_days`` from paid orders
    * ``daily_velocity`` — sold_window / window_days
    * ``days_of_cover`` — stock_count / daily_velocity (``None`` if zero velocity)
    * ``urgency``:
        - ``out``       — stock_count <= 0 or ``in_stock=False``  (lost sales now)
        - ``critical``  — days_of_cover <= 3 OR (stock_count <= 3 and any sales)
        - ``low``       — days_of_cover <= 7 OR stock_count <= ``threshold``
        - excluded otherwise (healthy)

    ``threshold`` is clamped to ``[1, 100]``, ``window_days`` to ``[7, 90]``.
    Sorted by urgency rank (out → critical → low), then by days_of_cover asc,
    then by recent revenue desc.
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    threshold = max(1, min(int(threshold), 100))
    window_days = max(7, min(int(window_days), 90))

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=window_days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    # --- 1) Pull all seller listings (we need every product, not just low ones,
    #        to decide which ones cross the threshold).
    products = [
        p
        async for p in db.products.find(
            {"seller_id": seller["id"]},
            {
                "_id": 0,
                "id": 1,
                "name": 1,
                "image": 1,
                "price_nzd": 1,
                "stock_count": 1,
                "in_stock": 1,
            },
        )
    ]
    if not products:
        return {
            "window_days": window_days,
            "threshold": threshold,
            "alerts": [],
            "summary": {
                "total_alerts": 0,
                "out_of_stock": 0,
                "critical": 0,
                "low": 0,
                "est_lost_revenue_window_nzd": 0.0,
            },
        }

    # --- 2) Aggregate sold-in-window per product from paid orders.
    sold_by_pid: dict[str, dict[str, float]] = {}
    async for o in db.orders.find(
        {
            "items.seller_id": seller["id"],
            "payment_status": "paid",
            "status": {"$nin": ["cancelled", "refunded"]},
            "$or": [
                {"paid_at": {"$gte": start}},
                {
                    "$and": [
                        {"paid_at": None},
                        {"created_at": {"$gte": start}},
                    ]
                },
                {
                    "paid_at": {"$exists": False},
                    "created_at": {"$gte": start},
                },
            ],
        },
        {"_id": 0, "items": 1, "paid_at": 1, "created_at": 1},
    ):
        when = o.get("paid_at") or o.get("created_at")
        if isinstance(when, datetime) and when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when and when < start:
            continue
        for it in o.get("items", []):
            if it.get("seller_id") != seller["id"]:
                continue
            pid = it.get("product_id")
            if not pid:
                continue
            qty = int(it.get("quantity", 0))
            bucket = sold_by_pid.setdefault(pid, {"sold": 0, "revenue": 0.0})
            bucket["sold"] += qty
            bucket["revenue"] += float(it.get("price_nzd", 0)) * qty

    # --- 3) Score each listing and keep only those needing attention.
    URGENCY_RANK = {"out": 0, "critical": 1, "low": 2}
    alerts: list[dict] = []
    est_lost_revenue = 0.0

    for p in products:
        pid = p["id"]
        stock = int(p.get("stock_count") or 0)
        in_stock = bool(p.get("in_stock", True))
        sold = int(sold_by_pid.get(pid, {}).get("sold", 0))
        daily_velocity = round(sold / window_days, 2) if window_days else 0.0
        days_of_cover: float | None
        if daily_velocity > 0:
            days_of_cover = round(stock / daily_velocity, 1)
        else:
            days_of_cover = None

        # Classify urgency.
        urgency: str | None = None
        if stock <= 0 or not in_stock:
            urgency = "out"
            # Estimate lost revenue: assume velocity holds for ~3 days of stockout.
            est_lost_revenue += float(p.get("price_nzd", 0)) * daily_velocity * 3
        elif (days_of_cover is not None and days_of_cover <= 3) or (
            stock <= 3 and sold > 0
        ):
            urgency = "critical"
        elif (
            (days_of_cover is not None and days_of_cover <= 7)
            or stock <= threshold
        ):
            urgency = "low"

        if urgency is None:
            continue

        # Suggested restock = enough for 14 days of cover, minimum 5 units,
        # rounded up to nearest 5 for nicer ordering quantities.
        if daily_velocity > 0:
            recommended = max(5, int(round(daily_velocity * 14)))
        else:
            recommended = max(5, threshold)
        # round up to multiple of 5
        recommended = ((recommended + 4) // 5) * 5

        alerts.append(
            {
                "product_id": pid,
                "name": p.get("name"),
                "image": p.get("image"),
                "price_nzd": float(p.get("price_nzd", 0)),
                "stock_count": stock,
                "in_stock": in_stock,
                "sold_window": sold,
                "window_days": window_days,
                "daily_velocity": daily_velocity,
                "days_of_cover": days_of_cover,
                "urgency": urgency,
                "recommended_restock": recommended,
            }
        )

    # Sort: urgency rank asc, then days_of_cover asc (None last), then
    # higher recent sales first as a tiebreaker.
    def _sort_key(a: dict):
        rank = URGENCY_RANK.get(a["urgency"], 99)
        doc = a["days_of_cover"]
        # None = infinite cover; push to the end of its urgency bucket
        doc_key = doc if doc is not None else float("inf")
        return (rank, doc_key, -a["sold_window"])

    alerts.sort(key=_sort_key)

    counts = {
        "out_of_stock": sum(1 for a in alerts if a["urgency"] == "out"),
        "critical": sum(1 for a in alerts if a["urgency"] == "critical"),
        "low": sum(1 for a in alerts if a["urgency"] == "low"),
    }

    return {
        "window_days": window_days,
        "threshold": threshold,
        "alerts": alerts,
        "summary": {
            "total_alerts": len(alerts),
            **counts,
            "est_lost_revenue_window_nzd": round(est_lost_revenue, 2),
        },
    }
