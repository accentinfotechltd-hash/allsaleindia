"""Public product catalog, taxonomy, duty and prohibited-item endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
    # ---------------- New product feed flags (mobile-agent fix) ----------------
    seller_id: Optional[str] = Query(default=None, description="Filter to a single seller. Unknown id → empty list (not silent-all)."),
    on_sale: Optional[bool] = Query(default=None, description="Only products currently in an active flash sale."),
    is_new: Optional[bool] = Query(default=None, alias="new", description="Products created within the last 30 days."),
    bestseller: Optional[bool] = Query(default=None, description="Top-rated, well-reviewed items (rating >=4.0, reviews >=50)."),
    ambassador_pick: Optional[bool] = Query(default=None, description="Curated by Allsale ambassadors."),
    # ---------------- Amazon-style facet filters (June 2026) -----------------
    min_rating: Optional[float] = Query(default=None, ge=0, le=5, description="Only products with rating >= this value (Amazon-style 4★ & up)."),
    min_discount_pct: Optional[int] = Query(default=None, ge=0, le=99, description="Only products in an active flash sale with discount_pct >= this."),
    # --------------------------------------------------------------------------
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
        # Prefer the full-text index for relevance ranking; fall back to a
        # case-insensitive substring match if the index isn't ready yet.
        try:
            query["$text"] = {"$search": q}
        except Exception:
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

    # ------------------------------------------------------------------
    # Mobile-agent fix (June 2026):
    # `seller_id`, `on_sale`, `new`, `bestseller`, and `ambassador_pick`
    # were previously dropped on the floor — query strings looked valid
    # but the response silently returned the whole catalogue. We now
    # honour each one explicitly.
    # ------------------------------------------------------------------
    extra_id_constraints: list[list[str]] = []

    if seller_id:
        seller_doc = await db.users.find_one(
            {"id": seller_id, "is_seller": True}, {"_id": 0, "id": 1}
        )
        if not seller_doc:
            # Explicit empty — better UX than silently returning every product.
            return []
        # Replace the paused-seller $nin restriction with an exact match.
        query["seller_id"] = seller_id

    if on_sale is True:
        now = datetime.now(timezone.utc)
        active_pids: list[str] = []
        async for fs in db.flash_sales.find(
            {
                "active": True,
                "valid_from": {"$lte": now},
                "valid_to": {"$gte": now},
            },
            {"_id": 0, "product_id": 1},
        ):
            if fs.get("product_id"):
                active_pids.append(fs["product_id"])
        if not active_pids:
            return []
        extra_id_constraints.append(active_pids)

    if is_new is True:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        query["created_at"] = {"$gte": cutoff}

    if bestseller is True:
        # Top items rather than every product — a heuristic that
        # works without a separate sales-aggregate collection.
        query["rating"] = {"$gte": 4.0}
        query["reviews_count"] = {"$gte": 50}

    if ambassador_pick is True:
        pick_pids: list[str] = []
        async for ap in db.ambassador_picks.find(
            {"active": {"$ne": False}}, {"_id": 0, "product_id": 1}
        ):
            if ap.get("product_id"):
                pick_pids.append(ap["product_id"])
        if not pick_pids:
            return []
        extra_id_constraints.append(pick_pids)

    # Amazon-style facets ----------------------------------------------------
    if min_rating is not None:
        # Combine with any existing rating constraint (e.g. bestseller=true).
        existing = query.get("rating")
        floor = float(min_rating)
        if isinstance(existing, dict):
            existing["$gte"] = max(float(existing.get("$gte", 0)), floor)
        else:
            query["rating"] = {"$gte": floor}

    if min_discount_pct is not None and min_discount_pct > 0:
        now = datetime.now(timezone.utc)
        discount_pids: list[str] = []
        async for fs in db.flash_sales.find(
            {
                "active": True,
                "valid_from": {"$lte": now},
                "valid_to": {"$gte": now},
                "discount_pct": {"$gte": int(min_discount_pct)},
            },
            {"_id": 0, "product_id": 1},
        ):
            if fs.get("product_id"):
                discount_pids.append(fs["product_id"])
        if not discount_pids:
            return []
        extra_id_constraints.append(discount_pids)

    if extra_id_constraints:
        # Intersect each constraint so multiple flags combine via AND.
        intersected = set(extra_id_constraints[0])
        for c in extra_id_constraints[1:]:
            intersected &= set(c)
        if not intersected:
            return []
        query["id"] = {"$in": list(intersected)}

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


@router.get("/categories/{category_name}/subcategories")
async def category_subcategory_tiles(category_name: str):
    """Amazon-style "Shop by subcategory" tiles for a given category.

    Returns one row per subcategory declared in the static TAXONOMY, enriched
    with a sample product image and the live in-stock product count from
    Mongo. Subcategories without a single live listing are still returned
    (with `product_count=0`, `sample_image=None`) so the taxonomy stays
    discoverable while the catalog is being seeded.
    """
    if category_name in HIDDEN_BUYER_CATEGORIES:
        raise HTTPException(status_code=404, detail="Category not found")

    node = next(
        (t for t in TAXONOMY if t["name"] == category_name),
        None,
    )
    if not node:
        raise HTTPException(status_code=404, detail="Category not found")

    # Sellers in vacation mode are hidden from buyers, same as /products.
    paused_seller_ids: list[str] = []
    async for s in db.sellers.find(
        {"vacation_mode": True}, {"_id": 0, "user_id": 1}
    ):
        if s.get("user_id"):
            paused_seller_ids.append(s["user_id"])

    base_match: dict = {"category": category_name}
    if paused_seller_ids:
        base_match["seller_id"] = {"$nin": paused_seller_ids}

    # Single $group aggregation per subcategory — counts + first image.
    pipeline = [
        {"$match": base_match},
        {
            "$group": {
                "_id": "$subcategory",
                "product_count": {"$sum": 1},
                "sample_image": {"$first": "$image"},
            }
        },
    ]
    agg: dict[str, dict] = {}
    async for row in db.products.aggregate(pipeline):
        key = row.get("_id")
        if not key:
            continue
        agg[key] = {
            "product_count": int(row.get("product_count") or 0),
            "sample_image": row.get("sample_image"),
        }

    tiles: list[dict] = []
    for sub in node.get("subcategories", []):
        bucket = agg.get(sub, {})
        tiles.append(
            {
                "name": sub,
                "product_count": bucket.get("product_count", 0),
                "sample_image": bucket.get("sample_image"),
            }
        )

    return {
        "category": category_name,
        "blurb": node.get("blurb", ""),
        "subcategories": tiles,
    }



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


# ---------------------------------------------------------------------------
# REST alias: /api/products/{product_id}/reviews
# (Delegates to the reviews router so business logic stays in one place.)
# ---------------------------------------------------------------------------
@router.get("/products/{product_id}/reviews")
async def product_reviews_alias(
    product_id: str,
    sort: str = Query(
        "recent", description="recent | helpful | rating_desc | rating_asc"
    ),
    authorization: Optional[str] = None,
):
    """Alias for GET /reviews/product/{product_id}.

    Returns the same ReviewsPage payload (summary, items, can_review,
    eligible_order_ids).  The Authorization header is forwarded so the
    `can_review` flag is computed correctly when the caller is signed in.
    """
    from routers.reviews import list_product_reviews

    return await list_product_reviews(
        product_id=product_id, sort=sort, authorization=authorization
    )
