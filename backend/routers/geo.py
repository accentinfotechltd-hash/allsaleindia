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
    SUPPORTED_COUNTRIES,
)
from services import fx

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


@router.get("/geo/auto-redirect")
async def auto_redirect(request: Request):
    """Return the canonical subdomain for the visitor's detected country.

    The web app calls this on cold start; if the current hostname doesn't
    match the recommendation, it issues a 302 to the right subdomain.
    """
    raw = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("x-country")
        or request.headers.get("x-vercel-ip-country")
        or ""
    ).upper()
    detected = raw if raw in COUNTRY_CODES else DEFAULT_COUNTRY
    # Map country code → subdomain prefix. Falls back to www for unknowns.
    subdomain = {
        "NZ": "www",
        "AU": "au",
        "US": "us",
        "GB": "uk",
        "CA": "ca",
        "FJ": "fj",
    }.get(detected, "www")
    info = next((c for c in SUPPORTED_COUNTRIES if c["code"] == detected), SUPPORTED_COUNTRIES[0])
    return {
        "country": detected,
        "subdomain": subdomain,
        "host_hint": f"{subdomain}.allsale.co.nz",
        "currency": info["currency"],
        "symbol": info["symbol"],
        "name": info["name"],
    }


@router.get("/currency/rates")
async def currency_rates():
    """Return the supported countries and live NZD→target FX rates.

    Rates are fetched from Frankfurter (ECB) once an hour and silently fall
    back to the hardcoded `FX_RATES_FROM_NZD` table when the API is
    unreachable. `last_refresh` is null on cold-start (before first fetch).
    """
    live_rates = await fx.get_rates()
    last = fx.get_last_refresh()
    return {
        "base": "NZD",
        "rates": live_rates,
        "countries": SUPPORTED_COUNTRIES,
        "source": "frankfurter" if last else "fallback",
        "last_refresh": last.isoformat() if last else None,
    }
