"""FX-rate service: Frankfurter live rates with hardcoded fallback.

Frankfurter (https://www.frankfurter.dev/) is a free, no-key, ECB-backed
public FX API. We refresh once an hour into an in-process cache and silently
fall back to the values in `config.FX_RATES_FROM_NZD` when the network call
fails (offline, rate-limited, or DNS blocked).

Pacific currencies (FJD) aren't tracked by the ECB. We make a secondary
best-effort call to open.er-api.com (also free, no key, broader coverage)
to pull a live FJD rate. Failures fall back to the hardcoded value.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from config import FX_RATES_FROM_NZD

logger = logging.getLogger("allsale")

_REFRESH_INTERVAL = timedelta(hours=1)
_TIMEOUT_S = 4.0
_FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest"
# open.er-api.com is a free, no-key, community FX API. Wider currency
# coverage than Frankfurter — includes Pacific currencies like FJD, WST,
# TOP, PGK. Tolerated to be slightly less precise than ECB (best-effort).
_OPEN_ER_API_URL = "https://open.er-api.com/v6/latest/NZD"
# Pacific currencies sourced from open.er-api.com (not ECB-tracked).
_OPEN_ER_CCYS = ("FJD",)

# In-process cache.
_rates: dict[str, float] = dict(FX_RATES_FROM_NZD)
_last_refresh: Optional[datetime] = None
_lock = asyncio.Lock()


async def _fetch_frankfurter(client: httpx.AsyncClient) -> dict[str, float]:
    """Fetch NZD→AUD/USD/GBP/CAD from Frankfurter (ECB-tracked)."""
    r = await client.get(
        _FRANKFURTER_URL,
        # NOTE: Frankfurter (ECB-tracked) does not support FJD — we pull
        # that from open.er-api.com below.
        params={"from": "NZD", "to": "AUD,USD,GBP,CAD"},
    )
    r.raise_for_status()
    payload = r.json()
    live = payload.get("rates") or {}
    if not live:
        raise ValueError("frankfurter returned empty rates")
    out: dict[str, float] = {}
    for ccy, val in live.items():
        try:
            out[ccy] = float(val)
        except (TypeError, ValueError):
            continue
    return out


async def _fetch_open_er(client: httpx.AsyncClient) -> dict[str, float]:
    """Fetch only the currencies Frankfurter doesn't cover (e.g. FJD)."""
    r = await client.get(_OPEN_ER_API_URL)
    r.raise_for_status()
    payload = r.json()
    if (payload.get("result") or "").lower() != "success":
        raise ValueError(f"open.er-api.com error: {payload.get('error-type')}")
    all_rates = payload.get("rates") or {}
    out: dict[str, float] = {}
    for ccy in _OPEN_ER_CCYS:
        val = all_rates.get(ccy)
        if val is None:
            continue
        try:
            out[ccy] = float(val)
        except (TypeError, ValueError):
            continue
    return out


async def _refresh_now() -> None:
    """Fetch fresh NZD→target rates; keep stale values on any failure."""
    global _rates, _last_refresh
    merged: dict[str, float] = {"NZD": 1.0}
    fetched_any = False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            # Primary: ECB via Frankfurter (AUD, USD, GBP, CAD)
            try:
                merged.update(await _fetch_frankfurter(client))
                fetched_any = True
            except Exception as e:
                logger.warning("Frankfurter refresh failed (%s)", e)

            # Secondary: Pacific currencies via open.er-api.com (FJD)
            try:
                merged.update(await _fetch_open_er(client))
                fetched_any = True
            except Exception as e:
                logger.warning("open.er-api.com refresh failed (%s)", e)
    except Exception as e:  # transport-level failure
        logger.warning("FX refresh transport failed (%s); keeping cached", e)
        return

    if not fetched_any:
        # Both providers down — keep last good cache (do NOT overwrite with
        # just {"NZD": 1.0} which would silently lose all conversions).
        return

    # Fill any missing currencies from the hardcoded table (defensive).
    for ccy, fallback in FX_RATES_FROM_NZD.items():
        merged.setdefault(ccy, fallback)
    _rates = merged
    _last_refresh = datetime.now(timezone.utc)
    logger.info("FX rates refreshed: %s", _rates)


async def get_rates() -> dict[str, float]:
    """Return NZD-base rates; refresh once an hour."""
    now = datetime.now(timezone.utc)
    if _last_refresh is None or now - _last_refresh >= _REFRESH_INTERVAL:
        async with _lock:
            if _last_refresh is None or now - _last_refresh >= _REFRESH_INTERVAL:
                await _refresh_now()
    return dict(_rates)


def get_last_refresh() -> Optional[datetime]:
    return _last_refresh


def convert(amount_nzd: float, currency: str, rates: Optional[dict] = None) -> float:
    """Convert NZD→currency using either supplied rates or the cached map."""
    r = rates if rates is not None else _rates
    rate = r.get((currency or "NZD").upper(), 1.0)
    return round(float(amount_nzd) * rate, 2)
