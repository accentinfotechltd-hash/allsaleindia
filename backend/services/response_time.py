"""Seller response-time stat (Phase 8.5, June 2026).

Computes the median minutes between a buyer's message and the seller's first
reply across the last 30 days. Cached on the seller document for 24 hours so
the next PDP/chat load is snappy.

Public format (suitable for UI):
    {
      "label": "Usually replies in 2 hours",
      "minutes": 122,
      "samples": 18,
      "computed_at": "2026-06-19T03:00:00Z"
    }
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Optional

from db import db
from utils import now_utc

CACHE_TTL_HOURS = 24
LOOKBACK_DAYS = 30
MIN_SAMPLES = 3


def _format_label(minutes: int) -> str:
    if minutes <= 0:
        return "Usually replies instantly"
    if minutes < 60:
        return f"Usually replies in {minutes} min"
    if minutes < 24 * 60:
        h = round(minutes / 60)
        return f"Usually replies in {h} hour{'s' if h != 1 else ''}"
    d = round(minutes / (60 * 24))
    return f"Usually replies in {d} day{'s' if d != 1 else ''}"


async def compute_seller_response_stats(seller_id: str, force: bool = False) -> Optional[dict]:
    """Return cached-or-fresh response stats for a seller.

    Returns None if there's not enough data (`<MIN_SAMPLES` reply pairs).
    """
    seller = await db.users.find_one(
        {"id": seller_id, "is_seller": True}, {"_id": 0, "response_stats": 1}
    )
    if not seller:
        return None
    cached = seller.get("response_stats") if isinstance(seller.get("response_stats"), dict) else None
    if not force and cached:
        computed_at = cached.get("computed_at")
        if computed_at and (now_utc() - computed_at) < timedelta(hours=CACHE_TTL_HOURS):
            return cached

    # Fetch the seller's recent conversations + messages, compute median reply lag.
    since = now_utc() - timedelta(days=LOOKBACK_DAYS)
    convs_cursor = db.chat_conversations.find(
        {"seller_id": seller_id}, {"_id": 0, "id": 1}
    )
    conv_ids: list[str] = []
    async for c in convs_cursor:
        conv_ids.append(c["id"])
    if not conv_ids:
        return None

    lags: list[float] = []
    for conv_id in conv_ids:
        msgs_cursor = db.chat_messages.find(
            {"conversation_id": conv_id, "created_at": {"$gte": since}},
            {"_id": 0, "from_role": 1, "created_at": 1},
        ).sort("created_at", 1)
        last_buyer_at: Optional[datetime] = None
        async for m in msgs_cursor:
            role = m.get("from_role")
            at = m.get("created_at")
            if role == "buyer":
                if last_buyer_at is None:
                    last_buyer_at = at
            elif role == "seller" and last_buyer_at:
                delta_min = (at - last_buyer_at).total_seconds() / 60.0
                if delta_min >= 0:
                    lags.append(delta_min)
                last_buyer_at = None

    if len(lags) < MIN_SAMPLES:
        return None

    minutes = int(round(median(lags)))
    payload = {
        "minutes": minutes,
        "samples": len(lags),
        "label": _format_label(minutes),
        "computed_at": now_utc(),
    }
    await db.users.update_one({"id": seller_id}, {"$set": {"response_stats": payload}})
    return payload
