"""Free geocoding for shipment scan events (June 2026 — Phase 1.5 #3).

Uses OpenStreetMap Nominatim (free, no API key, hard rate-limited at 1 req/s).
Results are cached in the `geocode_cache` collection so we never re-hit the
upstream for the same location string. Cache TTL is 30 days.

If Nominatim is down or rate-limits us, callers fall back to text-only display.
"""
from __future__ import annotations

import logging
import os
from datetime import timedelta
from typing import Optional

import httpx

from db import db
from utils import now_utc

log = logging.getLogger("allsale.geocode")
_TTL_DAYS = 30
_USER_AGENT = os.getenv("NOMINATIM_USER_AGENT", "AllsaleIndianBazaar/1.0 (support@allsale.co.nz)")
_NOMINATIM = "https://nominatim.openstreetmap.org/search"
_TIMEOUT_S = 6.0


async def geocode_location(location: str) -> Optional[dict]:
    """Return {lat, lng, display_name} for a location string, or None.

    Cached in Mongo. Safe to call repeatedly on the same string.
    """
    if not location:
        return None
    key = location.strip().lower()
    if len(key) < 2 or len(key) > 200:
        return None

    # 1. Cache lookup
    cached = await db.geocode_cache.find_one({"key": key}, {"_id": 0})
    if cached:
        if cached.get("fetched_at") and (now_utc() - cached["fetched_at"]) < timedelta(days=_TTL_DAYS):
            if cached.get("lat") is not None and cached.get("lng") is not None:
                return {
                    "lat": float(cached["lat"]),
                    "lng": float(cached["lng"]),
                    "display_name": cached.get("display_name"),
                }
            # Cached negative result — return None without re-hitting upstream
            return None

    # 2. Upstream Nominatim call
    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": _USER_AGENT, "Accept-Language": "en"},
            timeout=_TIMEOUT_S,
        ) as client:
            r = await client.get(
                _NOMINATIM,
                params={"q": location, "format": "json", "limit": 1, "addressdetails": 0},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.warning("Nominatim lookup failed for %r: %s", location, e)
        return None

    if not data:
        # Cache the negative result so we don't keep hammering for unknowns
        await db.geocode_cache.update_one(
            {"key": key},
            {"$set": {"key": key, "lat": None, "lng": None, "fetched_at": now_utc()}},
            upsert=True,
        )
        return None

    hit = data[0]
    try:
        lat = float(hit["lat"])
        lng = float(hit["lon"])
    except (KeyError, ValueError, TypeError):
        return None

    out = {"lat": lat, "lng": lng, "display_name": hit.get("display_name")}
    await db.geocode_cache.update_one(
        {"key": key},
        {"$set": {**out, "key": key, "fetched_at": now_utc()}},
        upsert=True,
    )
    return out


def osm_static_map_url(lat: float, lng: float, zoom: int = 6, width: int = 600, height: int = 240) -> str:
    """Return a free static-map image URL for the given coordinates.

    Uses staticmap.openstreetmap.de (community-hosted, no API key required).
    Falls back gracefully if the upstream is unavailable — caller can simply
    omit the <Image /> element on error.
    """
    return (
        f"https://staticmap.openstreetmap.de/staticmap.php"
        f"?center={lat},{lng}&zoom={zoom}&size={width}x{height}"
        f"&markers={lat},{lng},lightblue1"
    )
