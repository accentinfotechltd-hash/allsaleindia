"""Seller listings: CRUD on a seller's own product catalog plus bulk edit."""
from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from config import INR_PER_NZD
from db import db
from deps import get_current_user
from models import (
    BulkListingOp,
    BulkListingResult,
    ListingCreate,
    ListingUpdate,
    Product,
)
from utils import clean_string_list, now_utc

from ._common import require_verified_seller

router = APIRouter(tags=["seller"])

VALID_BULK_ACTIONS = {
    "set_price",
    "adjust_price_pct",
    "set_stock",
    "adjust_stock",
    "set_category",
    "set_in_stock",
    "delete",
}


@router.post("/seller/products", response_model=Product)
async def create_listing(
    body: ListingCreate, seller=Depends(require_verified_seller)
):
    pid = str(uuid.uuid4())
    profile = await db.sellers.find_one({"user_id": seller["id"]}, {"_id": 0})
    company = (profile or {}).get("company_name", seller.get("full_name"))
    seller_city = (profile or {}).get("city")

    colors = clean_string_list(body.colors, 10)
    sizes = clean_string_list(body.sizes, 12)

    # Photos: accept either `image` (legacy single URL) or `images` (new list).
    raw_images: list[str] = []
    if body.images:
        raw_images.extend(body.images)
    if body.image and body.image not in raw_images:
        raw_images.insert(0, body.image)
    images = [s.strip() for s in raw_images if s and s.strip()][:10]
    if not images:
        raise HTTPException(
            status_code=400, detail="At least one product photo is required"
        )
    for s in images:
        if s.startswith("data:") and len(s) > 2_400_000:
            raise HTTPException(
                status_code=413,
                detail="One of the photos is too large (please use images under ~1.5 MB).",
            )
    primary = images[0]

    doc = {
        "id": pid,
        "name": body.name.strip(),
        "description": body.description.strip(),
        "category": body.category.strip(),
        "price_nzd": float(body.price_nzd),
        "price_inr": round(body.price_nzd * INR_PER_NZD, 0),
        "image": primary,
        "images": images,
        "rating": 0.0,
        "reviews_count": 0,
        "in_stock": int(body.stock_count) > 0,
        "stock_count": int(body.stock_count),
        "colors": colors,
        "sizes": sizes,
        "shipping_days_min": int(body.shipping_days_min),
        "shipping_days_max": int(body.shipping_days_max),
        "origin": "India",
        "seller_id": seller["id"],
        "seller_name": company,
        "seller_city": seller_city,
        "created_at": now_utc(),
    }
    await db.products.insert_one(doc)
    return Product(**{k: v for k, v in doc.items() if k != "created_at"})


@router.get("/seller/products", response_model=List[Product])
async def list_my_listings(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = (
        db.products.find({"seller_id": current["id"]}, {"_id": 0})
        .sort("created_at", -1)
    )
    return [
        Product(**{k: v for k, v in p.items() if k != "created_at"})
        async for p in cursor
    ]


@router.delete("/seller/products/{product_id}")
async def delete_listing(
    product_id: str, seller=Depends(require_verified_seller)
):
    res = await db.products.delete_one(
        {"id": product_id, "seller_id": seller["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Listing not found")
    return {"deleted": True}


@router.patch("/seller/products/{product_id}", response_model=Product)
async def update_listing(
    product_id: str,
    body: ListingUpdate,
    seller=Depends(require_verified_seller),
):
    existing = await db.products.find_one(
        {"id": product_id, "seller_id": seller["id"]}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Listing not found")

    update: dict = {}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.category is not None:
        update["category"] = body.category.strip()
    if body.price_nzd is not None:
        update["price_nzd"] = float(body.price_nzd)
        update["price_inr"] = round(body.price_nzd * INR_PER_NZD, 0)
    if body.images is not None:
        imgs = [s.strip() for s in body.images if s and s.strip()][:10]
        if not imgs:
            raise HTTPException(
                status_code=400, detail="At least one product photo is required"
            )
        for s in imgs:
            if s.startswith("data:") and len(s) > 2_400_000:
                raise HTTPException(
                    status_code=413,
                    detail="One of the photos is too large (please use images under ~1.5 MB).",
                )
        update["images"] = imgs
        update["image"] = imgs[0]
    if body.colors is not None:
        update["colors"] = clean_string_list(body.colors, 10)
    if body.sizes is not None:
        update["sizes"] = clean_string_list(body.sizes, 12)
    if body.stock_count is not None:
        update["stock_count"] = int(body.stock_count)
        update["in_stock"] = int(body.stock_count) > 0

    if not update:
        return Product(
            **{k: v for k, v in existing.items() if k != "created_at"}
        )

    update["updated_at"] = now_utc()
    await db.products.update_one({"id": product_id}, {"$set": update})

    # Back-in-stock fan-out: if this update crossed stock from 0 → >0,
    # notify every buyer on the waitlist (best-effort, never blocks).
    try:
        was_oos = (
            int(existing.get("stock_count", 0) or 0) <= 0
            or not existing.get("in_stock", True)
        )
        now_in_stock = int(update.get("stock_count", existing.get("stock_count") or 0)) > 0
        if was_oos and now_in_stock:
            from services.stock_waitlist import notify_back_in_stock
            await notify_back_in_stock(product_id)
    except Exception:
        pass

    merged = {**existing, **update}
    return Product(
        **{
            k: v
            for k, v in merged.items()
            if k not in {"created_at", "updated_at"}
        }
    )


@router.post("/seller/products/bulk", response_model=BulkListingResult)
async def bulk_listings_op(
    body: BulkListingOp, seller=Depends(require_verified_seller)
):
    """Apply a single bulk operation to many of the seller's listings.

    Operations:
      * ``set_price`` (requires ``price_nzd``)
      * ``adjust_price_pct`` (requires ``pct``; e.g. ``-10`` for a 10% discount)
      * ``set_stock`` (requires ``stock_count``)
      * ``adjust_stock`` (requires ``stock_delta``; e.g. ``+5``)
      * ``set_category`` (requires ``category``)
      * ``set_in_stock`` (requires ``in_stock`` boolean)
      * ``delete``
    """
    if body.action not in VALID_BULK_ACTIONS:
        raise HTTPException(
            status_code=400, detail=f"Unknown action: {body.action}"
        )

    # Always scope to the seller's own products to prevent cross-seller damage.
    base_filter: dict = {
        "id": {"$in": body.product_ids},
        "seller_id": seller["id"],
    }

    if body.action == "delete":
        res = await db.products.delete_many(base_filter)
        return BulkListingResult(
            matched=res.deleted_count,
            modified=0,
            deleted=res.deleted_count,
            action=body.action,
        )

    if body.action == "set_price":
        if body.price_nzd is None:
            raise HTTPException(status_code=400, detail="price_nzd required")
        new_price = round(float(body.price_nzd), 2)
        res = await db.products.update_many(
            base_filter,
            {
                "$set": {
                    "price_nzd": new_price,
                    "price_inr": round(new_price * INR_PER_NZD, 0),
                    "updated_at": now_utc(),
                }
            },
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "adjust_price_pct":
        if body.pct is None:
            raise HTTPException(status_code=400, detail="pct required")
        factor = 1.0 + float(body.pct) / 100.0
        if factor <= 0:
            raise HTTPException(
                status_code=400, detail="pct would zero/negate price"
            )
        res = await db.products.update_many(
            base_filter,
            [
                {
                    "$set": {
                        "price_nzd": {
                            "$round": [
                                {"$multiply": ["$price_nzd", factor]},
                                2,
                            ]
                        }
                    }
                },
                {
                    "$set": {
                        "price_inr": {
                            "$round": [
                                {"$multiply": ["$price_nzd", INR_PER_NZD]},
                                0,
                            ]
                        },
                        "updated_at": now_utc(),
                    }
                },
            ],
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "set_stock":
        if body.stock_count is None:
            raise HTTPException(status_code=400, detail="stock_count required")
        sc = int(body.stock_count)
        res = await db.products.update_many(
            base_filter,
            {
                "$set": {
                    "stock_count": sc,
                    "in_stock": sc > 0,
                    "updated_at": now_utc(),
                }
            },
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "adjust_stock":
        if body.stock_delta is None:
            raise HTTPException(status_code=400, detail="stock_delta required")
        delta = int(body.stock_delta)
        res = await db.products.update_many(
            base_filter,
            [
                {
                    "$set": {
                        "stock_count": {
                            "$max": [
                                0,
                                {
                                    "$add": [
                                        {"$ifNull": ["$stock_count", 0]},
                                        delta,
                                    ]
                                },
                            ]
                        }
                    }
                },
                {
                    "$set": {
                        "in_stock": {"$gt": ["$stock_count", 0]},
                        "updated_at": now_utc(),
                    }
                },
            ],
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "set_category":
        if not body.category:
            raise HTTPException(status_code=400, detail="category required")
        res = await db.products.update_many(
            base_filter,
            {
                "$set": {
                    "category": body.category.strip(),
                    "updated_at": now_utc(),
                }
            },
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    # set_in_stock
    if body.in_stock is None:
        raise HTTPException(status_code=400, detail="in_stock required")
    res = await db.products.update_many(
        base_filter,
        {
            "$set": {
                "in_stock": bool(body.in_stock),
                "updated_at": now_utc(),
            }
        },
    )
    return BulkListingResult(
        matched=res.matched_count,
        modified=res.modified_count,
        deleted=0,
        action=body.action,
    )
