"""Stripe Connect marketplace helpers — destination charges + reverse transfers.

These wrap the bare Stripe SDK so the rest of the codebase can stay agnostic
to whether a particular order is Connect-routed (seller has stripe_account_id)
or plain platform charges (legacy/non-Connect sellers).

Tiered commission (June 16, 2026):
The platform commission varies by product category so we charge less on
low-margin commodities (electronics) and more on high-margin luxuries
(jewellery), mirroring Amazon's headline rates while staying meaningfully
cheaper across the board.
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

DEFAULT_COMMISSION_BPS = 1200  # 12.00%

# Tiered commission — basis points (1 bp = 0.01%).  Match Amazon's
# category-by-category headline rates while staying cheaper across the board.
CATEGORY_COMMISSION_BPS: dict[str, int] = {
    # Low-margin commodities → match Amazon's 8% to stay price-competitive
    "electronics": 800, "computers": 800, "phones": 800, "mobile": 800,
    # Mid-tier (12%, our standard)
    "books": 1200, "stationery": 1200, "home": 1200, "furniture": 1200,
    "kitchen": 1200, "decor": 1200, "apparel": 1200, "clothing": 1200,
    "fashion": 1200, "accessories": 1200, "beauty": 1200,
    "personal-care": 1200, "personal_care": 1200, "grocery": 1200,
    "food": 1200, "toys": 1200, "sports": 1200, "garden": 1200, "pets": 1200,
    # Higher-margin luxuries (15%, still 5pp below Amazon's 20%)
    "jewellery": 1500, "jewelry": 1500, "watches": 1500, "luxury": 1500,
    "art": 1500, "handicraft": 1500, "handicrafts": 1500,
    "antique": 1500, "antiques": 1500,
}

# Back-compat for any old call sites that referenced the flat rate constant.
PLATFORM_COMMISSION_BPS = DEFAULT_COMMISSION_BPS


def _norm(s: str) -> str:
    return (s or "").strip().lower().replace(" ", "-").replace("_", "-")


def get_commission_bps_for_product(product: Optional[dict]) -> int:
    """Resolve the platform commission rate (in basis points) for a product.

    Looks at `product.category` first, then `product.tags`; first hit wins,
    falling back to `DEFAULT_COMMISSION_BPS`.  Slug-normalises lookup keys so
    "Jewellery", "Jewelry", and "jewellery" all hit the same bucket.
    """
    if not product:
        return DEFAULT_COMMISSION_BPS
    cat = _norm(product.get("category") or "")
    if cat:
        bps = CATEGORY_COMMISSION_BPS.get(cat) or CATEGORY_COMMISSION_BPS.get(
            cat.replace("-", "_")
        )
        if bps:
            return bps
    for tag in product.get("tags") or []:
        bps = CATEGORY_COMMISSION_BPS.get(_norm(tag))
        if bps:
            return bps
    return DEFAULT_COMMISSION_BPS


def calculate_application_fee(
    subtotal_in_cents: int,
    *,
    bps: Optional[int] = None,
    product: Optional[dict] = None,
) -> int:
    """Return the platform commission for a given product subtotal.

    Pass `bps` for an explicit rate, `product` to derive from the category
    tier, or neither to get the flat 12% default.  Rounds down so we never
    overcharge a seller by a sub-cent.
    """
    if subtotal_in_cents <= 0:
        return 0
    rate_bps = bps if bps is not None else get_commission_bps_for_product(product)
    return math.floor(subtotal_in_cents * rate_bps / 10_000)


def connect_payment_intent_params(
    seller: dict,
    total_in_cents: int,
    product_subtotal_in_cents: Optional[int] = None,
    product: Optional[dict] = None,
) -> dict:
    """Return the extra kwargs to merge into `stripe.PaymentIntent.create(...)`.

    Empty when the seller is NOT a fully-onboarded Connect account, so the
    existing platform-collects flow keeps working untouched.
    """
    account_id = seller.get("stripe_account_id")
    if not account_id:
        return {}
    if not (seller.get("stripe_charges_enabled") and seller.get("stripe_payouts_enabled")):
        return {}
    subtotal = (
        product_subtotal_in_cents if product_subtotal_in_cents is not None else total_in_cents
    )
    fee = calculate_application_fee(subtotal, product=product)
    return {
        "application_fee_amount": fee,
        "transfer_data": {"destination": account_id},
    }


async def refund_for_order(
    order_id: str, amount_in_cents: Optional[int] = None
) -> dict:
    """Issue a refund, auto-handling Connect vs platform-only orders."""
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

    was_destination_charge = False
    try:
        if pi_id:
            pi = stripe.PaymentIntent.retrieve(pi_id)
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
