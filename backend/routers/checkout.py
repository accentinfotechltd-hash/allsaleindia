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
            )
        )

    success_url = (
        f"{body.origin_url.rstrip('/')}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    )
    cancel_url = f"{body.origin_url.rstrip('/')}/checkout/cancel"

    stripe = get_stripe(body.origin_url)
    session_req = CheckoutSessionRequest(
        amount=float(cart.total_nzd),
        currency="nzd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "order_id": order_id,
            "user_id": current["id"],
            "items_count": str(sum(it["quantity"] for it in cart.items)),
        },
    )
    session = await stripe.create_checkout_session(session_req)

    order_doc = {
        "id": order_id,
        "user_id": current["id"],
        "items": [oi.model_dump() for oi in order_items],
        "subtotal_nzd": cart.subtotal_nzd,
        "shipping_nzd": cart.shipping_nzd,
        "total_nzd": cart.total_nzd,
        "address": body.address.model_dump(),
        "status": "pending",
        "payment_status": "initiated",
        "session_id": session.session_id,
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
