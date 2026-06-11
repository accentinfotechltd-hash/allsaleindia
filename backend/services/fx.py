"""FX-rate service: Frankfurter live rates with hardcoded fallback.

Frankfurter (https://www.frankfurter.dev/) is a free, no-key, ECB-backed
public FX API. We refresh once an hour into an in-process cache and silently
fall back to the values in `config.FX_RATES_FROM_NZD` when the network call
fails (offline, rate-limited, or DNS blocked).
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

# In-process cache.
_rates: dict[str, float] = dict(FX_RATES_FROM_NZD)
_last_refresh: Optional[datetime] = None
_lock = asyncio.Lock()


async def _refresh_now() -> None:
    """Fetch fresh NZD→target rates from Frankfurter; keep stale on failure."""
    global _rates, _last_refresh
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            r = await client.get(
                _FRANKFURTER_URL,
                params={"from": "NZD", "to": "AUD,USD,GBP,CAD"},
            )
            r.raise_for_status()
            payload = r.json()
        live = payload.get("rates") or {}
        if not live:
            raise ValueError("frankfurter returned empty rates")
        merged: dict[str, float] = {"NZD": 1.0}
        for ccy, val in live.items():
            try:
                merged[ccy] = float(val)
            except (TypeError, ValueError):
                continue
        # Fill any missing currencies from the hardcoded table (defensive).
        for ccy, fallback in FX_RATES_FROM_NZD.items():
            merged.setdefault(ccy, fallback)
        _rates = merged
        _last_refresh = datetime.now(timezone.utc)
        logger.info("FX rates refreshed from Frankfurter: %s", _rates)
    except Exception as e:  # network / parse / etc — keep last good rates.
        logger.warning("FX rates refresh failed (%s); keeping cached values", e)


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
