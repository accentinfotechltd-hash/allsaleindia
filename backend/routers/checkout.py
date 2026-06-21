"""Stripe checkout session creation, polling and webhook.

Native Stripe SDK as of June 2026 (was emergentintegrations).  Adds
Stripe Connect destination-charge support with tiered application_fee_amount
when the cart routes to a single Connect-onboarded seller; falls back to
platform-collects + a stored commission_breakdown for multi-seller carts.
"""
from __future__ import annotations

import logging
import uuid

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
from services.stripe_svc import (
    create_checkout_session,
    retrieve_checkout_status,
    verify_webhook,
)
from utils import cancellable_until_from, estimate_delivery_window, now_utc

logger = logging.getLogger("allsale")
router = APIRouter(tags=["checkout"])


@router.post("/checkout/session")
async def create_checkout_session_route(
    body: CheckoutRequest, current=Depends(get_current_user)
):
    # Use the shipping address country (more accurate than user profile)
    # so tax matches the actual destination.
    delivery_country = (body.address.country or current.get("country") or "NZ").upper()
    cart = await hydrate_cart(current["id"], country=delivery_country)
    if not cart.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    # Apply 3-tier shipping override if provided
    if body.shipping_cost_nzd is not None and body.shipping_cost_nzd >= 0:
        cart.shipping_nzd = float(body.shipping_cost_nzd)
        cart.total_nzd = (
            float(cart.subtotal_nzd)
            + float(cart.shipping_nzd)
            - float(getattr(cart, "discount_nzd", 0.0) or 0.0)
            - float(getattr(cart, "points_discount_nzd", 0.0) or 0.0)
        )

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

    metadata = {
        "order_id": order_id,
        "user_id": current["id"],
        "items_count": str(sum(it["quantity"] for it in cart.items)),
        "buyer_country": country,
        "buyer_currency": currency.upper(),
        "amount_nzd": f"{cart.total_nzd:.2f}",
    }
    session = await create_checkout_session(
        amount=float(charge_amount),
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
        metadata=metadata,
        items=cart.items,
        order_id=order_id,
    )
    plan = session["commission_plan"]

    order_doc = {
        "id": order_id,
        "user_id": current["id"],
        "items": [oi.model_dump() for oi in order_items],
        "subtotal_nzd": cart.subtotal_nzd,
        "shipping_nzd": cart.shipping_nzd,
        "discount_nzd": float(getattr(cart, "discount_nzd", 0.0) or 0.0),
        # Tax / customs duty (per destination jurisdiction)
        "tax_nzd": float(getattr(cart, "tax_nzd", 0.0) or 0.0),
        "tax_rate": float(getattr(cart, "tax_rate", 0.0) or 0.0),
        "tax_country": getattr(cart, "tax_country", None),
        "tax_label_key": getattr(cart, "tax_label_key", None),
        "tax_threshold_nzd": float(getattr(cart, "tax_threshold_nzd", 0.0) or 0.0),
        "tax_over_threshold": bool(getattr(cart, "tax_over_threshold", False)),
        "tax_at_border": bool(getattr(cart, "tax_at_border", False)),
        "tax_inclusive": bool(getattr(cart, "tax_inclusive", False)),
        "total_nzd": cart.total_nzd,
        "coupon_code": getattr(cart, "coupon_code", None),
        "coupon_label": getattr(cart, "coupon_label", None),
        "points_used": int(getattr(cart, "points_used", 0) or 0),
        "points_discount_nzd": float(getattr(cart, "points_discount_nzd", 0.0) or 0.0),
        "address": body.address.model_dump(),
        "shipping_tier": body.shipping_tier,
        "shipping_courier_id": body.shipping_courier_id,
        "shipping_courier_name": body.shipping_courier_name,
        "status": "pending",
        "payment_status": "initiated",
        "session_id": session["session_id"],
        "buyer_country": country,
        "buyer_currency": currency.upper(),
        "charge_amount": charge_amount,
        # Stripe Connect commission ledger (June 2026 — Task A)
        "commission_breakdown": plan["breakdown"],
        "commission_total_minor": plan["total_commission_minor"],
        "connect_routed": bool(plan["seller_stripe_account_id"]),
        "connect_seller_id": plan["single_seller_id"],
        "connect_destination_account": plan["seller_stripe_account_id"],
        "application_fee_minor": plan["application_fee_minor"],
        "created_at": now_utc(),
        "estimated_delivery": estimate_delivery_window(),
    }
    await db.orders.insert_one(order_doc)
    await db.payment_transactions.insert_one(
        {
            "session_id": session["session_id"],
            "order_id": order_id,
            "user_id": current["id"],
            "amount": cart.total_nzd,
            "currency": currency,
            "payment_status": "initiated",
            "metadata": metadata,
            "created_at": now_utc(),
        }
    )
    return {"url": session["url"], "session_id": session["session_id"], "order_id": order_id}


async def _on_payment_succeeded(
    session_id: str,
    user_id: str,
    order_id: str,
    payment_intent_id: str | None = None,
) -> None:
    """Common post-payment side-effects (idempotent)."""
    paid_at = now_utc()
    set_doc: dict = {
        "payment_status": "paid",
        "status": "paid",
        "paid_at": paid_at,
        "cancellable_until": cancellable_until_from(paid_at),
    }
    if payment_intent_id:
        set_doc["stripe_payment_intent_id"] = payment_intent_id
    await db.orders.update_one({"id": order_id}, {"$set": set_doc})
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

    # Best-effort order confirmation email
    try:
        from services.email import send_email

        order = await db.orders.find_one({"id": order_id}, {"_id": 0})
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "full_name": 1})
        if order and user and user.get("email"):
            short = order_id.replace("order_", "")[:8].upper()
            items_html = "".join(
                f"<li>{i.get('quantity', 1)} × {i.get('product_name', 'item')} — "
                f"NZD {float(i.get('price_nzd') or 0):.2f}</li>"
                for i in (order.get("items") or [])
            )
            send_email(
                user["email"],
                f"Order #{short} confirmed — Allsale",
                f"""<div style='font-family:system-ui,sans-serif;padding:24px;background:#f8fafc;color:#0f172a'>
                <h1 style='color:#7c3aed;margin:0 0 8px'>Order confirmed!</h1>
                <p>Hi {user.get('full_name') or 'there'}, thanks for your order.</p>
                <p><strong>Order #:</strong> {short}<br>
                <strong>Total:</strong> NZD {float(order.get('total_nzd') or 0):.2f}</p>
                <h3>Items</h3><ul>{items_html}</ul>
                <p>We'll email you again once your seller dispatches it. Track at any time inside the app.</p>
                <p style='color:#64748b;font-size:12px;margin-top:24px'>Allsale — Indian Bazaar</p></div>""",
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

    # Referral reward: unlock referrer's +250 pts on referee's first paid order
    try:
        from services.referrals import maybe_unlock_referrer_reward
        await maybe_unlock_referrer_reward(user_id, order_id)
    except Exception:
        pass

    # Ambassador attribution — credit pending commission if this order was
    # placed with an ambassador-issued coupon. Idempotent; safe to call
    # from both the polling path and the webhook path.
    try:
        from services.ambassador_attribution import credit_pending_for_order
        await credit_pending_for_order(order_id)
    except Exception:
        logger.exception("ambassador attribution failed for order %s", order_id)

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

    status_resp = await retrieve_checkout_status(session_id)

    if tx.get("payment_status") != status_resp["payment_status"]:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": status_resp["payment_status"], "updated_at": now_utc()}},
        )
        if status_resp["payment_status"] == "paid":
            await _on_payment_succeeded(
                session_id,
                current["id"],
                tx["order_id"],
                payment_intent_id=status_resp.get("payment_intent_id"),
            )
    return {
        "session_id": session_id,
        "order_id": tx["order_id"],
        "payment_status": status_resp["payment_status"],
        "status": status_resp["status"],
        "amount_total": status_resp["amount_total"],
        "currency": status_resp["currency"],
    }


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature", "")
    try:
        event = verify_webhook(body, signature)
    except Exception as e:
        logger.warning("webhook signature error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    event_id = event.get("id")
    event_type = event.get("type", "")

    # Idempotency: bail out if we've already processed this event
    if event_id:
        seen = await db.stripe_events.find_one({"_id": event_id}, {"_id": 1})
        if seen:
            return {"received": True, "idempotent": True}
        try:
            await db.stripe_events.insert_one(
                {"_id": event_id, "type": event_type, "received_at": now_utc()}
            )
        except Exception:
            pass  # duplicate insert under race — safe to ignore

    if event_type == "checkout.session.completed":
        session_obj = (event.get("data") or {}).get("object") or {}
        session_id = session_obj.get("id")
        payment_intent_id = session_obj.get("payment_intent")
        payment_status = session_obj.get("payment_status") or "paid"
        if session_id and payment_status == "paid":
            tx = await db.payment_transactions.find_one(
                {"session_id": session_id}, {"_id": 0}
            )
            if tx:
                await db.payment_transactions.update_one(
                    {"session_id": session_id},
                    {"$set": {"payment_status": "paid", "updated_at": now_utc()}},
                )
                await _on_payment_succeeded(
                    session_id,
                    tx["user_id"],
                    tx["order_id"],
                    payment_intent_id=payment_intent_id,
                )
    return {"received": True}
