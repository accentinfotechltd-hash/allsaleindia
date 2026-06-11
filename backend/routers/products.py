"""Public product catalog, taxonomy, duty and prohibited-item endpoints."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException

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
):
    """List the catalog with optional filters and sort.

    Filters:
      * `category`, `subcategory` — exact match against the taxonomy (case-sensitive)
      * `q` — case-insensitive substring on product name
      * `min_price`, `max_price` — NZD bounds (inclusive)
      * `brand` — case-insensitive substring on seller_name (company)
      * `in_stock` — only products with stock available

    Sort (`sort` param):
      * `price_asc` | `price_desc`
      * `newest` (by created_at desc, falls back to id)
      * `top_rated` (rating desc then reviews_count desc)
    """
    query: dict = {}
    if category and category.lower() != "all":
        query["category"] = category
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
    return [Product(**p) async for p in cursor]


@router.get("/brands", response_model=List[str])
async def list_brands(category: Optional[str] = None):
    """Distinct seller_name values, optionally scoped to a category.

    Used to populate the "Brand" filter chips on the buyer-facing catalog.
    Sellerless / platform products are excluded.
    """
    query: dict = {"seller_name": {"$nin": [None, ""]}}
    if category and category.lower() != "all":
        query["category"] = category
    names = await db.products.distinct("seller_name", query)
    return sorted([n for n in names if n])


@router.get("/categories", response_model=List[str])
async def list_categories():
    cats = await db.products.distinct("category")
    return sorted(cats)


@router.get("/taxonomy", response_model=List[TaxonomyNode])
async def get_taxonomy():
    return [TaxonomyNode(**node) for node in TAXONOMY]


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
