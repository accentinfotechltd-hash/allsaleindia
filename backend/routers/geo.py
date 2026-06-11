"""Geolocation + currency endpoints (Phase 1 multi-region).

* `GET /api/geo/detect` — best-effort country detection from request headers
  (Cloudflare's `cf-ipcountry`, then `X-Country`). Falls back to the
  configured `DEFAULT_COUNTRY` (NZ).
* `GET /api/currency/rates` — exposes the hardcoded NZD-base FX rates and
  the supported-country metadata so the frontend can render localized
  prices without round-tripping the backend on every screen.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from config import (
    COUNTRY_CODES,
    DEFAULT_COUNTRY,
    FX_RATES_FROM_NZD,
    SUPPORTED_COUNTRIES,
)

router = APIRouter(tags=["geo"])


@router.get("/geo/detect")
async def detect_country(request: Request):
    """Detect the buyer's country from common upstream proxy headers.

    Cloudflare populates `cf-ipcountry`. Behind nginx ingress we also accept
    a manually-set `X-Country` header. Returns the closest supported country
    (or DEFAULT_COUNTRY when the detected one isn't supported).
    """
    raw = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("x-country")
        or request.headers.get("x-vercel-ip-country")
        or ""
    ).upper()
    detected = raw if raw in COUNTRY_CODES else DEFAULT_COUNTRY
    info = next((c for c in SUPPORTED_COUNTRIES if c["code"] == detected), SUPPORTED_COUNTRIES[0])
    return {
        "country": detected,
        "name": info["name"],
        "currency": info["currency"],
        "symbol": info["symbol"],
        "supported": detected in COUNTRY_CODES,
    }


@router.get("/currency/rates")
async def currency_rates():
    """Return the supported countries and hardcoded NZD→target FX rates."""
    return {
        "base": "NZD",
        "rates": FX_RATES_FROM_NZD,
        "countries": SUPPORTED_COUNTRIES,
    }
