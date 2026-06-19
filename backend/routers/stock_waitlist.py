"""Buyer-facing back-in-stock waitlist endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from services.stock_waitlist import (
    add_to_waitlist,
    is_on_waitlist,
    list_for_user,
    remove_from_waitlist,
)

router = APIRouter(tags=["stock-waitlist"])


@router.post("/products/{product_id}/notify-when-in-stock")
async def opt_in(product_id: str, current=Depends(get_current_user)):
    """Opt-in to a one-shot back-in-stock notification.

    Idempotent — calling twice returns the same `{watching: true}`.
    Refuses if the product is already in stock (no point in waiting).
    """
    prod = await db.products.find_one(
        {"id": product_id},
        {"_id": 0, "id": 1, "in_stock": 1, "stock_count": 1},
    )
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    if int(prod.get("stock_count", 0) or 0) > 0 and prod.get("in_stock", True):
        raise HTTPException(
            status_code=400,
            detail="This product is already in stock.",
        )
    added = await add_to_waitlist(current["id"], product_id)
    return {"watching": True, "newly_added": added}


@router.delete("/products/{product_id}/notify-when-in-stock")
async def opt_out(product_id: str, current=Depends(get_current_user)):
    removed = await remove_from_waitlist(current["id"], product_id)
    return {"watching": False, "removed": removed}


@router.get("/products/{product_id}/notify-when-in-stock")
async def check(product_id: str, current=Depends(get_current_user)):
    """Returns whether the current buyer is on this product's waitlist."""
    return {"watching": await is_on_waitlist(current["id"], product_id)}


@router.get("/me/stock-watch")
async def my_watchlist(current=Depends(get_current_user)):
    """List every product the buyer is waiting on."""
    return {"items": await list_for_user(current["id"])}
