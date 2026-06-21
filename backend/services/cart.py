"""Cart hydration helper."""
from __future__ import annotations

from typing import Optional

from db import db
from models import CartItem, CartView
from services.tax import compute_tax
from utils import compute_cart_totals

# Pricing dial — keep central so we can later move it into admin/config.
GIFT_WRAP_FEE_PER_LINE_NZD: float = 5.00


async def hydrate_cart(
    user_id: str, country: Optional[str] = None
) -> CartView:
    cart_doc = await db.carts.find_one({"user_id": user_id}, {"_id": 0})
    items: list[CartItem] = []
    coupon_code = None
    if cart_doc:
        items = [CartItem(**i) for i in cart_doc.get("items", [])]
        coupon_code = (cart_doc.get("coupon_code") or "").strip() or None
    hydrated = []
    flash_sales_applied: dict[str, dict] = {}  # product_id -> sale doc
    for it in items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            continue
        # Honor any active flash sale on this product (substitute price)
        try:
            from services.flash_sales import get_active_for_product
            sale = await get_active_for_product(prod["id"])
        except Exception:
            sale = None
        price_nzd = float(prod["price_nzd"])
        original_price_nzd = price_nzd
        if sale:
            price_nzd = float(sale["sale_price_nzd"])
            flash_sales_applied[prod["id"]] = sale
        hydrated.append(
            {
                "product_id": prod["id"],
                "name": prod["name"],
                "image": prod["image"],
                "price_nzd": price_nzd,
                "original_price_nzd": original_price_nzd,
                "price_inr": prod["price_inr"],
                "quantity": it.quantity,
                "category": prod["category"],
                "seller_id": prod.get("seller_id"),
                "flash_sale_id": (sale or {}).get("id"),
                "gift_wrap": bool(getattr(it, "gift_wrap", False)),
                "gift_message": (getattr(it, "gift_message", None) or None),
            }
        )
    cart = compute_cart_totals(hydrated)

    # ----- Gift-wrap fee (per gift-wrapped LINE, flat) -------------------
    gift_count = sum(1 for h in hydrated if h.get("gift_wrap"))
    gift_fee = round(gift_count * GIFT_WRAP_FEE_PER_LINE_NZD, 2)
    if gift_fee > 0:
        cart = cart.model_copy(
            update={
                "gift_wrap_fee_nzd": gift_fee,
                "gift_wrap_count": gift_count,
                "total_nzd": round(cart.total_nzd + gift_fee, 2),
            }
        )
    else:
        cart = cart.model_copy(
            update={"gift_wrap_fee_nzd": 0.0, "gift_wrap_count": 0}
        )

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
        elif points_to_use > 0 and points_balance <= 0:
            # Defence-in-depth: balance hit 0 externally → drop stale field
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

    # ----- Tax / duty (per destination country) --------------------------
    # We ONLY apply tax when the caller explicitly knows the destination —
    # the cart endpoint passes `?country=` from the buyer's RegionContext,
    # and the checkout endpoint passes the shipping address country.
    # If no country is supplied we leave tax at 0 so cart fetches before a
    # destination is selected don't show a misleading line item.
    if country:
        tax = compute_tax(
            subtotal_nzd=cart.subtotal_nzd,
            shipping_nzd=cart.shipping_nzd,
            country=country,
        )
        cart = cart.model_copy(
            update={
                **tax.to_dict(),
                "total_nzd": round(cart.total_nzd + tax.tax_nzd, 2),
            }
        )

    return cart
