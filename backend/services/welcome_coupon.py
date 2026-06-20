"""Welcome coupon — the activation lever for brand-new accounts.

We don't issue a per-user code (too noisy); instead a single sitewide coupon
``WELCOME10`` (default) is upserted at startup with ``first_order_only=True``
and ``per_user_limit=1`` so every new buyer can redeem it exactly once.

Tunable via env vars:
  ALLSALE_WELCOME_CODE          (default "WELCOME10")
  ALLSALE_WELCOME_PCT           (default 10 — percent off)
  ALLSALE_WELCOME_MAX_NZD       (default 20 — discount cap in NZD)
  ALLSALE_WELCOME_MIN_NZD       (default 25 — minimum cart subtotal)
  ALLSALE_WELCOME_DESC          (default copy)
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from db import db
from utils import now_utc

logger = logging.getLogger("allsale.welcome_coupon")


def _config() -> dict:
    return {
        "code": (os.getenv("ALLSALE_WELCOME_CODE") or "WELCOME10").upper(),
        "pct": float(os.getenv("ALLSALE_WELCOME_PCT") or 10),
        "max_nzd": float(os.getenv("ALLSALE_WELCOME_MAX_NZD") or 20),
        "min_nzd": float(os.getenv("ALLSALE_WELCOME_MIN_NZD") or 25),
        "description": (
            os.getenv("ALLSALE_WELCOME_DESC")
            or "Welcome to Allsale! 10% off your first order — up to $20 NZD."
        ),
    }


async def ensure_welcome_coupon() -> dict:
    """Upsert the sitewide welcome coupon. Idempotent — safe to call on every
    startup. Returns the freshly fetched coupon document."""
    cfg = _config()
    code = cfg["code"]

    existing = await db.coupons.find_one({"code": code}, {"_id": 0})
    if existing:
        # Patch a couple of fields so env tweaks take effect without forcing
        # a manual db edit, but keep usage counters intact.
        await db.coupons.update_one(
            {"code": code},
            {
                "$set": {
                    "description": cfg["description"],
                    "type": "percent",
                    "value": cfg["pct"],
                    "max_discount_nzd": cfg["max_nzd"],
                    "min_order_nzd": cfg["min_nzd"],
                    "scope": "all",
                    "scope_value": [],
                    "active": True,
                    "first_order_only": True,
                    "per_user_limit": 1,
                    "owner_id": "admin",
                    "owner_name": "Allsale",
                }
            },
        )
        logger.info("[welcome_coupon] refreshed existing coupon %s", code)
        return await db.coupons.find_one({"code": code}, {"_id": 0})

    doc = {
        "id": "cpn_welcome_first_order",
        "code": code,
        "description": cfg["description"],
        "type": "percent",
        "value": cfg["pct"],
        "min_order_nzd": cfg["min_nzd"],
        "max_discount_nzd": cfg["max_nzd"],
        "valid_from": None,
        "valid_to": None,  # evergreen
        "usage_limit_total": None,  # uncapped across users
        "used_count": 0,
        "per_user_limit": 1,
        "scope": "all",
        "scope_value": [],
        "countries": [],
        "owner_id": "admin",
        "owner_name": "Allsale",
        "active": True,
        "first_order_only": True,
        "created_at": now_utc(),
    }
    await db.coupons.insert_one(doc)
    logger.info("[welcome_coupon] seeded sitewide coupon %s", code)
    return doc


async def get_welcome_coupon_for_user(user: dict) -> Optional[dict]:
    """Return the welcome coupon if (and only if) the user has never paid
    for an order. Returns ``None`` otherwise so the UI doesn't show a stale
    banner to repeat customers."""
    cfg = _config()
    coupon = await db.coupons.find_one(
        {"code": cfg["code"], "active": True}, {"_id": 0}
    )
    if not coupon:
        return None
    paid = await db.orders.count_documents(
        {
            "user_id": user["id"],
            "payment_status": {"$in": ["paid", "refunded", "refund_pending"]},
        }
    )
    if paid > 0:
        return None
    # If they've already redeemed this code (edge case), don't surface again.
    used = await db.coupon_usage.count_documents(
        {"coupon_id": coupon["id"], "user_id": user["id"]}
    )
    if used > 0:
        return None
    return coupon
