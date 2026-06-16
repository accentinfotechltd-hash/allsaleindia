"""Stripe Connect marketplace helpers — destination charges + reverse transfers.

These wrap the bare Stripe SDK so the rest of the codebase can stay agnostic
to whether a particular order is Connect-routed (seller has stripe_account_id)
or plain platform charges (legacy/non-Connect sellers).

Usage from `routers/checkout.py` once it migrates off `emergentintegrations`:

    from services.stripe_connect_svc import (
        connect_payment_intent_params, refund_for_order
    )

    # Charge time — only wire Connect params if the seller is fully onboarded.
    extra = connect_payment_intent_params(
        seller=seller, total_in_cents=total_in_cents
    )
    intent = stripe.PaymentIntent.create(
        amount=total_in_cents, currency="nzd",
        **base_params, **extra,
    )

    # Refund time — automatically reverses the transfer if the original payment
    # was a destination charge; falls back to a plain refund otherwise.
    refund = await refund_for_order(order_id=order["id"])
"""
from __future__ import annotations

import logging
import math
import os
from typing import Optional

import stripe
from dotenv import load_dotenv

from db import db

load_dotenv()
logger = logging.getLogger("allsale.stripe_connect_svc")
stripe.api_key = os.getenv("STRIPE_SECRET_KEY") or os.getenv("STRIPE_API_KEY") or ""

# Allsale's marketplace commission — kept here so it's easy to tune later
# without hunting through checkout code.  Apply only to the product subtotal,
# never to shipping costs (we pass those through 1:1 to Shiprocket).
PLATFORM_COMMISSION_BPS = 1200  # 12.00% in basis points


def calculate_application_fee(subtotal_in_cents: int) -> int:
    """Return the platform commission for a given product subtotal.

    Rounds down (floor) so we never overcharge a seller by a sub-cent.
    """
    if subtotal_in_cents <= 0:
        return 0
    return math.floor(subtotal_in_cents * PLATFORM_COMMISSION_BPS / 10_000)


def connect_payment_intent_params(
    seller: dict, total_in_cents: int, product_subtotal_in_cents: Optional[int] = None
) -> dict:
    """Return the extra kwargs to merge into `stripe.PaymentIntent.create(...)`.

    Returns `{}` when the seller is NOT a fully-onboarded Connect account —
    the caller's existing flow (platform-collects-then-pays-out-manually) keeps
    working untouched.

    When the seller IS onboarded:
        application_fee_amount   = 12% of product subtotal
        transfer_data.destination = seller's Stripe Express acct_…
    """
    account_id = seller.get("stripe_account_id")
    if not account_id:
        return {}
    if not (seller.get("stripe_charges_enabled") and seller.get("stripe_payouts_enabled")):
        # Onboarding incomplete — keep money on the platform until they finish.
        return {}

    subtotal = product_subtotal_in_cents if product_subtotal_in_cents is not None else total_in_cents
    fee = calculate_application_fee(subtotal)
    return {
        "application_fee_amount": fee,
        "transfer_data": {"destination": account_id},
    }


async def refund_for_order(
    order_id: str, amount_in_cents: Optional[int] = None
) -> dict:
    """Issue a refund for an Allsale order, handling both Connect and non-Connect cases.

    * If the original PaymentIntent had a `transfer_data.destination` (i.e. was
      a destination charge), Stripe will reverse the transfer so the seller's
      payout is clawed back proportionally.
    * If the order used the legacy non-Connect flow, falls back to a plain
      refund on the platform account.

    Looks up the Stripe charge/PI id off the `orders` collection.  Returns the
    Stripe Refund object as a dict.
    """
    order = await db.orders.find_one(
        {"id": order_id},
        {"_id": 0, "stripe_payment_intent_id": 1, "stripe_charge_id": 1, "total_cents": 1},
    )
    if not order:
        raise ValueError(f"Order not found: {order_id}")

    pi_id = order.get("stripe_payment_intent_id")
    charge_id = order.get("stripe_charge_id")
    if not (pi_id or charge_id):
        raise ValueError("Order has no Stripe payment recorded")

    refund_args: dict = {}
    if charge_id:
        refund_args["charge"] = charge_id
    else:
        refund_args["payment_intent"] = pi_id
    if amount_in_cents is not None:
        refund_args["amount"] = amount_in_cents

    # Decide whether this is a Connect destination charge by probing the PI.
    was_destination_charge = False
    try:
        if pi_id:
            pi = stripe.PaymentIntent.retrieve(pi_id)
            transfer_data = (pi.get("transfer_data") or {}) if isinstance(pi, dict) else (getattr(pi, "transfer_data", None) or {})
            was_destination_charge = bool(transfer_data and (transfer_data.get("destination") if isinstance(transfer_data, dict) else getattr(transfer_data, "destination", None)))
    except Exception as e:
        logger.warning("Couldn't probe PI %s for transfer_data: %s", pi_id, e)

    if was_destination_charge:
        refund_args["reverse_transfer"] = True
        refund_args["refund_application_fee"] = True

    try:
        refund = stripe.Refund.create(**refund_args)
    except stripe.error.StripeError as e:
        msg = getattr(e, "user_message", None) or str(e)
        logger.exception("Refund create failed: %s", msg)
        raise

    logger.info(
        "Refund %s for order=%s amount=%s reverse_transfer=%s",
        refund.get("id"), order_id, refund.get("amount"), was_destination_charge,
    )
    return refund if isinstance(refund, dict) else refund.to_dict_recursive()
