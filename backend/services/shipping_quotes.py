"""Shipping quote engine — India → international destinations.

Loads baked-in Shiprocket X rate slabs (extracted from the Lite-tier rate card)
and exposes a quote() function that returns 3-4 tier options per shipment.

Pricing flow:
  1. Look up the right INR rate via ceiling-weight slab match
  2. Apply FX conversion to buyer's currency (with safety buffer)
  3. Drop tiers that don't support the parcel weight
  4. Apply free-shipping threshold if order subtotal >= threshold
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

# 10% safety buffer covers daily INR/foreign-currency FX swings
FX_SAFETY_BUFFER = 0.10

# Default free-shipping threshold per region (in destination currency)
FREE_SHIPPING_THRESHOLDS = {
    "NZ": 80.0,  # NZD
    "AU": 80.0,  # AUD
    "US": 50.0,  # USD
    "GB": 45.0,  # GBP
    "CA": 70.0,  # CAD
}

# Tier metadata — kept here so we have ONE source of truth
TIER_META = {
    "economy": {
        "label": "Economy",
        "description": "Cheapest — no tracking, untracked surface mail",
        "tracking": False,
        "insurance": False,
    },
    "standard": {
        "label": "Standard",
        "description": "Recommended — tracked, best value",
        "tracking": True,
        "insurance": False,
        "recommended": True,
    },
    "express": {
        "label": "Express",
        "description": "Fastest — tracked + priority handling",
        "tracking": True,
        "insurance": True,
    },
    "heavy": {
        "label": "Air Parcel",
        "description": "For parcels above 2 kg — tracked",
        "tracking": True,
        "insurance": False,
    },
}

# Load rates once at import time
_RATES_PATH = Path(__file__).parent / "shipping_rates_nz.json"
_RATES_CACHE: dict[str, dict] = {}


def _load_rates(country: str) -> dict:
    """Load baked rates for the given country code. Currently only NZ is baked."""
    if country not in _RATES_CACHE:
        # Today we only have NZ baked. Other countries fall back to NZ rates × scaling factor
        # until full country rate cards are extracted.
        if country == "NZ":
            data = json.loads(_RATES_PATH.read_text())
        else:
            # Provisional: use NZ rates as a sane fallback (similar zone distance for AU; ~0.9× for US/UK/CA)
            data = json.loads(_RATES_PATH.read_text())
            scale = {"AU": 0.92, "US": 1.05, "GB": 1.05, "CA": 1.05}.get(country, 1.0)
            for tier in data["rates"]:
                data["rates"][tier] = {
                    w: rate * scale for w, rate in data["rates"][tier].items()
                }
        _RATES_CACHE[country] = data
    return _RATES_CACHE[country]


def _lookup_slab(rates: dict[str, float], weight_kg: float) -> Optional[float]:
    """Find the cheapest slab that covers the given weight (ceiling match).

    `rates` keys are stringified floats: {'0.05': 461, '0.1': 526, ...}
    Returns None if weight exceeds the max slab.
    """
    if weight_kg <= 0:
        return None
    # Convert keys back to floats and sort
    slabs = sorted(((float(k), v) for k, v in rates.items()), key=lambda x: x[0])
    for slab_kg, rate in slabs:
        if weight_kg <= slab_kg + 1e-6:
            return float(rate)
    return None  # Exceeds max supported weight


def quote(
    *,
    country: str,
    weight_kg: float,
    fx_rate_inr_per_unit: float,
    order_subtotal_in_currency: float = 0.0,
    free_shipping_threshold: Optional[float] = None,
) -> dict:
    """Return shipping options for a parcel.

    Args:
      country: ISO-2 destination (e.g., 'NZ')
      weight_kg: Total chargeable weight in kg
      fx_rate_inr_per_unit: How many INR == 1 unit of buyer's currency (e.g., 50.0 for NZD)
      order_subtotal_in_currency: Cart subtotal (excl. shipping) in buyer currency
      free_shipping_threshold: Override default threshold for "free standard"

    Returns:
      {
        "weight_kg": 1.2,
        "currency_code": "NZD",
        "fx_rate": 50.0,
        "free_shipping_eligible": True/False,
        "free_shipping_threshold": 80.0,
        "options": [
          {
            "tier": "economy",
            "label": "Economy",
            "description": "Cheapest — no tracking",
            "courier_id": 328,
            "courier_name": "India Post Regd. Small Packet",
            "sla": "8 - 15 Business days",
            "tracking": False,
            "rate_inr": 1015.00,
            "rate_in_currency": 22.33,
            "free": False,
          },
          ...
        ]
      }
    """
    data = _load_rates(country)
    rates_by_tier = data["rates"]
    courier_ids = data["courier_ids"]
    slas = data["slas"]
    # Courier name mapping (reverse of WANTED dict from extract script)
    courier_names = {
        "economy": "India Post Regd. Small Packet",
        "standard": "India Post Tracked Packet Service",
        "express": "India Post EMS Merchandise",
        "heavy": "India Post Air Parcel",
    }

    threshold = (
        free_shipping_threshold
        if free_shipping_threshold is not None
        else FREE_SHIPPING_THRESHOLDS.get(country, 80.0)
    )
    free_eligible = order_subtotal_in_currency >= threshold

    options = []
    for tier in ("economy", "standard", "express", "heavy"):
        if tier not in rates_by_tier:
            continue
        rate_inr = _lookup_slab(rates_by_tier[tier], weight_kg)
        if rate_inr is None:
            continue  # Tier doesn't support this weight
        # Convert INR → buyer currency, with FX safety buffer
        rate_in_currency = round(
            (rate_inr / max(fx_rate_inr_per_unit, 1e-6)) * (1.0 + FX_SAFETY_BUFFER),
            2,
        )
        is_free = free_eligible and tier == "standard"
        meta = TIER_META[tier]
        options.append(
            {
                "tier": tier,
                "label": meta["label"],
                "description": meta["description"],
                "tracking": meta["tracking"],
                "insurance": meta.get("insurance", False),
                "recommended": meta.get("recommended", False),
                "courier_id": courier_ids[tier],
                "courier_name": courier_names[tier],
                "sla": slas[tier],
                "rate_inr": round(rate_inr, 2),
                "rate_in_currency": rate_in_currency if not is_free else 0.0,
                "rate_in_currency_before_discount": rate_in_currency,
                "free": is_free,
            }
        )

    # Suppress "heavy" if cheaper standard tiers cover the weight
    if any(o["tier"] in ("economy", "standard") for o in options):
        options = [o for o in options if o["tier"] != "heavy"]

    return {
        "country": country,
        "weight_kg": weight_kg,
        "fx_rate": fx_rate_inr_per_unit,
        "free_shipping_eligible": free_eligible,
        "free_shipping_threshold": threshold,
        "options": options,
    }


def resolve_courier_id(tier: str, country: str = "NZ") -> Optional[int]:
    """Get the Shiprocket courier_id for a given tier+country (used at AWB assignment)."""
    data = _load_rates(country)
    return data["courier_ids"].get(tier)
