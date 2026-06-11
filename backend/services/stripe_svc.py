"""Stripe payment helpers."""
from __future__ import annotations

import logging
from typing import Optional

from emergentintegrations.payments.stripe.checkout import StripeCheckout

from config import STRIPE_API_KEY

logger = logging.getLogger("allsale")


def get_stripe(request_origin: str) -> StripeCheckout:
    webhook_url = f"{request_origin.rstrip('/')}/api/webhooks/stripe"
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


async def issue_stripe_refund(order: dict) -> tuple[Optional[str], float]:
    """Issue a Stripe refund for a paid order. Returns (refund_id, amount).

    Falls back gracefully if no payment_intent / session exists (e.g. test
    fixtures) — returns (None, total_nzd) so the cancellation still proceeds.
    """
    import stripe as stripe_sdk

    stripe_sdk.api_key = STRIPE_API_KEY
    session_id = order.get("session_id")
    amount = float(order.get("total_nzd", 0))
    if not session_id:
        return None, amount
    try:
        session = stripe_sdk.checkout.Session.retrieve(session_id)
        payment_intent_id = (
            session.get("payment_intent")
            if isinstance(session, dict)
            else getattr(session, "payment_intent", None)
        )
        if not payment_intent_id:
            return None, amount
        refund = stripe_sdk.Refund.create(payment_intent=payment_intent_id)
        return (
            refund.get("id") if isinstance(refund, dict) else getattr(refund, "id", None)
        ), amount
    except Exception as e:
        logger.warning("Stripe refund failed for %s: %s", order.get("id"), e)
        return None, amount


async def issue_partial_refund(session_id: Optional[str], amount_cents: int) -> Optional[str]:
    """Issue a partial refund (used by seller-approved returns).

    Returns Stripe refund id on success, None on failure / fixtures missing.
    """
    import stripe as stripe_sdk

    stripe_sdk.api_key = STRIPE_API_KEY
    if not session_id or amount_cents <= 0:
        return None
    try:
        session = stripe_sdk.checkout.Session.retrieve(session_id)
        pi = (
            session.get("payment_intent")
            if isinstance(session, dict)
            else getattr(session, "payment_intent", None)
        )
        if not pi:
            return None
        refund = stripe_sdk.Refund.create(payment_intent=pi, amount=amount_cents)
        return refund.get("id") if isinstance(refund, dict) else getattr(refund, "id", None)
    except Exception as e:
        logger.warning("partial refund failed: %s", e)
        return None
