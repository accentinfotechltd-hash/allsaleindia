"""Allsale Pro — optional premium seller subscription via Stripe Subscriptions.

  POST   /api/seller/pro/checkout    → returns hosted Stripe Checkout URL
  GET    /api/seller/pro/status      → {active, plan, current_period_end, will_cancel}
  POST   /api/seller/pro/cancel      → cancel at period end
  POST   /api/stripe/webhooks/pro    → invoice.paid / subscription.updated / deleted

Pricing (configurable via env):
  ALLSALE_PRO_PRICE_ID  Stripe Price (recurring) — required to enable subscriptions
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from db import db
from deps import get_current_user

logger = logging.getLogger("allsale.pro")
router = APIRouter(tags=["allsale-pro"])
webhook_router = APIRouter(tags=["allsale-pro"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY") or ""
PRO_PRICE_ID = os.getenv("ALLSALE_PRO_PRICE_ID")
PRO_WEBHOOK_SECRET = os.getenv("ALLSALE_PRO_WEBHOOK_SECRET") or os.getenv(
    "STRIPE_WEBHOOK_SECRET"
)
BASE_URL = (
    os.getenv("PUBLIC_SITE_URL") or "https://shop.allsale.co.nz"
).rstrip("/")


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _ensure_stripe_customer(user: dict) -> str:
    """Idempotent — returns the seller's Stripe Customer id."""
    cust_id = user.get("stripe_customer_id")
    if cust_id:
        return cust_id
    cust = stripe.Customer.create(
        email=user.get("email"),
        name=user.get("full_name"),
        metadata={"user_id": str(user["id"]), "platform": "allsale"},
    )
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"stripe_customer_id": cust["id"]}}
    )
    return cust["id"]


# ---------------------------------------------------------------------------
# POST /api/seller/pro/checkout
# ---------------------------------------------------------------------------
@router.post("/seller/pro/checkout")
async def pro_checkout(user: dict = Depends(get_current_user)):
    if not PRO_PRICE_ID:
        raise HTTPException(
            status_code=503,
            detail="Allsale Pro is not configured yet (ALLSALE_PRO_PRICE_ID missing).",
        )
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    cust_id = await _ensure_stripe_customer(user)
    try:
        session = stripe.checkout.Session.create(
            customer=cust_id,
            mode="subscription",
            line_items=[{"price": PRO_PRICE_ID, "quantity": 1}],
            success_url=f"{BASE_URL}/seller/pro/return?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{BASE_URL}/seller/pro?cancelled=1",
            metadata={"user_id": str(user["id"]), "product": "allsale_pro"},
            subscription_data={"metadata": {"user_id": str(user["id"])}},
            allow_promotion_codes=True,
        )
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")
    return {"url": session["url"], "session_id": session["id"]}


# ---------------------------------------------------------------------------
# GET /api/seller/pro/status
# ---------------------------------------------------------------------------
@router.get("/seller/pro/status")
async def pro_status(user: dict = Depends(get_current_user)):
    sub_id = user.get("allsale_pro_subscription_id")
    if not sub_id or not stripe.api_key:
        return {
            "active": False,
            "plan": None,
            "current_period_end": None,
            "will_cancel": False,
            "price_id_configured": bool(PRO_PRICE_ID),
        }
    try:
        sub = stripe.Subscription.retrieve(sub_id)
    except stripe.error.StripeError:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"allsale_pro_subscription_id": None, "allsale_pro_active": False}},
        )
        return {
            "active": False,
            "plan": None,
            "current_period_end": None,
            "will_cancel": False,
            "price_id_configured": bool(PRO_PRICE_ID),
        }
    status = sub.get("status") if isinstance(sub, dict) else getattr(sub, "status", None)
    active = status in ("active", "trialing")
    cpe = sub.get("current_period_end") if isinstance(sub, dict) else getattr(sub, "current_period_end", None)
    will_cancel = bool(sub.get("cancel_at_period_end") if isinstance(sub, dict) else getattr(sub, "cancel_at_period_end", False))
    return {
        "active": active,
        "status": status,
        "plan": "allsale_pro",
        "current_period_end": cpe,
        "will_cancel": will_cancel,
        "price_id_configured": bool(PRO_PRICE_ID),
    }


# ---------------------------------------------------------------------------
# POST /api/seller/pro/cancel  (at period end — keeps benefits until then)
# ---------------------------------------------------------------------------
@router.post("/seller/pro/cancel")
async def pro_cancel(user: dict = Depends(get_current_user)):
    sub_id = user.get("allsale_pro_subscription_id")
    if not sub_id:
        raise HTTPException(status_code=400, detail="No active Pro subscription")
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    try:
        sub = stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")
    return {
        "will_cancel": True,
        "current_period_end": sub.get("current_period_end") if isinstance(sub, dict) else getattr(sub, "current_period_end", None),
    }


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------
@webhook_router.post("/stripe/webhooks/pro")
async def pro_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
):
    payload = await request.body()
    if PRO_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=stripe_signature or "",
                secret=PRO_WEBHOOK_SECRET,
            )
        except (ValueError, stripe.error.SignatureVerificationError):
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        import json as _json
        try:
            event = _json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payload")

    event_id = event.get("id")
    event_type = event.get("type")
    if event_id:
        already = await db.stripe_events.find_one({"event_id": event_id}, {"_id": 0})
        if already:
            return {"ok": True, "deduped": True}

    obj = (event.get("data") or {}).get("object") or {}
    user_id = (obj.get("metadata") or {}).get("user_id")
    sub_id = obj.get("subscription") or obj.get("id")

    try:
        if event_type == "checkout.session.completed" and obj.get("mode") == "subscription":
            if user_id and obj.get("subscription"):
                await db.users.update_one(
                    {"id": user_id},
                    {"$set": {
                        "allsale_pro_subscription_id": obj["subscription"],
                        "allsale_pro_active": True,
                        "allsale_pro_started_at": _now(),
                    }},
                )
        elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
            status = obj.get("status")
            active = status in ("active", "trialing")
            await db.users.update_one(
                {"allsale_pro_subscription_id": obj.get("id")},
                {"$set": {
                    "allsale_pro_active": active,
                    "allsale_pro_status": status,
                    "allsale_pro_will_cancel": bool(obj.get("cancel_at_period_end")),
                }},
            )
        elif event_type == "customer.subscription.deleted":
            await db.users.update_one(
                {"allsale_pro_subscription_id": obj.get("id")},
                {"$set": {
                    "allsale_pro_active": False,
                    "allsale_pro_subscription_id": None,
                    "allsale_pro_cancelled_at": _now(),
                }},
            )
    except Exception:
        logger.exception("pro webhook handler failed for event %s", event_id)

    if event_id:
        await db.stripe_events.insert_one(
            {"event_id": event_id, "type": event_type, "received_at": _now()}
        )
    return {"ok": True}
