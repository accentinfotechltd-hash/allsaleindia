"""Stripe Connect Express onboarding & payout management for Allsale sellers.

Built per the integration_playbook_expert_v2 playbook (June 16, 2026).

  POST  /api/seller/stripe/connect/onboard       — create Express account + onboarding link
  GET   /api/seller/stripe/connect/status        — connected? charges/payouts enabled? requirements
  POST  /api/seller/stripe/connect/login-link    — one-time link to the Express dashboard
  POST  /api/seller/stripe/connect/refresh       — regenerate onboarding link (link expired etc.)
  POST  /api/stripe/webhooks/connect             — webhook for account.updated etc.

Plus web-agent-friendly aliases so any URL guess the web app makes resolves:
  /seller/connect/onboard, /seller/connect/account, /payouts/stripe/onboard,
  /seller/bank/verify, /stripe/connect/account-link
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from dotenv import load_dotenv

from db import db
from deps import get_current_user, get_current_user_optional


async def require_seller(current: dict = Depends(get_current_user)) -> dict:
    """FastAPI dependency — verified seller required."""
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current

load_dotenv()
logger = logging.getLogger("allsale.stripe_connect")

# ---------------------------------------------------------------------------
# Stripe SDK init
# ---------------------------------------------------------------------------
stripe.api_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY") or ""
stripe.api_version = "2024-06-20"

CONNECT_CLIENT_ID = os.getenv("STRIPE_CONNECT_CLIENT_ID") or ""
CONNECT_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET_CONNECT") or ""
BASE_URL = (
    os.getenv("PUBLIC_SITE_URL")
    or os.getenv("RESEND_DOMAIN_URL")
    or "https://shop.allsale.co.nz"
).rstrip("/")

router = APIRouter(tags=["stripe-connect"])
webhook_router = APIRouter(tags=["stripe-connect"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _account_country(user: dict) -> str:
    """Indian sellers default to IN; allow override via user.country if set explicitly."""
    c = (user.get("seller_country") or user.get("country") or "IN").upper()
    return c if len(c) == 2 else "IN"


# ---------------------------------------------------------------------------
# Onboarding — create or reuse Express account, return account-link URL
# ---------------------------------------------------------------------------
async def _ensure_account(user: dict) -> str:
    """Idempotent: returns existing stripe_account_id or creates a new one."""
    existing = user.get("stripe_account_id")
    if existing:
        return existing
    if not stripe.api_key:
        raise HTTPException(
            status_code=500,
            detail="Stripe is not configured — backend STRIPE_SECRET_KEY missing.",
        )
    try:
        account = stripe.Account.create(
            type="express",
            country=_account_country(user),
            email=user.get("email"),
            capabilities={
                "card_payments": {"requested": True},
                "transfers": {"requested": True},
            },
            business_type=(
                "company" if user.get("seller_business_type") == "company" else "individual"
            ),
            business_profile={
                "name": user.get("seller_business_name") or user.get("full_name"),
                "product_description": "Indian seller listing on Allsale cross-border marketplace.",
                "url": BASE_URL,
            },
            metadata={
                "seller_id": str(user["id"]),
                "platform": "allsale",
            },
        )
    except stripe.error.StripeError as e:
        logger.exception("Stripe account create failed: %s", e)
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"stripe_account_id": account["id"], "stripe_account_created_at": _now()}},
    )
    logger.info("Created Stripe Express account %s for seller %s", account["id"], user["id"])
    return account["id"]


async def _build_onboarding_link(account_id: str) -> str:
    refresh_url = f"{BASE_URL}/seller/stripe/connect/refresh"
    return_url = f"{BASE_URL}/seller/stripe/connect/return"
    try:
        link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")
    return link["url"]


@router.post("/seller/stripe/connect/onboard")
@router.post("/seller/stripe/connect")           # alias
@router.post("/seller/connect/onboard")          # alias
@router.post("/payouts/stripe/onboard")          # alias
@router.post("/stripe/connect/account-link")     # alias
async def stripe_connect_onboard(user: dict = Depends(require_seller)):
    """Create (or reuse) an Express account and return the onboarding URL."""
    account_id = await _ensure_account(user)
    url = await _build_onboarding_link(account_id)
    return {"url": url, "account_id": account_id}


@router.post("/seller/stripe/connect/refresh")
async def stripe_connect_refresh(user: dict = Depends(require_seller)):
    """Regenerate an onboarding link (used when the previous one expired)."""
    account_id = await _ensure_account(user)
    url = await _build_onboarding_link(account_id)
    return {"url": url, "account_id": account_id}


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
@router.get("/seller/stripe/connect/status")
@router.get("/seller/connect/account")           # alias
@router.get("/seller/bank/verify")               # alias (legacy verb)
async def stripe_connect_status(user: dict = Depends(get_current_user)):
    """Return whether the seller's Stripe account is connected and payable."""
    account_id = user.get("stripe_account_id")
    if not account_id:
        return {
            "connected": False,
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
            "requirements": None,
            "account_id": None,
        }
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.error.InvalidRequestError:
        # Account was deleted or never existed — reset on our side.
        await db.users.update_one(
            {"id": user["id"]},
            {
                "$set": {
                    "stripe_account_id": None,
                    "stripe_charges_enabled": False,
                    "stripe_payouts_enabled": False,
                    "stripe_requirements_due": None,
                    "stripe_onboarded_at": None,
                }
            },
        )
        return {
            "connected": False,
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
            "requirements": None,
            "account_id": None,
        }
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")

    charges_enabled = bool(account.get("charges_enabled"))
    payouts_enabled = bool(account.get("payouts_enabled"))
    details_submitted = bool(account.get("details_submitted"))
    requirements = dict(account.get("requirements") or {})
    currently_due = requirements.get("currently_due") or []

    update: dict = {
        "stripe_charges_enabled": charges_enabled,
        "stripe_payouts_enabled": payouts_enabled,
        "stripe_requirements_due": currently_due,
        "stripe_details_submitted": details_submitted,
    }
    if charges_enabled and payouts_enabled and not user.get("stripe_onboarded_at"):
        update["stripe_onboarded_at"] = _now()
    await db.users.update_one({"id": user["id"]}, {"$set": update})

    return {
        "connected": True,
        "charges_enabled": charges_enabled,
        "payouts_enabled": payouts_enabled,
        "details_submitted": details_submitted,
        "requirements": requirements,
        "account_id": account_id,
    }


# ---------------------------------------------------------------------------
# Express-dashboard login link (one-time URL into the Stripe-hosted dashboard)
# ---------------------------------------------------------------------------
@router.post("/seller/stripe/connect/login-link")
@router.post("/seller/stripe/connect/dashboard")  # alias
async def stripe_connect_login_link(user: dict = Depends(require_seller)):
    account_id = user.get("stripe_account_id")
    if not account_id:
        raise HTTPException(
            status_code=400,
            detail="No connected Stripe account yet. Start onboarding first.",
        )
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    try:
        link = stripe.Account.create_login_link(account_id)
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {msg}")
    return {"url": link["url"]}


# ---------------------------------------------------------------------------
# Disconnect / detach — soft action (we forget the account, Stripe keeps it)
# ---------------------------------------------------------------------------
@router.delete("/seller/stripe/connect", status_code=204)
async def stripe_connect_disconnect(user: dict = Depends(require_seller)):
    """Forget the Stripe account on our side.

    We deliberately do NOT call `stripe.Account.delete` because:
      • Live accounts with non-zero balance can't be deleted.
      • The seller may want to reconnect later — Stripe keeps the same KYC.
    """
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "stripe_account_id": None,
                "stripe_charges_enabled": False,
                "stripe_payouts_enabled": False,
                "stripe_requirements_due": None,
                "stripe_onboarded_at": None,
                "stripe_disconnected_at": _now(),
            }
        },
    )
    return None


# ---------------------------------------------------------------------------
# Webhook handler — account.updated synchronises seller flags
# ---------------------------------------------------------------------------
@webhook_router.post("/stripe/webhooks/connect")
async def stripe_connect_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
):
    payload = await request.body()

    # If a signing secret is configured, verify; otherwise accept (dev mode)
    # but log loudly so production rollouts can't skip the check silently.
    if CONNECT_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=stripe_signature or "",
                secret=CONNECT_WEBHOOK_SECRET,
            )
        except (ValueError, stripe.error.SignatureVerificationError) as e:
            logger.warning("connect webhook signature failed: %s", e)
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        logger.warning(
            "STRIPE_WEBHOOK_SECRET_CONNECT not set — accepting webhook WITHOUT verification"
        )
        try:
            import json
            event = json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payload")

    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id:
        return {"ok": True}

    # Idempotency — skip if we already processed this event.
    already = await db.stripe_events.find_one({"event_id": event_id}, {"_id": 0, "event_id": 1})
    if already:
        return {"ok": True, "deduped": True}

    try:
        if event_type == "account.updated":
            account = event["data"]["object"]
            account_id = account.get("id")
            charges_enabled = bool(account.get("charges_enabled"))
            payouts_enabled = bool(account.get("payouts_enabled"))
            details_submitted = bool(account.get("details_submitted"))
            requirements = dict(account.get("requirements") or {})
            currently_due = requirements.get("currently_due") or []

            update: dict = {
                "stripe_charges_enabled": charges_enabled,
                "stripe_payouts_enabled": payouts_enabled,
                "stripe_requirements_due": currently_due,
                "stripe_details_submitted": details_submitted,
            }
            # Only set once.
            if charges_enabled and payouts_enabled:
                update["stripe_onboarded_at"] = _now()

            await db.users.update_one(
                {"stripe_account_id": account_id},
                {"$set": update},
            )
            logger.info(
                "account.updated → %s charges=%s payouts=%s due=%d",
                account_id, charges_enabled, payouts_enabled, len(currently_due),
            )
        elif event_type in ("account.application.deauthorized",):
            account_id = (event.get("data", {}).get("object", {}) or {}).get("id")
            if account_id:
                await db.users.update_one(
                    {"stripe_account_id": account_id},
                    {
                        "$set": {
                            "stripe_account_id": None,
                            "stripe_charges_enabled": False,
                            "stripe_payouts_enabled": False,
                            "stripe_disconnected_at": _now(),
                        }
                    },
                )
    except Exception:
        logger.exception("webhook processing failed for event %s", event_id)
        # Still mark as processed below — never let Stripe retry indefinitely
        # if our DB is broken; we'll catch missed updates via /status polling.

    await db.stripe_events.insert_one(
        {"event_id": event_id, "type": event_type, "received_at": _now()}
    )
    return {"ok": True}
