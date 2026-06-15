"""Shipping quote endpoints — buyer-facing rate selector at checkout."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.shipping_quotes import quote as quote_engine
from services import fx as fx_svc  # existing FX service

router = APIRouter(prefix="/shipping", tags=["shipping"])


@router.get("/quote")
async def get_shipping_quote(
    country: str = Query("NZ", min_length=2, max_length=2, description="ISO-2 destination"),
    weight_kg: float = Query(..., gt=0.0, le=30.0, description="Chargeable weight in kg"),
    currency: str = Query("NZD", min_length=3, max_length=3, description="Buyer currency ISO-4217"),
    subtotal: float = Query(0.0, ge=0.0, description="Cart subtotal in buyer currency"),
):
    """Return 2–3 shipping options for a parcel, priced in buyer's currency.

    Frontend renders these as cards at checkout. The chosen tier is later passed
    back to /orders/create which forwards `courier_id` to Shiprocket on shipment.
    """
    country = country.upper()
    currency = currency.upper()

    # Resolve FX: 1 unit of `currency` = how many INR?
    # Our fx service returns rates relative to NZD as base. We need INR-per-buyer-currency.
    try:
        fx_per_buyer_currency = await _get_inr_per_unit(currency)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Could not fetch FX rate: {e}")

    return quote_engine(
        country=country,
        weight_kg=weight_kg,
        fx_rate_inr_per_unit=fx_per_buyer_currency,
        order_subtotal_in_currency=subtotal,
    )


async def _get_inr_per_unit(currency: str) -> float:
    """Return INR per 1 unit of the given currency."""
    # Static fallback rates if FX service unavailable
    FALLBACK_INR = {
        "NZD": 50.0,
        "AUD": 56.0,
        "USD": 83.5,
        "GBP": 105.0,
        "CAD": 60.0,
        "INR": 1.0,
    }
    try:
        # Try to use the existing FX service if it exposes INR rates
        if hasattr(fx_svc, "get_inr_per_unit"):
            rate = await fx_svc.get_inr_per_unit(currency)
            if rate and rate > 0:
                return rate
    except Exception:
        pass
    return FALLBACK_INR.get(currency.upper(), 50.0)
