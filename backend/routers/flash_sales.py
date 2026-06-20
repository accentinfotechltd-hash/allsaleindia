"""Flash sales / Deal of the Day — endpoints."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import (
    FlashSale,
    FlashSaleCreate,
    FlashSalePublic,
    FlashSaleUpdate,
)
from services.flash_sales import (
    create_sale,
    hydrate_with_products,
    list_currently_active,
)
from utils import from_doc

router = APIRouter(tags=["flash-sales"])


def _public(doc: dict) -> FlashSale:
    """Build the public FlashSale model, defaulting missing fields rather
    than crashing if the underlying document predates a schema field."""
    return from_doc(doc, FlashSale)


# ---------------------------------------------------------------------------
# Public — currently active sales (no auth)
# ---------------------------------------------------------------------------
@router.get("/flash-sales/active", response_model=List[FlashSalePublic])
async def public_active_sales(limit: int = 12):
    sales = await list_currently_active()
    hydrated = await hydrate_with_products(sales[: max(1, min(int(limit), 500))])
    return [FlashSalePublic(**h) for h in hydrated]


# ---------------------------------------------------------------------------
# Seller — manage own flash sales
# ---------------------------------------------------------------------------
async def _require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


@router.post("/seller/flash-sales", response_model=FlashSale, status_code=201)
async def create_flash_sale(
    body: FlashSaleCreate, current=Depends(_require_verified_seller)
):
    product = await db.products.find_one(
        {"id": body.product_id, "seller_id": current["id"]}, {"_id": 0}
    )
    if not product:
        raise HTTPException(
            status_code=404,
            detail="Product not found or doesn't belong to you",
        )
    try:
        doc = await create_sale(seller=current, product=product, body=body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _public(doc)


@router.get("/seller/flash-sales", response_model=List[FlashSale])
async def list_seller_flash_sales(current=Depends(_require_verified_seller)):
    out: list[FlashSale] = []
    async for s in db.flash_sales.find({"seller_id": current["id"]}, {"_id": 0}).sort(
        "created_at", -1
    ):
        out.append(_public(s))
    return out


@router.patch("/seller/flash-sales/{sale_id}", response_model=FlashSale)
async def update_flash_sale(
    sale_id: str, body: FlashSaleUpdate, current=Depends(_require_verified_seller)
):
    doc = await db.flash_sales.find_one({"id": sale_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Flash sale not found")
    if doc.get("seller_id") != current["id"]:
        raise HTTPException(status_code=403, detail="Not your flash sale")

    patch = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    # If sale_price changes, recompute discount_pct
    if "sale_price_nzd" in patch:
        original = float(doc["original_price_nzd"])
        new_price = float(patch["sale_price_nzd"])
        if new_price <= 0 or new_price >= original:
            raise HTTPException(
                status_code=400, detail="Sale price must be lower than list price"
            )
        patch["discount_pct"] = int(round((1 - (new_price / original)) * 100))
    if patch:
        await db.flash_sales.update_one({"id": sale_id}, {"$set": patch})
    fresh = await db.flash_sales.find_one({"id": sale_id}, {"_id": 0})
    return _public(fresh)


@router.delete("/seller/flash-sales/{sale_id}", status_code=204)
async def delete_flash_sale(
    sale_id: str, current=Depends(_require_verified_seller)
):
    doc = await db.flash_sales.find_one(
        {"id": sale_id}, {"_id": 0, "seller_id": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Flash sale not found")
    if doc.get("seller_id") != current["id"]:
        raise HTTPException(status_code=403, detail="Not your flash sale")
    await db.flash_sales.delete_one({"id": sale_id})
    return None
