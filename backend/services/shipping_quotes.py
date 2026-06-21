"""Shipping quote engine — India → international destinations.

Loads baked-in Shiprocket X rate slabs (extracted from the Lite-tier rate card
for NZ) and exposes a quote() function that returns 3-4 tier options per
shipment.

Pricing flow:
  1. Look up the right INR rate via ceiling-weight slab match (NZ baseline)
  2. Apply per-country freight scaling factor (see ``COUNTRY_CONFIG``)
  3. Apply FX conversion to buyer's currency (with safety buffer)
  4. Drop tiers that don't support the parcel weight
  5. Apply free-shipping threshold if order subtotal >= threshold

Pacific tail: FJ, WS, TO and PG ship via Mumbai → NZ/Australia transhipment,
so their freight is materially more expensive AND slower than direct
India→NZ. The COUNTRY_CONFIG below captures those realities.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

# 10% safety buffer covers daily INR/foreign-currency FX swings
FX_SAFETY_BUFFER = 0.10

# Per-country freight reality.
#
# ``scale``: multiplier applied to the NZ baseline INR rate. Calibrated against
# public India Post + Aramex / DHL international parcel tariffs (Aug 2025).
#
# ``slas``: human-friendly delivery SLA by tier (used by the UI). Pacific
# countries have longer SLAs because parcels transit NZ/AU before island
# distribution.
#
# ``free_shipping_threshold``: in destination currency. Calibrated so each
# threshold lands around USD $80–$95 equivalent — Pacific freight is so high
# we lift the bar slightly to keep the unit economics workable.
COUNTRY_CONFIG: dict[str, dict] = {
    "NZ": {
        "scale": 1.00,
        "free_shipping_threshold": 80.0,  # NZD
        "slas": {
            "express": "4 - 8 Business days",
            "standard": "8 - 15 Business days",
            "economy": "8 - 15 Business days",
            "heavy": "8 - 15 Business days",
        },
    },
    "AU": {
        "scale": 0.92,
        "free_shipping_threshold": 80.0,  # AUD
        "slas": {
            "express": "4 - 8 Business days",
            "standard": "8 - 15 Business days",
            "economy": "8 - 15 Business days",
            "heavy": "8 - 15 Business days",
        },
    },
    "US": {
        "scale": 1.05,
        "free_shipping_threshold": 50.0,  # USD
        "slas": {
            "express": "5 - 10 Business days",
            "standard": "10 - 18 Business days",
            "economy": "12 - 22 Business days",
            "heavy": "10 - 18 Business days",
        },
    },
    "GB": {
        "scale": 1.05,
        "free_shipping_threshold": 45.0,  # GBP
        "slas": {
            "express": "5 - 10 Business days",
            "standard": "10 - 18 Business days",
            "economy": "12 - 22 Business days",
            "heavy": "10 - 18 Business days",
        },
    },
    "CA": {
        "scale": 1.05,
        "free_shipping_threshold": 70.0,  # CAD
        "slas": {
            "express": "5 - 10 Business days",
            "standard": "10 - 18 Business days",
            "economy": "12 - 22 Business days",
            "heavy": "10 - 18 Business days",
        },
    },
    # --- Pacific tail -------------------------------------------------------
    # All Pacific routes hop through NZ (or AU for PG) before local island
    # distribution. Express tier is **disabled** for FJ/WS/TO/PG because
    # India Post EMS Merchandise doesn't run direct services to these
    # destinations — express requests would fall through to standard anyway.
    "FJ": {
        "scale": 1.35,
        "free_shipping_threshold": 180.0,  # FJD (≈ USD $80)
        "drop_tiers": ("express",),
        "slas": {
            "express": "10 - 18 Business days",
            "standard": "14 - 25 Business days",
            "economy": "18 - 32 Business days",
            "heavy": "14 - 25 Business days",
        },
    },
    "PG": {
        "scale": 1.50,
        "free_shipping_threshold": 280.0,  # PGK (≈ USD $75)
        "drop_tiers": ("express",),
        "slas": {
            "express": "12 - 20 Business days",
            "standard": "18 - 30 Business days",
            "economy": "22 - 38 Business days",
            "heavy": "18 - 30 Business days",
        },
    },
    "WS": {
        "scale": 1.55,
        "free_shipping_threshold": 220.0,  # WST (≈ USD $80)
        "drop_tiers": ("express",),
        "slas": {
            "express": "14 - 22 Business days",
            "standard": "18 - 30 Business days",
            "economy": "25 - 40 Business days",
            "heavy": "18 - 30 Business days",
        },
    },
    "TO": {
        "scale": 1.65,
        "free_shipping_threshold": 190.0,  # TOP (≈ USD $80)
        "drop_tiers": ("express",),
        "slas": {
            "express": "14 - 22 Business days",
            "standard": "18 - 32 Business days",
            "economy": "25 - 42 Business days",
            "heavy": "18 - 32 Business days",
        },
    },
}

# Default config used when an unknown country code is requested (treat as NZ).
_DEFAULT_CONFIG = COUNTRY_CONFIG["NZ"]

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

# Load NZ baseline rates once at import time
_RATES_PATH = Path(__file__).parent / "shipping_rates_nz.json"
_NZ_RATES: Optional[dict] = None


def _get_country_config(country: str) -> dict:
    return COUNTRY_CONFIG.get(country, _DEFAULT_CONFIG)


def _load_nz_baseline() -> dict:
    """Load and cache the NZ Shiprocket rate card (the baseline)."""
    global _NZ_RATES
    if _NZ_RATES is None:
        _NZ_RATES = json.loads(_RATES_PATH.read_text())
    return _NZ_RATES


def _lookup_slab(rates: dict[str, float], weight_kg: float) -> Optional[float]:
    """Find the cheapest slab that covers the given weight (ceiling match).

    `rates` keys are stringified floats: {'0.05': 461, '0.1': 526, ...}
    Returns None if weight exceeds the max slab.
    """
    if weight_kg <= 0:
        return None
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
      country: ISO-2 destination (e.g., 'NZ', 'FJ', 'PG').
      weight_kg: Total chargeable weight in kg.
      fx_rate_inr_per_unit: How many INR = 1 unit of buyer's currency
        (e.g., 50.0 means 1 NZD = 50 INR).
      order_subtotal_in_currency: Cart subtotal (excl. shipping) in buyer
        currency.
      free_shipping_threshold: Override per-country default threshold.

    Returns:
      A dict containing the resolved country, weight, FX rate, free-shipping
      info, and a list of tier ``options`` ready for the checkout UI.
    """
    country = country.upper()
    cfg = _get_country_config(country)
    nz_baseline = _load_nz_baseline()
    rates_by_tier_nz = nz_baseline["rates"]
    courier_ids = nz_baseline["courier_ids"]
    scale = cfg["scale"]
    slas = cfg["slas"]
    drop_tiers = set(cfg.get("drop_tiers", ()))

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
        else cfg["free_shipping_threshold"]
    )
    free_eligible = order_subtotal_in_currency >= threshold

    options = []
    for tier in ("economy", "standard", "express", "heavy"):
        if tier in drop_tiers:
            continue  # Pacific routes don't have an express option
        if tier not in rates_by_tier_nz:
            continue
        nz_rate_inr = _lookup_slab(rates_by_tier_nz[tier], weight_kg)
        if nz_rate_inr is None:
            continue  # Tier doesn't support this weight
        # Scale to country, then convert INR → buyer currency w/ FX safety
        rate_inr = nz_rate_inr * scale
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
    """Get the Shiprocket courier_id for a given tier+country.

    For Pacific routes we deliberately drop express, so callers should fall
    back to ``standard`` if this returns ``None``.
    """
    cfg = _get_country_config(country.upper())
    if tier in cfg.get("drop_tiers", ()):
        return None
    nz_baseline = _load_nz_baseline()
    return nz_baseline["courier_ids"].get(tier)


# Back-compat shim — older callers still import FREE_SHIPPING_THRESHOLDS.
FREE_SHIPPING_THRESHOLDS = {
    code: cfg["free_shipping_threshold"] for code, cfg in COUNTRY_CONFIG.items()
}
