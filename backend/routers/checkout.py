"""Stripe checkout session creation, polling and webhook."""
from __future__ import annotations

import logging
import uuid

from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    CheckoutStatusResponse,
)
from fastapi import APIRouter, Depends, HTTPException, Request

from db import db
from deps import get_current_user
from models import CheckoutRequest, OrderItem
from services import fx
from services.cart import hydrate_cart
from services.notifications import notify_order_placed
from services.payouts import create_payouts_for_order
from services.shiprocket import book_shiprocket_shipment
from services.stock import decrement_stock_for_order
from services.stripe_svc import get_stripe
from utils import cancellable_until_from, estimate_delivery_window, now_utc

logger = logging.getLogger("allsale")
router = APIRouter(tags=["checkout"])


@router.post("/checkout/session")
async def create_checkout_session(
    body: CheckoutRequest, current=Depends(get_current_user)
):
    cart = await hydrate_cart(current["id"])
    if not cart.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    order_id = f"order_{uuid.uuid4().hex[:12]}"
    order_items: list[OrderItem] = []
    for it in cart.items:
        prod = await db.products.find_one({"id": it["product_id"]}, {"_id": 0})
        order_items.append(
            OrderItem(
                product_id=it["product_id"],
                name=it["name"],
                image=it["image"],
                price_nzd=it["price_nzd"],
                quantity=it["quantity"],
                seller_id=(prod or {}).get("seller_id"),
                seller_name=(prod or {}).get("seller_name"),
                flash_sale_id=it.get("flash_sale_id"),
                original_price_nzd=it.get("original_price_nzd"),
            )
        )

    success_url = (
        f"{body.origin_url.rstrip('/')}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    )
    cancel_url = f"{body.origin_url.rstrip('/')}/checkout/cancel"

    # Resolve the buyer's currency from the user's profile (defaults to NZD).
    from config import SUPPORTED_COUNTRIES

    country = (current.get("country") or "NZ").upper()
    info = next(
        (c for c in SUPPORTED_COUNTRIES if c["code"] == country),
        SUPPORTED_COUNTRIES[0],
    )
    currency = info["currency"].lower()
    if currency == "nzd":
        charge_amount = float(cart.total_nzd)
    else:
        rates = await fx.get_rates()
        charge_amount = fx.convert(cart.total_nzd, info["currency"], rates)

    stripe = get_stripe(body.origin_url)
    session_req = CheckoutSessionRequest(
        amount=float(charge_amount),
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "order_id": order_id,
            "user_id": current["id"],
            "items_count": str(sum(it["quantity"] for it in cart.items)),
            "buyer_country": country,
            "buyer_currency": currency.upper(),
            "amount_nzd": f"{cart.total_nzd:.2f}",
        },
    )
    session = await stripe.create_checkout_session(session_req)

    order_doc = {
        "id": order_id,
        "user_id": current["id"],
        "items": [oi.model_dump() for oi in order_items],
        "subtotal_nzd": cart.subtotal_nzd,
        "shipping_nzd": cart.shipping_nzd,
        "discount_nzd": float(getattr(cart, "discount_nzd", 0.0) or 0.0),
        "total_nzd": cart.total_nzd,
        "coupon_code": getattr(cart, "coupon_code", None),
        "coupon_label": getattr(cart, "coupon_label", None),
        "points_used": int(getattr(cart, "points_used", 0) or 0),
        "points_discount_nzd": float(getattr(cart, "points_discount_nzd", 0.0) or 0.0),
        "address": body.address.model_dump(),
        "status": "pending",
        "payment_status": "initiated",
        "session_id": session.session_id,
        "buyer_country": country,
        "buyer_currency": currency.upper(),
        "charge_amount": charge_amount,
        "created_at": now_utc(),
        "estimated_delivery": estimate_delivery_window(),
    }
    await db.orders.insert_one(order_doc)
    await db.payment_transactions.insert_one(
        {
            "session_id": session.session_id,
            "order_id": order_id,
            "user_id": current["id"],
            "amount": cart.total_nzd,
            "currency": "nzd",
            "payment_status": "initiated",
            "metadata": session_req.metadata,
            "created_at": now_utc(),
        }
    )
    return {"url": session.url, "session_id": session.session_id, "order_id": order_id}


async def _on_payment_succeeded(session_id: str, user_id: str, order_id: str) -> None:
    """Common post-payment side-effects (idempotent)."""
    paid_at = now_utc()
    await db.orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "payment_status": "paid",
                "status": "paid",
                "paid_at": paid_at,
                "cancellable_until": cancellable_until_from(paid_at),
            }
        },
    )
    # Record coupon redemption (best-effort, idempotent) AFTER the order is
    # paid — never before, so we don't bump usage on abandoned carts.
    try:
        order = await db.orders.find_one(
            {"id": order_id}, {"_id": 0, "coupon_code": 1, "discount_nzd": 1, "subtotal_nzd": 1, "points_used": 1},
        )
        code = (order or {}).get("coupon_code")
        if code:
            from services.coupons import find_coupon, record_coupon_redemption

            cpn = await find_coupon(code)
            if cpn:
                await record_coupon_redemption(
                    coupon_id=cpn["id"],
                    user_id=user_id,
                    order_id=order_id,
                    discount_nzd=float(order.get("discount_nzd") or 0.0),
                )
    except Exception:
        pass

    # Award + redeem loyalty points (best-effort, both idempotent)
    try:
        from services.points import award_order_points, redeem_for_order

        order = await db.orders.find_one(
            {"id": order_id},
            {"_id": 0, "subtotal_nzd": 1, "points_used": 1, "items": 1},
        )
        if order:
            subtotal = float(order.get("subtotal_nzd") or 0.0)
            await award_order_points(user_id, order_id, subtotal)
            pts_used = int(order.get("points_used") or 0)
            if pts_used > 0:
                await redeem_for_order(user_id, order_id, pts_used)
    except Exception:
        pass

    # Increment flash-sale units_sold (idempotent per (sale_id, order_id))
    try:
        from services.flash_sales import record_units_sold
        order = order or await db.orders.find_one({"id": order_id}, {"_id": 0, "items": 1})
        if order:
            counted: dict[str, int] = {}
            for it in order.get("items", []) or []:
                sid = it.get("flash_sale_id")
                if sid:
                    counted[sid] = counted.get(sid, 0) + int(it.get("quantity", 0))
            for sid, qty in counted.items():
                await record_units_sold(sale_id=sid, order_id=order_id, qty=qty)
    except Exception:
        pass

    await create_payouts_for_order(order_id)
    await book_shiprocket_shipment(order_id)
    await notify_order_placed(order_id)
    await decrement_stock_for_order(order_id)
    await db.carts.update_one(
        {"user_id": user_id},
        {"$set": {"items": [], "updated_at": now_utc()}},
        upsert=True,
    )


@router.get("/checkout/status/{session_id}")
async def checkout_status(
    session_id: str, request: Request, current=Depends(get_current_user)
):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx or tx.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Session not found")

    origin = str(request.base_url).rstrip("/")
    stripe = get_stripe(origin)
    status_resp: CheckoutStatusResponse = await stripe.get_checkout_status(session_id)

    if tx.get("payment_status") != status_resp.payment_status:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": status_resp.payment_status, "updated_at": now_utc()}},
        )
        if status_resp.payment_status == "paid":
            await _on_payment_succeeded(session_id, current["id"], tx["order_id"])
    return {
        "session_id": session_id,
        "order_id": tx["order_id"],
        "payment_status": status_resp.payment_status,
        "status": status_resp.status,
        "amount_total": status_resp.amount_total,
        "currency": status_resp.currency,
    }


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature", "")
    origin = str(request.base_url).rstrip("/")
    stripe = get_stripe(origin)
    try:
        response = await stripe.handle_webhook(body, signature)
    except Exception as e:
        logger.warning("webhook error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    if response.payment_status == "paid" and response.session_id:
        tx = await db.payment_transactions.find_one(
            {"session_id": response.session_id}, {"_id": 0}
        )
        if tx:
            await db.payment_transactions.update_one(
                {"session_id": response.session_id},
                {"$set": {"payment_status": "paid", "updated_at": now_utc()}},
            )
            await _on_payment_succeeded(response.session_id, tx["user_id"], tx["order_id"])
    return {"received": True}
