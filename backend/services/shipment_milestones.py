"""Shipment milestone detection.

Decides whether a single scan event from Shiprocket represents a "buyer-visible
milestone" — e.g. parcel reached the destination country, cleared customs, etc.
Each milestone fires at most once per order, tracked via `orders.milestones_notified`.

This is intentionally string-based (no geocoding) so it works without external
APIs. The matchers are deliberately conservative to avoid noisy notifications.
"""
from __future__ import annotations

from typing import Optional

# Country detection patterns. Country code in the address (e.g. "NZ") drives
# the matcher list — we look for the country name and/or major-city substrings
# in either `location` or `remark` carrier strings.
_COUNTRY_HINTS: dict[str, list[str]] = {
    "NZ": ["new zealand", "auckland", "wellington", "christchurch", "hamilton", " nz"],
    "AU": ["australia", "sydney", "melbourne", "brisbane", "perth", " au"],
    "US": ["united states", "new york", "los angeles", "chicago", " usa", " us"],
    "GB": ["united kingdom", "london", "manchester", "birmingham", " uk", "england", "scotland"],
    "CA": ["canada", "toronto", "vancouver", "montreal", " ca"],
}

# Customs keywords that suggest the parcel has cleared / is clearing customs.
_CUSTOMS_HINTS = (
    "customs cleared",
    "customs released",
    "customs clearance",
    "released by customs",
    "out of customs",
    "import clearance",
    "import customs",
)


def _country_code_for(address: Optional[dict]) -> Optional[str]:
    if not address:
        return None
    country = (address.get("country") or "").lower().strip()
    if not country:
        return None
    aliases = {
        "new zealand": "NZ",
        "nz": "NZ",
        "australia": "AU",
        "au": "AU",
        "united states": "US",
        "united states of america": "US",
        "usa": "US",
        "us": "US",
        "united kingdom": "GB",
        "uk": "GB",
        "great britain": "GB",
        "england": "GB",
        "canada": "CA",
        "ca": "CA",
    }
    return aliases.get(country)


def detect_milestone(
    *,
    event_status: Optional[str],
    event_location: Optional[str],
    event_remark: Optional[str],
    order: dict,
) -> Optional[dict]:
    """Return `{key, title, body}` if this scan signals a new milestone for the
    buyer, else None. The caller is responsible for de-duping via
    `orders.milestones_notified`.
    """
    notified = set(order.get("milestones_notified") or [])
    haystack = " ".join(
        s.lower()
        for s in (event_status, event_location, event_remark)
        if s
    ).strip()
    if not haystack:
        return None

    address = order.get("address") or {}
    country_code = _country_code_for(address)
    country_name = (address.get("country") or "").strip().title()

    # Milestone 1: parcel has reached the destination country.
    if country_code and "arrived_in_destination" not in notified:
        for hint in _COUNTRY_HINTS.get(country_code, []):
            if hint in haystack:
                return {
                    "key": "arrived_in_destination",
                    "title": f"Your parcel arrived in {country_name or country_code} 🎉",
                    "body": "We'll let you know when it's out for delivery.",
                }

    # Milestone 2: customs clearance.
    if "customs_cleared" not in notified:
        for kw in _CUSTOMS_HINTS:
            if kw in haystack:
                return {
                    "key": "customs_cleared",
                    "title": "Customs cleared ✅",
                    "body": "Your parcel has cleared customs and is moving to local delivery.",
                }

    return None
