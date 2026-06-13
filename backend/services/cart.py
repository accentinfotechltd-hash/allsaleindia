"""Cart hydration helper."""
from __future__ import annotations

from db import db
from models import CartItem, CartView
from utils import compute_cart_totals


async def hydrate_cart(user_id: str) -> CartView:
    cart_doc = await db.carts.find_one({"user_id": user_id}, {"_id": 0})
    items: list[CartItem] = []
    coupon_code = None
    if cart_doc:
        items = [CartItem(**i) for i in cart_doc.get("items", [])]
        coupon_code = (cart_doc.get("coupon_code") or "").strip() or None
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
                "seller_id": prod.get("seller_id"),
            }
        )
    cart = compute_cart_totals(hydrated)

    # Apply persistent coupon if any (best-effort — silently drop if stale).
    if coupon_code:
        # Local import to avoid circular import at module load.
        from services.coupons import validate_for_cart

        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        _, result = await validate_for_cart(
            coupon_code, hydrated, cart.subtotal_nzd, user
        )
        if result.get("ok"):
            discount = float(result.get("discount_nzd") or 0)
            free_ship = bool(result.get("free_shipping"))
            new_shipping = 0.0 if free_ship else cart.shipping_nzd
            shipping_discount = round(cart.shipping_nzd - new_shipping, 2)
            cart = cart.model_copy(
                update={
                    "discount_nzd": round(discount + shipping_discount, 2),
                    "shipping_nzd": round(new_shipping, 2),
                    "total_nzd": round(
                        max(0.0, cart.subtotal_nzd + new_shipping - discount),
                        2,
                    ),
                    "coupon_code": coupon_code,
                    "coupon_label": result.get("label"),
                }
            )
        else:
            # Coupon became invalid — drop it from cart silently
            await db.carts.update_one(
                {"user_id": user_id}, {"$unset": {"coupon_code": ""}}
            )

    # Apply persistent loyalty-points redemption (best-effort).
    points_to_use = int((cart_doc or {}).get("points_to_use") or 0)
    points_balance = 0
    try:
        from services.points import (
            compute_redeem,
            current_balance,
            REDEEM_PTS_PER_NZD,
            MAX_REDEEM_PCT,
        )
        import math as _math

        points_balance = await current_balance(user_id)
        max_usable = (
            int(_math.floor(cart.subtotal_nzd * MAX_REDEEM_PCT * REDEEM_PTS_PER_NZD))
            // REDEEM_PTS_PER_NZD
            * REDEEM_PTS_PER_NZD
        )
        max_usable = min(max_usable, points_balance)

        pts_discount = 0.0
        pts_used = 0
        if points_to_use > 0 and cart.subtotal_nzd > 0 and points_balance > 0:
            res = compute_redeem(
                requested=points_to_use,
                balance=points_balance,
                subtotal_nzd=cart.subtotal_nzd,
            )
            if res["usable_points"] > 0:
                pts_used = res["usable_points"]
                pts_discount = res["discount_nzd"]
            else:
                # Stale — drop from cart silently
                await db.carts.update_one(
                    {"user_id": user_id}, {"$unset": {"points_to_use": ""}}
                )

        if pts_used > 0 or points_balance > 0 or max_usable > 0:
            new_total = round(max(0.0, cart.total_nzd - pts_discount), 2)
            cart = cart.model_copy(
                update={
                    "discount_nzd": round(cart.discount_nzd + pts_discount, 2),
                    "total_nzd": new_total,
                    "points_used": pts_used,
                    "points_discount_nzd": pts_discount,
                    "points_balance": points_balance,
                    "points_max_usable": max_usable,
                }
            )
    except Exception:
        pass

    return cart
