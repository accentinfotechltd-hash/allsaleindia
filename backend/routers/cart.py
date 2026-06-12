"""Per-user persistent cart."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import CartAddRequest, CartUpdateRequest, CartView, CouponValidateRequest
from services.cart import hydrate_cart
from services.coupons import validate_for_cart
from utils import now_utc

router = APIRouter(tags=["cart"])


@router.get("/cart", response_model=CartView)
async def get_cart(current=Depends(get_current_user)):
    return await hydrate_cart(current["id"])


@router.post("/cart", response_model=CartView)
async def add_to_cart(body: CartAddRequest, current=Depends(get_current_user)):
    prod = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    qty = max(1, body.quantity)

    # Stock guard.
    stock_count = prod.get("stock_count")
    if stock_count is not None and not prod.get("in_stock", True):
        raise HTTPException(status_code=400, detail="This product is currently out of stock.")
    if isinstance(stock_count, int) and stock_count > 0:
        cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0})
        existing = next(
            (
                it["quantity"]
                for it in (cart or {}).get("items", [])
                if it["product_id"] == body.product_id
            ),
            0,
        )
        if existing + qty > stock_count:
            raise HTTPException(
                status_code=400,
                detail=f"Only {stock_count - existing} more available in stock.",
            )

    cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0})
    items: list[dict] = cart.get("items", []) if cart else []
    found = False
    for it in items:
        if it["product_id"] == body.product_id:
            it["quantity"] += qty
            found = True
            break
    if not found:
        items.append({"product_id": body.product_id, "quantity": qty})
    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"items": items, "updated_at": now_utc()}},
        upsert=True,
    )
    return await hydrate_cart(current["id"])


# ---------------------------------------------------------------------------
# Coupons on the persistent cart — declared BEFORE the {product_id} routes so
# that DELETE /cart/coupon isn't shadowed by DELETE /cart/{product_id}.
# ---------------------------------------------------------------------------
@router.post("/cart/coupon", response_model=CartView)
async def apply_coupon_to_cart(
    body: CouponValidateRequest, current=Depends(get_current_user)
):
    cart = await hydrate_cart(current["id"])
    if not cart.items:
        raise HTTPException(status_code=400, detail="Your cart is empty")

    code = (body.code or "").strip().upper()
    _, result = await validate_for_cart(code, cart.items, cart.subtotal_nzd, current)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Invalid coupon")

    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"coupon_code": code, "updated_at": now_utc()}},
        upsert=True,
    )
    return await hydrate_cart(current["id"])


@router.delete("/cart/coupon", response_model=CartView)
async def remove_coupon_from_cart(current=Depends(get_current_user)):
    await db.carts.update_one(
        {"user_id": current["id"]}, {"$unset": {"coupon_code": ""}}
    )
    return await hydrate_cart(current["id"])


@router.put("/cart/{product_id}", response_model=CartView)
async def update_cart_item(
    product_id: str, body: CartUpdateRequest, current=Depends(get_current_user)
):
    cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0})
    items: list[dict] = cart.get("items", []) if cart else []
    if body.quantity <= 0:
        items = [it for it in items if it["product_id"] != product_id]
    else:
        prod = await db.products.find_one({"id": product_id}, {"_id": 0})
        if prod:
            stock_count = prod.get("stock_count")
            if (
                isinstance(stock_count, int)
                and stock_count > 0
                and body.quantity > stock_count
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Only {stock_count} available in stock.",
                )
            if stock_count is not None and not prod.get("in_stock", True):
                raise HTTPException(
                    status_code=400, detail="This product is currently out of stock."
                )
        found = False
        for it in items:
            if it["product_id"] == product_id:
                it["quantity"] = body.quantity
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Item not in cart")
    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"items": items, "updated_at": now_utc()}},
        upsert=True,
    )
    return await hydrate_cart(current["id"])


@router.delete("/cart/{product_id}", response_model=CartView)
async def remove_cart_item(product_id: str, current=Depends(get_current_user)):
    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$pull": {"items": {"product_id": product_id}}},
    )
    return await hydrate_cart(current["id"])


# ---------------------------------------------------------------------------
# Coupons on the persistent cart
# ---------------------------------------------------------------------------
@router.post("/cart/coupon", response_model=CartView)
async def apply_coupon_to_cart(
    body: CouponValidateRequest, current=Depends(get_current_user)
):
    cart = await hydrate_cart(current["id"])
    if not cart.items:
        raise HTTPException(status_code=400, detail="Your cart is empty")

    code = (body.code or "").strip().upper()
    _, result = await validate_for_cart(code, cart.items, cart.subtotal_nzd, current)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Invalid coupon")

    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"coupon_code": code, "updated_at": now_utc()}},
        upsert=True,
    )
    return await hydrate_cart(current["id"])


@router.delete("/cart/coupon", response_model=CartView)
async def remove_coupon_from_cart(current=Depends(get_current_user)):
    await db.carts.update_one(
        {"user_id": current["id"]}, {"$unset": {"coupon_code": ""}}
    )
    return await hydrate_cart(current["id"])
