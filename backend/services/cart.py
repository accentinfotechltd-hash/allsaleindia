"""Cart hydration helper."""
from __future__ import annotations

from db import db
from models import CartItem, CartView
from utils import compute_cart_totals


async def hydrate_cart(user_id: str) -> CartView:
    cart_doc = await db.carts.find_one({"user_id": user_id}, {"_id": 0})
    items: list[CartItem] = []
    if cart_doc:
        items = [CartItem(**i) for i in cart_doc.get("items", [])]
    hydrated = []
    for it in items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            continue
        hydrated.append(
            {
                "product_id": prod["id"],
                "name": prod["name"],
                "image": prod["image"],
                "price_nzd": prod["price_nzd"],
                "price_inr": prod["price_inr"],
                "quantity": it.quantity,
                "category": prod["category"],
            }
        )
    return compute_cart_totals(hydrated)
