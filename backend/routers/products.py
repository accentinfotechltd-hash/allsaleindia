"""Public product catalog, taxonomy, duty and prohibited-item endpoints."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from config import (
    HIDDEN_BUYER_CATEGORIES,
    NZ_DUTY_RATE,
    NZ_DUTY_THRESHOLD_NZD,
    NZ_GST_RATE,
    PROHIBITED_KEYWORDS,
    TAXONOMY,
)
from db import db
from models import (
    DutyEstimateRequest,
    DutyEstimateResponse,
    Product,
    ProhibitedCheckRequest,
    ProhibitedCheckResponse,
    TaxonomyNode,
)

router = APIRouter(tags=["products"])


# Buyer-facing top-level groupings used to derive "gender" / "age_group"
# filters from a product's category. Keeps the model schema simple while
# letting the UI offer "Show me only Women's items" filters.
_WOMEN_CATEGORIES = {"Women's Clothing"}
_MEN_CATEGORIES = {"Men's Clothing"}
_KIDS_CATEGORIES = {"Kids' Fashion"}
_BABY_SUBCATS = {"Baby 0-24M", "Baby & Toddler Toys"}


def _derive_gender(category: str | None, subcategory: str | None) -> str:
    if not category:
        return "unisex"
    if category in _WOMEN_CATEGORIES or (subcategory or "").startswith("Women"):
        return "women"
    if category in _MEN_CATEGORIES or (subcategory or "").startswith("Men"):
        return "men"
    if category in _KIDS_CATEGORIES or (subcategory or "").startswith(("Girls", "Boys", "Baby", "Kids")):
        return "kids"
    return "unisex"


@router.get("/products", response_model=List[Product])
async def list_products(
    category: Optional[str] = None,
    subcategory: Optional[str] = None,
    q: Optional[str] = None,
    sort: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    brand: Optional[str] = None,
    in_stock: Optional[bool] = None,
    gender: Optional[str] = Query(default=None, description="women | men | kids | unisex"),
    age_group: Optional[str] = Query(default=None, description="baby | kids | adult"),
    sizes: Optional[List[str]] = Query(default=None, description="Filter by available size(s)"),
    colors: Optional[List[str]] = Query(default=None, description="Filter by available color(s)"),
    limit: int = Query(default=200, ge=1, le=5000, description="Max products to return"),
    skip: int = Query(default=0, ge=0, description="Number of products to skip for pagination"),
):
    """List the catalog with optional filters and sort.

    Filters:
      * `category`, `subcategory` — exact match against the taxonomy (case-sensitive)
      * `q` — case-insensitive substring on product name
      * `min_price`, `max_price` — NZD bounds (inclusive)
      * `brand` — case-insensitive substring on seller_name (company)
      * `in_stock` — only products with stock available
      * `gender` — `women` | `men` | `kids` | `unisex` (derived from category)
      * `age_group` — `baby` | `kids` | `adult` (derived from category)
      * `sizes` — list of sizes (any-match)
      * `colors` — list of colors (any-match, case-insensitive)

    Sort (`sort` param):
      * `price_asc` | `price_desc`
      * `newest` (by created_at desc, falls back to id)
      * `top_rated` (rating desc then reviews_count desc)
    """
    query: dict = {}
    # Buyer-side hidden categories: NEVER expose products in those categories
    # to non-seller listing endpoints, even if the seller had created them.
    query["category"] = {"$nin": list(HIDDEN_BUYER_CATEGORIES)}

    # Sellers in vacation mode — hide all their listings from buyers.
    paused_seller_ids: list[str] = []
    async for s in db.sellers.find(
        {"vacation_mode": True}, {"_id": 0, "user_id": 1}
    ):
        if s.get("user_id"):
            paused_seller_ids.append(s["user_id"])
    if paused_seller_ids:
        query["seller_id"] = {"$nin": paused_seller_ids}

    if category and category.lower() != "all":
        if category in HIDDEN_BUYER_CATEGORIES:
            return []  # explicit hidden — return empty
        query["category"] = category  # override the $nin
    if subcategory and subcategory.lower() != "all":
        query["subcategory"] = subcategory
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    if brand:
        query["seller_name"] = {"$regex": brand, "$options": "i"}
    if in_stock is True:
        query["in_stock"] = True
    price_range: dict = {}
    if min_price is not None:
        price_range["$gte"] = float(min_price)
    if max_price is not None:
        price_range["$lte"] = float(max_price)
    if price_range:
        query["price_nzd"] = price_range

    # Gender filter — map to category set.
    if gender:
        g = gender.lower().strip()
        if g == "women":
            query["category"] = "Women's Clothing"
        elif g == "men":
            query["category"] = "Men's Clothing"
        elif g == "kids":
            query["category"] = "Kids' Fashion"
        # `unisex` is the default; no additional filter applied.

    # Age group filter — only narrows kids' down to baby vs older.
    if age_group:
        ag = age_group.lower().strip()
        if ag == "baby":
            query["subcategory"] = {"$in": list(_BABY_SUBCATS)}
        elif ag == "kids":
            query["category"] = "Kids' Fashion"

    if sizes:
        query["sizes"] = {"$in": sizes}
    if colors:
        query["colors"] = {
            "$in": [{"$regex": f"^{c}$", "$options": "i"} for c in colors]
        }
        # Mongo $in doesn't take regex objects directly — switch to $elemMatch
        query.pop("colors", None)
        query["$or"] = [
            {"colors": {"$regex": f"^{c}$", "$options": "i"}} for c in colors
        ]

    sort_spec: Optional[list] = None
    if sort == "price_asc":
        sort_spec = [("price_nzd", 1)]
    elif sort == "price_desc":
        sort_spec = [("price_nzd", -1)]
    elif sort == "newest":
        sort_spec = [("created_at", -1), ("id", -1)]
    elif sort == "top_rated":
        sort_spec = [("rating", -1), ("reviews_count", -1)]

    cursor = db.products.find(query, {"_id": 0})
    if sort_spec:
        cursor = cursor.sort(sort_spec)
    cursor = cursor.skip(skip).limit(limit)
    out: list[Product] = []
    async for p in cursor:
        try:
            out.append(Product(**p))
        except Exception:
            # Skip malformed legacy/junk rows rather than 500'ing the whole list.
            continue
    return out


@router.get("/brands", response_model=List[str])
async def list_brands(category: Optional[str] = None):
    """Distinct seller_name values, optionally scoped to a category.

    Used to populate the "Brand" filter chips on the buyer-facing catalog.
    Sellerless / platform products are excluded.
    """
    query: dict = {"seller_name": {"$nin": [None, ""]}}
    if category and category.lower() != "all":
        query["category"] = category
    else:
        query["category"] = {"$nin": list(HIDDEN_BUYER_CATEGORIES)}
    names = await db.products.distinct("seller_name", query)
    return sorted([n for n in names if n])


@router.get("/categories", response_model=List[str])
async def list_categories():
    cats = await db.products.distinct("category")
    return sorted(c for c in cats if c not in HIDDEN_BUYER_CATEGORIES)


@router.get("/taxonomy", response_model=List[TaxonomyNode])
async def get_taxonomy():
    return [
        TaxonomyNode(**node)
        for node in TAXONOMY
        if node["name"] not in HIDDEN_BUYER_CATEGORIES
    ]


@router.post("/duty/estimate", response_model=DutyEstimateResponse)
async def duty_estimate(body: DutyEstimateRequest):
    goods = round(sum(it.price_nzd * it.quantity for it in body.items), 2)
    shipping = round(max(0.0, body.shipping_nzd), 2)
    over = goods > NZ_DUTY_THRESHOLD_NZD
    gst = round((goods + shipping) * NZ_GST_RATE, 2)
    duty = round(goods * NZ_DUTY_RATE, 2) if over else 0.0
    customs = round(gst + duty, 2)
    grand = round(goods + shipping + gst + duty, 2)
    return DutyEstimateResponse(
        goods_nzd=goods,
        shipping_nzd=shipping,
        gst_nzd=gst,
        duty_nzd=duty,
        customs_total_nzd=customs,
        grand_total_nzd=grand,
        threshold_nzd=NZ_DUTY_THRESHOLD_NZD,
        over_threshold=over,
    )


@router.post("/prohibited/check", response_model=ProhibitedCheckResponse)
async def check_prohibited(body: ProhibitedCheckRequest):
    text = (body.text or "").lower()
    if not text.strip():
        return ProhibitedCheckResponse(
            allowed=True,
            advice="Type a product name above to check if NZ MPI will allow it.",
        )
    for entry in PROHIBITED_KEYWORDS:
        if entry["term"] in text:
            return ProhibitedCheckResponse(
                allowed=False,
                matched_term=entry["term"],
                reason=entry["reason"],
                advice="This item cannot be shipped to NZ via Allsale. Please choose a sealed, branded alternative.",
            )
    return ProhibitedCheckResponse(
        allowed=True,
        advice="Looks fine for NZ import. Make sure your packaging is sealed & branded.",
    )


@router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return Product(**p)


@router.get("/products/{product_id}/recommendations", response_model=List[Product])
async def get_recommendations(product_id: str, limit: int = 8):
    """"You may also like" — scored by category match + rating + reviews.

    Algorithm (no LLM needed for MVP):
    - Same category as current product, excluding itself & out-of-stock items.
    - Rank by (rating * log(1+reviews_count) * 100) descending.
    - Fall back to top-rated overall if category yields too few results.
    """
    import math

    base = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "category": 1, "tags": 1, "seller_id": 1}
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
            score = r * math.log(1 + n) * 10 if r > 0 else float(p.get("price_nzd", 0)) / 1000
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
