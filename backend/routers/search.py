"""Search & Discovery — typeahead suggest + trending (Phase 2, June 2026).

A small, dependency-free augmentation of the existing `/api/products` endpoint:
- `GET /api/search/suggest?q=` returns up to 8 product matches (name/brand/desc)
  + matched brand and category names so the autocomplete UI can render
  three sections.
- `GET /api/search/trending` returns deterministic "popular" terms derived
  from the catalog (no event tracking required to ship the UX).
- On startup the catalog's text index is created idempotently — first call
  is a no-op when the index already exists.

The richer `/api/products?q=` endpoint will use the same text index for
relevance scoring (no contract change — it falls back to regex if the index
is unavailable, e.g. cold-start before the indexer ran).
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from db import db

router = APIRouter(prefix="/search", tags=["search"])
log = logging.getLogger("allsale.search")

HIDDEN_BUYER_CATEGORIES = {"reviews", "support"}  # extend as needed


class SuggestProduct(BaseModel):
    id: str
    name: str
    image: Optional[str] = None
    price_nzd: float
    seller_name: Optional[str] = None


class SuggestPayload(BaseModel):
    products: List[SuggestProduct]
    brands: List[str]
    categories: List[str]


class TrendingPayload(BaseModel):
    terms: List[str]


_INDEX_NAME = "search_text_idx"


async def ensure_product_text_index() -> None:
    """Create the multi-field text index used by /products?q= and /suggest.

    Idempotent — safe to call on every app start.
    """
    try:
        existing = await db.products.index_information()
        if _INDEX_NAME in existing:
            return
        await db.products.create_index(
            [
                ("name", "text"),
                ("description", "text"),
                ("seller_name", "text"),
                ("brand", "text"),
                ("tags", "text"),
                ("category", "text"),
            ],
            weights={"name": 10, "brand": 5, "seller_name": 5, "tags": 3, "description": 1, "category": 2},
            name=_INDEX_NAME,
            default_language="english",
        )
        log.info("Created products text index: %s", _INDEX_NAME)
    except Exception as e:
        log.warning("Failed to create products text index: %s", e)


@router.get("/suggest", response_model=SuggestPayload)
async def suggest(q: str = Query(..., min_length=1, max_length=80)):
    """Three-section typeahead: top products, matched brands, matched categories."""
    needle = q.strip()
    if not needle:
        return SuggestPayload(products=[], brands=[], categories=[])

    # Products — try $text first, fall back to regex if text index isn't ready.
    products: list[dict] = []
    base_filter = {"in_stock": True, "category": {"$nin": list(HIDDEN_BUYER_CATEGORIES)}}
    try:
        cursor = (
            db.products.find(
                {**base_filter, "$text": {"$search": needle}},
                {
                    "_id": 0, "id": 1, "name": 1, "image": 1,
                    "price_nzd": 1, "seller_name": 1,
                    "score": {"$meta": "textScore"},
                },
            )
            .sort([("score", {"$meta": "textScore"})])
            .limit(8)
        )
        async for p in cursor:
            products.append(p)
    except Exception:
        # Text-index unavailable (cold start) — degrade to substring regex
        regex = re.escape(needle)
        cursor = db.products.find(
            {
                **base_filter,
                "$or": [
                    {"name": {"$regex": regex, "$options": "i"}},
                    {"seller_name": {"$regex": regex, "$options": "i"}},
                ],
            },
            {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1, "seller_name": 1},
        ).limit(8)
        async for p in cursor:
            products.append(p)

    # Brands — distinct seller_names that contain the query
    brands_cursor = db.products.find(
        {"seller_name": {"$regex": re.escape(needle), "$options": "i"}, **base_filter},
        {"_id": 0, "seller_name": 1},
    ).limit(20)
    brand_set: set[str] = set()
    async for p in brands_cursor:
        name = (p.get("seller_name") or "").strip()
        if name:
            brand_set.add(name)
        if len(brand_set) >= 5:
            break

    # Categories — substring against known taxonomy values in the catalog
    cats_cursor = db.products.find(
        {"category": {"$regex": re.escape(needle), "$options": "i"}, **base_filter},
        {"_id": 0, "category": 1},
    ).limit(20)
    cat_set: set[str] = set()
    async for p in cats_cursor:
        cat = (p.get("category") or "").strip()
        if cat:
            cat_set.add(cat)
        if len(cat_set) >= 5:
            break

    return SuggestPayload(
        products=[SuggestProduct(**p) for p in products],
        brands=sorted(brand_set)[:5],
        categories=sorted(cat_set)[:5],
    )


@router.get("/trending", response_model=TrendingPayload)
async def trending():
    """Deterministic "popular searches" derived from the catalog (no events needed).

    Looks at the top brands + top categories by listing count → blends them into
    a single shuffled chip list, capped at 10.
    """
    pipeline = [
        {"$match": {"in_stock": True}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 8},
    ]
    cat_terms = [doc["_id"] async for doc in db.products.aggregate(pipeline) if doc.get("_id")]

    brand_pipeline = [
        {"$match": {"in_stock": True}},
        {"$group": {"_id": "$seller_name", "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
        {"$limit": 6},
    ]
    brand_terms = [doc["_id"] async for doc in db.products.aggregate(brand_pipeline) if doc.get("_id")]

    # Interleave categories and brands, dedupe, cap at 10
    terms: list[str] = []
    seen: set[str] = set()
    for a, b in zip(cat_terms, brand_terms):
        for term in (a, b):
            if term and term.lower() not in seen:
                seen.add(term.lower())
                terms.append(term)
    for remaining in cat_terms + brand_terms:
        if len(terms) >= 10:
            break
        if remaining and remaining.lower() not in seen:
            seen.add(remaining.lower())
            terms.append(remaining)

    return TrendingPayload(terms=terms[:10])
