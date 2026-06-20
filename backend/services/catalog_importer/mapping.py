"""Category mapping + currency + small utility helpers shared by parsers."""
from __future__ import annotations

import re
from typing import Optional, Tuple


# Amazon "product_type" → Allsale category. Conservative — anything we
# don't know stays as "raw_category_label" on the parsed row so the seller
# can pick from a dropdown.
AMAZON_PT_TO_ALLSALE: dict[str, Tuple[str, Optional[str]]] = {
    # Beauty & personal care
    "HAIR_CLEANING_CONDITIONING_AGENT": ("Beauty & Health", "Hair Care"),
    "HAIR_CONDITIONER": ("Beauty & Health", "Hair Care"),
    "SHAMPOO": ("Beauty & Health", "Hair Care"),
    "SKIN_MOISTURIZER": ("Beauty & Health", "Skin Care"),
    "BEAUTY": ("Beauty & Health", None),
    "BEAUTY_MISC": ("Beauty & Health", None),
    # Fashion
    "SHIRT": ("Men's Clothing", "Tops"),
    "PANTS": ("Men's Clothing", "Bottoms"),
    "DRESS": ("Women's Clothing", "Dresses"),
    "SHOES": ("Shoes", None),
    # Home
    "HOME": ("Home & Kitchen", None),
    "HOME_FURNITURE_AND_DECOR": ("Home & Kitchen", None),
    "KITCHEN": ("Home & Kitchen", "Kitchenware"),
    # Electronics
    "CE": ("Electronics", None),
    "CONSUMER_ELECTRONICS": ("Electronics", None),
    "WIRELESS_ACCESSORY": ("Electronics", None),
}

# Flipkart sheet name → Allsale category (sheet is named like the category).
FLIPKART_SHEET_TO_ALLSALE: dict[str, Tuple[str, Optional[str]]] = {
    "conditioner": ("Beauty & Health", "Hair Care"),
    "shampoo": ("Beauty & Health", "Hair Care"),
    "face wash": ("Beauty & Health", "Skin Care"),
    "lipstick": ("Beauty & Health", "Makeup"),
    "saree": ("Ethnic Fashion", "Sarees"),
    "kurta": ("Ethnic Fashion", "Kurtis"),
    "lehenga": ("Ethnic Fashion", "Lehengas"),
    "sweets": ("Food & Groceries", "Sweets"),
    "spices": ("Food & Groceries", "Spices"),
    "snacks": ("Food & Groceries", "Snacks"),
    "mobile": ("Electronics", None),
    "smartphone": ("Electronics", None),
    "laptop": ("Electronics", None),
}


def map_amazon_product_type(
    pt: str | None,
) -> Tuple[Optional[str], Optional[str]]:
    if not pt:
        return None, None
    key = pt.strip().upper().replace(" ", "_")
    if key in AMAZON_PT_TO_ALLSALE:
        return AMAZON_PT_TO_ALLSALE[key]
    # Partial match heuristics
    if "BEAUTY" in key or "HAIR" in key or "COSMETIC" in key:
        return "Beauty & Health", None
    if "FOOD" in key or "GROCERY" in key:
        return "Food & Groceries", None
    if "CLOTH" in key or "APPAREL" in key:
        return "Women's Clothing", None
    if "ELECTRONIC" in key or "WIRELESS" in key or "PHONE" in key:
        return "Electronics", None
    if "HOME" in key or "KITCHEN" in key or "FURNITURE" in key:
        return "Home & Kitchen", None
    return None, None


def map_flipkart_sheet(sheet: str) -> Tuple[Optional[str], Optional[str]]:
    key = (sheet or "").strip().lower()
    if key in FLIPKART_SHEET_TO_ALLSALE:
        return FLIPKART_SHEET_TO_ALLSALE[key]
    # Fuzzy fallback on substrings.
    for k, v in FLIPKART_SHEET_TO_ALLSALE.items():
        if k in key or key in k:
            return v
    return None, None


def parse_decimal(v) -> Optional[float]:
    """Best-effort parse of a price/number cell — accepts "₹1,234.50"."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    # Strip common currency symbols / thousand separators.
    s = re.sub(r"[₹$£€,]|INR|NZD", "", s, flags=re.IGNORECASE).strip()
    try:
        return float(s)
    except ValueError:
        return None


def parse_int(v) -> Optional[int]:
    d = parse_decimal(v)
    return int(d) if d is not None else None


def split_multi(v, seps: tuple[str, ...] = ("::", "|", ";")) -> list[str]:
    """Flipkart uses ``::``, Amazon often uses ``,``; both common."""
    if v is None or v == "":
        return []
    s = str(v).strip()
    if not s:
        return []
    for sep in seps:
        if sep in s:
            return [p.strip() for p in s.split(sep) if p.strip()]
    # Fall back to single value as a 1-element list.
    return [s]


def coerce_inr_to_nzd(price_inr: float, fx: float) -> float:
    """INR → NZD conversion. ``fx`` is INR per 1 NZD (e.g. 51.3).

    If we don't have an FX rate, use a conservative fallback of 50.
    """
    if fx and fx > 0:
        return round(price_inr / fx, 2)
    return round(price_inr / 50.0, 2)
