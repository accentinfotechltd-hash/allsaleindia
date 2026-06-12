"""Wishlist — buyers save products for later.

Stored as one document per (user, product) in `wishlists`. Listing
joins on `products` for fresh price / image / availability.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from deps import get_current_user
from utils import now_utc

router = APIRouter(prefix="/wishlist", tags=["wishlist"])


class WishlistItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    price_inr: float
    category: str
    rating: float = 0.0
    reviews_count: int = 0
    in_stock: bool = True
    seller_name: str | None = None
    seller_city: str | None = None
    added_at: str


@router.get("", response_model=List[WishlistItem])
async def list_wishlist(current=Depends(get_current_user)):
    rows: list[WishlistItem] = []
    async for w in db.wishlists.find({"user_id": current["id"]}, {"_id": 0}).sort(
        "added_at", -1
    ):
        prod = await db.products.find_one(
            {"id": w["product_id"]},
            {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1, "price_inr": 1, "category": 1, "rating": 1, "reviews_count": 1, "stock_count": 1, "seller_name": 1, "seller_city": 1},
        )
        if not prod:
            continue
        rows.append(
            WishlistItem(
                product_id=prod["id"],
                name=prod["name"],
                image=prod["image"],
                price_nzd=float(prod.get("price_nzd", 0)),
                price_inr=float(prod.get("price_inr", 0)),
                category=prod.get("category", ""),
                rating=float(prod.get("rating", 0) or 0),
                reviews_count=int(prod.get("reviews_count", 0) or 0),
                in_stock=int(prod.get("stock_count", 0) or 0) > 0,
                seller_name=prod.get("seller_name"),
                seller_city=prod.get("seller_city"),
                added_at=w.get("added_at").isoformat() if w.get("added_at") else "",
            )
        )
    return rows


@router.get("/ids", response_model=List[str])
async def list_wishlist_ids(current=Depends(get_current_user)):
    """Lightweight — just the product_ids so the client can render heart
    icons across the whole catalog without fetching full hydrated data."""
    return [
        w["product_id"]
        async for w in db.wishlists.find(
            {"user_id": current["id"]}, {"_id": 0, "product_id": 1}
        )
    ]


@router.post("/{product_id}", status_code=201)
async def add_to_wishlist(product_id: str, current=Depends(get_current_user)):
    prod = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "id": 1, "seller_id": 1}
    )
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    # Upsert idempotently
    await db.wishlists.update_one(
        {"user_id": current["id"], "product_id": product_id},
        {
            "$setOnInsert": {
                "user_id": current["id"],
                "product_id": product_id,
                "added_at": now_utc(),
            }
        },
        upsert=True,
    )
    count = await db.wishlists.count_documents({"user_id": current["id"]})
    return {"added": True, "wishlist_count": count}


@router.delete("/{product_id}", status_code=200)
async def remove_from_wishlist(product_id: str, current=Depends(get_current_user)):
    await db.wishlists.delete_one(
        {"user_id": current["id"], "product_id": product_id}
    )
    count = await db.wishlists.count_documents({"user_id": current["id"]})
    return {"removed": True, "wishlist_count": count}
