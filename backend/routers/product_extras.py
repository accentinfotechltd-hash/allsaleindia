"""Product extras — best-sellers leaderboard, "you may also like" and
Frequently-Bought-Together. Split out of ``routers/products.py`` for
readability. All public ``/api/...`` paths remain unchanged.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from config import HIDDEN_BUYER_CATEGORIES
from db import db
from models import Product

router = APIRouter(tags=["products"])


# ---------------------------------------------------------------------------
# Best Sellers leaderboard
# ---------------------------------------------------------------------------
@router.get("/best-sellers")
async def best_sellers(
    category: Optional[str] = None,
    limit: int = 50,
    window_days: int = 30,
):
    """Amazon-style "Best Sellers" leaderboard.

    Ranks in-stock products by **units sold in the last ``window_days``**
    (paid, non-cancelled orders), broken by rating × log(reviews_count)
    as a tiebreaker. When ``category`` is provided, results are scoped to
    that category. ``window_days`` is clamped to [7, 90]; ``limit`` to
    [1, 100]. Falls back to all-time top-rated when no orders exist in
    the window (so the screen never looks empty for a fresh marketplace).
    """
    window_days = max(7, min(int(window_days), 90))
    limit = max(1, min(int(limit), 100))

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=window_days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    # --- Pass 1: aggregate units sold per product in the window --------------
    sold_by_pid: dict[str, int] = {}
    order_match: dict = {
        "payment_status": "paid",
        "status": {"$nin": ["cancelled", "refunded"]},
        "$or": [
            {"paid_at": {"$gte": start}},
            {
                "paid_at": {"$exists": False},
                "created_at": {"$gte": start},
            },
        ],
    }
    async for o in db.orders.find(order_match, {"_id": 0, "items": 1}):
        for it in o.get("items", []):
            pid = it.get("product_id")
            if not pid:
                continue
            sold_by_pid[pid] = sold_by_pid.get(pid, 0) + int(
                it.get("quantity", 1)
            )

    # --- Build the catalog filter -------------------------------------------
    catalog_filter: dict = {
        "in_stock": True,
        "stock_count": {"$gt": 0},
        "category": {"$nin": list(HIDDEN_BUYER_CATEGORIES)},
    }
    if category:
        if category in HIDDEN_BUYER_CATEGORIES:
            raise HTTPException(status_code=404, detail="Category not found")
        catalog_filter["category"] = category

    # Hide paused-seller listings (mirrors /products behaviour).
    paused: list[str] = []
    async for s in db.sellers.find(
        {"vacation_mode": True}, {"_id": 0, "user_id": 1}
    ):
        if s.get("user_id"):
            paused.append(s["user_id"])
    if paused:
        catalog_filter["seller_id"] = {"$nin": paused}

    # --- Pass 2: score every catalog product --------------------------------
    scored: list[tuple[int, float, dict]] = []
    async for p in db.products.find(catalog_filter, {"_id": 0}):
        sold = sold_by_pid.get(p["id"], 0)
        rating = float(p.get("rating") or 0)
        reviews = int(p.get("reviews_count") or 0)
        tiebreak = rating * math.log(1 + reviews)
        scored.append((sold, tiebreak, p))

    # Sort: sold desc, then tiebreaker desc.
    scored.sort(key=lambda x: (-x[0], -x[1]))

    # Detect window-empty case for client copy ("All-time best sellers").
    has_real_sales = any(sold > 0 for sold, _, _ in scored)

    top = scored[:limit]
    items = []
    for rank, (sold, _tb, p) in enumerate(top, start=1):
        items.append(
            {
                "rank": rank,
                "units_sold_window": sold,
                "product": Product(**p).model_dump(),
            }
        )

    return {
        "category": category,
        "window_days": window_days,
        "source": "window_sales" if has_real_sales else "rating_fallback",
        "count": len(items),
        "items": items,
    }


# ---------------------------------------------------------------------------
# "You may also like" recommendations
# ---------------------------------------------------------------------------
@router.get("/products/{product_id}/recommendations", response_model=List[Product])
async def get_recommendations(product_id: str, limit: int = 8):
    """"You may also like" — scored by category match + rating + reviews.

    Algorithm (no LLM needed for MVP):
    - Same category as current product, excluding itself & out-of-stock items.
    - Rank by (rating * log(1+reviews_count) * 100) descending.
    - Fall back to top-rated overall if category yields too few results.
    """
    base = await db.products.find_one(
        {"id": product_id},
        {"_id": 0, "category": 1, "tags": 1, "seller_id": 1},
    )
    if not base:
        raise HTTPException(status_code=404, detail="Product not found")

    limit = max(1, min(int(limit), 24))
    seen: set[str] = {product_id}
    out: list[dict] = []

    async def add_matching(query: dict) -> None:
        async for p in db.products.find(query, {"_id": 0}):
            pid = p.get("id")
            if not pid or pid in seen:
                continue
            if (p.get("stock_count") or 0) <= 0:
                continue
            seen.add(pid)
            r = float(p.get("rating") or 0)
            n = int(p.get("reviews_count") or 0)
            score = (
                r * math.log(1 + n) * 10
                if r > 0
                else float(p.get("price_nzd", 0)) / 1000
            )
            p["_score"] = score
            out.append(p)

    # Pass 1 — same category
    await add_matching({"category": base.get("category"), "id": {"$ne": product_id}})
    # Pass 2 — same seller, different category (good cross-sell within store)
    if base.get("seller_id"):
        await add_matching({"seller_id": base["seller_id"], "id": {"$ne": product_id}})
    # Pass 3 — top-rated catalog-wide fallback
    if len(out) < limit:
        await add_matching({"rating": {"$gte": 3.5}})

    out.sort(key=lambda x: x.get("_score", 0), reverse=True)
    for p in out:
        p.pop("_score", None)
    return [Product(**p) for p in out[:limit]]


# ---------------------------------------------------------------------------
# Frequently Bought Together
# ---------------------------------------------------------------------------
@router.get("/products/{product_id}/frequently-bought-together")
async def frequently_bought_together(product_id: str, limit: int = 3):
    """Amazon-style "Frequently Bought Together" bundle widget.

    Aggregates **delivered/paid** orders that contain ``product_id`` and
    counts co-occurring product IDs in those same orders. Products that
    co-occur at least twice and live in the catalog (in-stock) are
    returned ranked by frequency. Falls back to same-category top picks
    when there's not enough historical signal yet.

    Returns ``{anchor, items, bundle_total_nzd, bundle_count, source}``
    where ``source`` is one of ``"order_history"`` or ``"category_fallback"``
    so the client can render a slightly different copy ("Customers also
    bought these" vs "Pairs well with").
    """
    base = await db.products.find_one(
        {"id": product_id},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "image": 1,
            "price_nzd": 1,
            "category": 1,
            "subcategory": 1,
            "rating": 1,
        },
    )
    if not base:
        raise HTTPException(status_code=404, detail="Product not found")

    limit = max(1, min(int(limit), 6))

    # --- Pass 1: co-purchase aggregation from real orders -------------------
    co_count: dict[str, int] = {}
    async for o in db.orders.find(
        {
            "items.product_id": product_id,
            "payment_status": "paid",
            "status": {"$nin": ["cancelled", "refunded"]},
        },
        {"_id": 0, "items.product_id": 1},
    ):
        ids = {it.get("product_id") for it in (o.get("items") or [])}
        ids.discard(None)
        ids.discard(product_id)
        for pid in ids:
            co_count[pid] = co_count.get(pid, 0) + 1

    candidates: list[dict] = []
    source = "order_history"
    if co_count:
        # Only keep co-purchases with frequency >= 2 — single-order noise
        # makes for weird bundles ("phone + dog bed").
        strong = [pid for pid, c in co_count.items() if c >= 2]
        if strong:
            async for p in db.products.find(
                {
                    "id": {"$in": strong},
                    "in_stock": True,
                    "stock_count": {"$gt": 0},
                },
                {"_id": 0},
            ):
                p["frequency"] = co_count.get(p["id"], 0)
                candidates.append(p)

    # --- Pass 2: category fallback when no co-purchase signal --------------
    if len(candidates) < limit:
        source = "category_fallback" if not candidates else source
        seen = {product_id} | {c["id"] for c in candidates}
        async for p in (
            db.products.find(
                {
                    "category": base.get("category"),
                    "id": {"$nin": list(seen)},
                    "in_stock": True,
                    "stock_count": {"$gt": 0},
                },
                {"_id": 0},
            )
            .sort([("rating", -1), ("reviews_count", -1)])
            .limit(limit * 2)
        ):
            p["frequency"] = 0
            candidates.append(p)
            if len(candidates) >= limit:
                break

    # Sort: real co-purchase frequency first, then rating as tiebreaker.
    candidates.sort(
        key=lambda x: (
            -int(x.get("frequency", 0)),
            -float(x.get("rating") or 0),
        )
    )
    items = candidates[:limit]

    # Shape down to client-facing dicts to avoid leaking internal fields.
    out_items = [
        {
            "id": p["id"],
            "name": p.get("name"),
            "image": p.get("image"),
            "price_nzd": float(p.get("price_nzd", 0)),
            "rating": float(p.get("rating") or 0),
            "reviews_count": int(p.get("reviews_count") or 0),
            "in_stock": bool(p.get("in_stock", True)),
            "frequency": int(p.get("frequency", 0)),
        }
        for p in items
    ]

    anchor_price = float(base.get("price_nzd", 0))
    bundle_total = round(
        anchor_price + sum(it["price_nzd"] for it in out_items), 2
    )

    return {
        "anchor": {
            "id": base["id"],
            "name": base.get("name"),
            "image": base.get("image"),
            "price_nzd": anchor_price,
        },
        "items": out_items,
        "bundle_count": 1 + len(out_items),
        "bundle_total_nzd": bundle_total,
        "source": source if out_items else "empty",
    }
