"""Stripe payment helpers — native SDK (no emergentintegrations wrapper).

Refactored June 2026 to support Stripe Connect destination charges with
tiered `application_fee_amount` so the platform can wire commissions
straight through to seller-connected accounts at charge time.

Backwards-compatible: when the cart has no Connect-onboarded seller (or has
items from multiple sellers), we fall back to the existing platform-collects
flow.  The seller's payout doc is still created with the correct tiered
commission so downstream payouts/exports keep working unchanged.
"""
from __future__ import annotations

import logging
import math
import os
from typing import Optional

import stripe as stripe_sdk
from dotenv import load_dotenv

from config import STRIPE_API_KEY
from db import db
from services.stripe_connect_svc import (
    calculate_application_fee,
    get_commission_bps_for_product,
)

load_dotenv()
logger = logging.getLogger("allsale.stripe_svc")
stripe_sdk.api_key = os.getenv("STRIPE_SECRET_KEY") or STRIPE_API_KEY

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET") or ""


# ---------------------------------------------------------------------------
# Currency / amount helpers
# ---------------------------------------------------------------------------
# All major-currency ISO codes Stripe treats as zero-decimal — we don't
# multiply by 100 for these.  (Allsale only operates in 2-decimal currencies
# today, so this is mostly defensive.)
ZERO_DECIMAL_CURRENCIES: set[str] = {
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
    "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
}


def to_minor_units(amount: float, currency: str) -> int:
    """Convert a float amount in the given currency to Stripe minor units."""
    cur = (currency or "").lower()
    if cur in ZERO_DECIMAL_CURRENCIES:
        return max(0, int(round(amount)))
    # Round half-up to be safe (Python's banker's rounding can shave a cent).
    return max(0, int(math.floor(amount * 100 + 0.5)))


# ---------------------------------------------------------------------------
# Commission planning
# ---------------------------------------------------------------------------
async def _plan_commission_for_items(
    items: list[dict],
    currency: str,
) -> dict:
    """Compute the platform commission and identify whether this cart can
    be routed via Stripe Connect (single-seller with active onboarding).

    Returns a dict shaped like::

        {
            "single_seller_id": str | None,         # set only if routable
            "seller_stripe_account_id": str | None, # set only if routable
            "application_fee_minor": int,           # 0 if not routable
            "breakdown": [                          # per-item ledger
                {
                    "product_id": str,
                    "seller_id": str,
                    "subtotal_minor": int,
                    "commission_bps": int,
                    "commission_minor": int,
                },
                ...
            ],
            "total_commission_minor": int,
        }

    The cart's `items` list is the same shape used by `services.cart` (each
    item must already carry `seller_id` and `price_<currency>`).
    """
    # 1) Bucket items by seller + collect per-item breakdown
    by_seller: dict[str, list[dict]] = {}
    breakdown: list[dict] = []
    total_commission_minor = 0

    for it in items:
        seller_id = it.get("seller_id")
        if not seller_id:
            # platform-owned (seeded catalog) — no commission
            continue
        price = float(it.get("price_nzd") or 0)
        qty = int(it.get("quantity") or 0)
        subtotal_minor = to_minor_units(price * qty, currency)
        # Resolve commission rate from the product's category/tags
        product = await db.products.find_one(
            {"id": it["product_id"]}, {"_id": 0, "category": 1, "tags": 1}
        )
        bps = get_commission_bps_for_product(product)
        fee_minor = calculate_application_fee(subtotal_minor, bps=bps)
        total_commission_minor += fee_minor
        breakdown.append(
            {
                "product_id": it["product_id"],
                "seller_id": seller_id,
                "subtotal_minor": subtotal_minor,
                "commission_bps": bps,
                "commission_minor": fee_minor,
            }
        )
        by_seller.setdefault(seller_id, []).append(it)

    # 2) Can we route via Connect?  Only if exactly ONE seller AND that
    #    seller has a fully-onboarded Connect account (charges + payouts
    #    enabled).  Anything else → platform-collects path.
    single_seller_id = None
    seller_stripe_account_id = None
    if len(by_seller) == 1:
        sid = next(iter(by_seller.keys()))
        seller = await db.users.find_one(
            {"id": sid},
            {"_id": 0, "stripe_account_id": 1, "stripe_charges_enabled": 1,
             "stripe_payouts_enabled": 1},
        ) or {}
        if (
            seller.get("stripe_account_id")
            and seller.get("stripe_charges_enabled")
            and seller.get("stripe_payouts_enabled")
        ):
            single_seller_id = sid
            seller_stripe_account_id = seller["stripe_account_id"]

    application_fee_minor = total_commission_minor if seller_stripe_account_id else 0

    return {
        "single_seller_id": single_seller_id,
        "seller_stripe_account_id": seller_stripe_account_id,
        "application_fee_minor": application_fee_minor,
        "breakdown": breakdown,
        "total_commission_minor": total_commission_minor,
    }


# ---------------------------------------------------------------------------
# Checkout Session creation (native)
# ---------------------------------------------------------------------------
async def create_checkout_session(
    *,
    amount: float,
    currency: str,
    success_url: str,
    cancel_url: str,
    metadata: dict,
    items: list[dict],
    order_id: str,
) -> dict:
    """Create a native Stripe Checkout Session, wiring Connect destination
    charges + `application_fee_amount` when the cart routes to a single
    onboarded seller.

    Returns ``{"session_id", "url", "amount_minor", "currency",
    "commission_plan"}`` — `commission_plan` is the dict from
    `_plan_commission_for_items` so the caller can persist the breakdown.
    """
    cur = (currency or "nzd").lower()
    amount_minor = to_minor_units(amount, cur)
    plan = await _plan_commission_for_items(items, cur)

    # Stripe Checkout Session needs at least one line_item.  We keep the
    # UX clean by collapsing everything into a single "Allsale order" line
    # priced at the cart total in the buyer's local currency.  Item-level
    # invoicing happens inside our own /api/orders endpoints (the order doc
    # carries the full items array).
    line_items = [
        {
            "price_data": {
                "currency": cur,
                "product_data": {
                    "name": f"Allsale order #{order_id.replace('order_', '')[:8].upper()}",
                    "description": f"{len(items)} item(s) shipped from Indian sellers",
                },
                "unit_amount": amount_minor,
            },
            "quantity": 1,
        }
    ]

    session_kwargs: dict = {
        "mode": "payment",
        "payment_method_types": ["card"],
        "line_items": line_items,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": metadata,
        "payment_intent_data": {
            "metadata": metadata,
        },
    }

    if plan["seller_stripe_account_id"] and plan["application_fee_minor"] > 0:
        session_kwargs["payment_intent_data"]["application_fee_amount"] = (
            plan["application_fee_minor"]
        )
        session_kwargs["payment_intent_data"]["transfer_data"] = {
            "destination": plan["seller_stripe_account_id"],
        }
        logger.info(
            "checkout session %s routed via Connect → seller=%s account=%s "
            "fee=%s/%s",
            order_id,
            plan["single_seller_id"],
            plan["seller_stripe_account_id"],
            plan["application_fee_minor"],
            amount_minor,
        )
    else:
        logger.info(
            "checkout session %s using platform-collects (multi-seller or "
            "no Connect) — total_commission_minor=%s",
            order_id,
            plan["total_commission_minor"],
        )

    session = stripe_sdk.checkout.Session.create(**session_kwargs)
    return {
        "session_id": session.id if not isinstance(session, dict) else session["id"],
        "url": session.url if not isinstance(session, dict) else session["url"],
        "amount_minor": amount_minor,
        "currency": cur,
        "commission_plan": plan,
    }


# ---------------------------------------------------------------------------
# Status polling
# ---------------------------------------------------------------------------
async def retrieve_checkout_status(session_id: str) -> dict:
    """Fetch a Checkout Session's current payment status (native SDK).

    Returns ``{payment_status, status, amount_total, currency,
    payment_intent_id}`` so callers can mirror state into our DB.
    """
    sess = stripe_sdk.checkout.Session.retrieve(session_id)
    get = (lambda k: sess.get(k)) if isinstance(sess, dict) else (lambda k: getattr(sess, k, None))
    return {
        "payment_status": get("payment_status") or "unpaid",
        "status": get("status"),
        "amount_total": get("amount_total"),
        "currency": get("currency"),
        "payment_intent_id": get("payment_intent"),
    }


# ---------------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------------
def verify_webhook(payload: bytes, signature: str) -> dict:
    """Validate Stripe-Signature header + return the parsed event dict.

    If `STRIPE_WEBHOOK_SECRET` is not configured we still parse the JSON
    payload so dev/test traffic keeps flowing — production deploys MUST set
    the secret in `/app/backend/.env`.
    """
    if not STRIPE_WEBHOOK_SECRET:
        logger.warning(
            "STRIPE_WEBHOOK_SECRET not set — skipping signature verification."
        )
        import json as _json
        return _json.loads(payload.decode("utf-8") or "{}")
    try:
        event = stripe_sdk.Webhook.construct_event(
            payload, signature, STRIPE_WEBHOOK_SECRET
        )
        return event if isinstance(event, dict) else event.to_dict_recursive()
    except stripe_sdk.error.SignatureVerificationError as e:
        logger.warning("Stripe webhook signature verification failed: %s", e)
        raise


# ---------------------------------------------------------------------------
# Refunds (unchanged behavior, still used by orders.py + returns.py)
# ---------------------------------------------------------------------------
async def issue_stripe_refund(order: dict) -> tuple[Optional[str], float]:
    """Issue a Stripe refund for a paid order. Returns (refund_id, amount).

    Auto-detects Connect destination charges and reverses the transfer +
    refunds the application fee so commission is clawed back from the
    seller's connected account.

    Falls back gracefully if no payment_intent / session exists (e.g. test
    fixtures) — returns (None, total_nzd) so the cancellation still proceeds.
    """
    stripe_sdk.api_key = os.getenv("STRIPE_SECRET_KEY") or STRIPE_API_KEY
    session_id = order.get("session_id")
    pi_id = order.get("stripe_payment_intent_id")
    amount = float(order.get("total_nzd", 0))

    if not (session_id or pi_id):
        return None, amount

    try:
        # Resolve PI id if we only have a session id
        if not pi_id and session_id:
            session = stripe_sdk.checkout.Session.retrieve(session_id)
            pi_id = (
                session.get("payment_intent")
                if isinstance(session, dict)
                else getattr(session, "payment_intent", None)
            )
        if not pi_id:
            return None, amount

        # Detect Connect destination charges → reverse transfer + refund fee
        was_destination_charge = False
        try:
            pi = stripe_sdk.PaymentIntent.retrieve(pi_id)
            transfer_data = (
                (pi.get("transfer_data") or {}) if isinstance(pi, dict)
                else (getattr(pi, "transfer_data", None) or {})
            )
            was_destination_charge = bool(
                transfer_data
                and (
                    transfer_data.get("destination") if isinstance(transfer_data, dict)
                    else getattr(transfer_data, "destination", None)
                )
            )
        except Exception as e:
            logger.warning("Couldn't probe PI %s for transfer_data: %s", pi_id, e)

        refund_args: dict = {"payment_intent": pi_id}
        if was_destination_charge:
            refund_args["reverse_transfer"] = True
            refund_args["refund_application_fee"] = True

        refund = stripe_sdk.Refund.create(**refund_args)
        return (
            refund.get("id") if isinstance(refund, dict) else getattr(refund, "id", None)
        ), amount
    except Exception as e:
        logger.warning("Stripe refund failed for %s: %s", order.get("id"), e)
        return None, amount


async def issue_partial_refund(
    session_id: Optional[str],
    amount_cents: int,
    *,
    payment_intent_id: Optional[str] = None,
) -> Optional[str]:
    """Issue a partial refund (used by seller-approved returns).

    Returns Stripe refund id on success, None on failure / fixtures missing.
    Reverses transfer + refunds application fee proportionally if the
    underlying charge was a Connect destination charge.
    """
    stripe_sdk.api_key = os.getenv("STRIPE_SECRET_KEY") or STRIPE_API_KEY
    if amount_cents <= 0:
        return None
    pi = payment_intent_id
    try:
        if not pi and session_id:
            session = stripe_sdk.checkout.Session.retrieve(session_id)
            pi = (
                session.get("payment_intent")
                if isinstance(session, dict)
                else getattr(session, "payment_intent", None)
            )
        if not pi:
            return None

        was_destination_charge = False
        try:
            pi_obj = stripe_sdk.PaymentIntent.retrieve(pi)
            transfer_data = (
                (pi_obj.get("transfer_data") or {}) if isinstance(pi_obj, dict)
                else (getattr(pi_obj, "transfer_data", None) or {})
            )
            was_destination_charge = bool(
                transfer_data
                and (
                    transfer_data.get("destination") if isinstance(transfer_data, dict)
                    else getattr(transfer_data, "destination", None)
                )
            )
        except Exception as e:
            logger.warning("Couldn't probe PI %s for transfer_data: %s", pi, e)

        refund_args: dict = {"payment_intent": pi, "amount": amount_cents}
        if was_destination_charge:
            refund_args["reverse_transfer"] = True
            refund_args["refund_application_fee"] = True

        refund = stripe_sdk.Refund.create(**refund_args)
        return refund.get("id") if isinstance(refund, dict) else getattr(refund, "id", None)
    except Exception as e:
        logger.warning("partial refund failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Back-compat shim: any caller doing `from services.stripe_svc import
# get_stripe` would crash now.  Provide a no-op factory that raises a
# helpful error so we catch lingering imports during testing.
# ---------------------------------------------------------------------------
def get_stripe(_origin: str = ""):  # pragma: no cover
    raise RuntimeError(
        "services.stripe_svc.get_stripe() is removed in the native-SDK "
        "refactor.  Use create_checkout_session() / retrieve_checkout_status() "
        "/ verify_webhook() instead."
    )
