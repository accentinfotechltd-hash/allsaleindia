"""B2B Seller Referral Programme service helpers (June 2026).

Pure-data helpers + DB hooks for the referral lifecycle. Wired into the seller
onboarding + order-fulfilment flows so referral rows transition automatically.

Commission policy (defaults; tune via .env later):
- 5 %% of platform commission earned from the referee's first NZ$10k of GMV
- Cap: NZ$500 per referral
- Window: 12 months from the referee's signup date

All public functions are async + idempotent — safe to call from webhooks.
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from db import db
from utils import now_utc

# Policy knobs — tune via .env later without code change.
B2B_COMMISSION_PCT = float(os.getenv("B2B_REFERRAL_PCT", "0.05"))
B2B_COMMISSION_CAP_NZD = float(os.getenv("B2B_REFERRAL_CAP_NZD", "500"))
B2B_GMV_CAP_NZD = float(os.getenv("B2B_REFERRAL_GMV_CAP_NZD", "10000"))
B2B_WINDOW_DAYS = int(os.getenv("B2B_REFERRAL_WINDOW_DAYS", "365"))
B2B_INVITE_EXPIRY_DAYS = int(os.getenv("B2B_REFERRAL_INVITE_EXPIRY_DAYS", "90"))

# Codes look like "RAJESH-7K4Q" — short, readable, no ambiguous chars.
_AMBIG = set("OIL0")
_CODE_CHARS = "".join(c for c in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" if c not in _AMBIG)


def _slug(s: str) -> str:
    s = re.sub(r"[^A-Z0-9]", "", (s or "").upper())
    return (s or "PARTNER")[:8]


async def ensure_seller_b2b_code(user_id: str, company_name: Optional[str] = None) -> str:
    """Get-or-create a unique B2B referral code for a seller.

    Called on every successful seller approval AND lazily on first GET to
    `/api/seller/me/referrals`.
    """
    doc = await db.sellers.find_one({"user_id": user_id}, {"_id": 0, "b2b_referral_code": 1, "company_name": 1})
    if not doc:
        return ""
    existing = doc.get("b2b_referral_code")
    if existing:
        return existing
    base = _slug(company_name or doc.get("company_name") or "PARTNER")
    # Try a few times for uniqueness; with 28-char alphabet ^ 4 = ~600k options
    for _ in range(8):
        suffix = "".join(secrets.choice(_CODE_CHARS) for _ in range(4))
        candidate = f"{base}-{suffix}"
        # Ensure uniqueness across sellers
        collide = await db.sellers.find_one({"b2b_referral_code": candidate}, {"_id": 0, "user_id": 1})
        if not collide:
            await db.sellers.update_one(
                {"user_id": user_id},
                {"$set": {"b2b_referral_code": candidate}},
            )
            return candidate
    # Last-resort fallback (extremely unlikely)
    fallback = f"{base}-{secrets.token_hex(3).upper()}"
    await db.sellers.update_one({"user_id": user_id}, {"$set": {"b2b_referral_code": fallback}})
    return fallback


async def link_b2b_referral_at_signup(referee_user_id: str, code: Optional[str]) -> Optional[str]:
    """Resolve a referrer by `b2b_referral_code` and mark the edge as `signed_up`.

    Idempotent. Returns the referrer's user_id when successfully linked, else None.
    Returns None silently on unknown code, self-referral, or pre-existing link.
    """
    if not code:
        return None
    code = code.strip().upper()
    if len(code) < 4 or len(code) > 24:
        return None
    referrer = await db.sellers.find_one(
        {"b2b_referral_code": code}, {"_id": 0, "user_id": 1}
    )
    if not referrer or referrer["user_id"] == referee_user_id:
        return None
    # Prevent re-attribution if the referee was already linked.
    existing = await db.sellers.find_one(
        {"user_id": referee_user_id, "referred_by_seller_id": {"$exists": True, "$ne": None}},
        {"_id": 0, "user_id": 1},
    )
    if existing:
        return None
    await db.sellers.update_one(
        {"user_id": referee_user_id},
        {"$set": {"referred_by_seller_id": referrer["user_id"]}},
    )
    # Promote any existing pending invite row (matched on referee_email) to "signed_up"
    referee = await db.users.find_one({"id": referee_user_id}, {"_id": 0, "email": 1})
    now = now_utc()
    upd = await db.seller_referrals.update_one(
        {
            "referrer_seller_id": referrer["user_id"],
            "referee_email": (referee or {}).get("email", "").lower() if referee else "",
            "status": "pending",
        },
        {
            "$set": {
                "status": "signed_up",
                "referee_seller_id": referee_user_id,
                "signed_up_at": now,
            }
        },
    )
    # Otherwise create a fresh referral row (e.g. signup arrived without an invite-sent step)
    if upd.matched_count == 0:
        from uuid import uuid4
        await db.seller_referrals.insert_one(
            {
                "id": f"ref_{uuid4().hex[:12]}",
                "referrer_seller_id": referrer["user_id"],
                "referrer_email": None,
                "referee_email": ((referee or {}).get("email") or "").lower(),
                "referee_seller_id": referee_user_id,
                "code": code,
                "status": "signed_up",
                "invited_at": now,
                "signed_up_at": now,
                "approved_at": None,
                "first_sale_at": None,
                "paid_out_at": None,
                "expires_at": now + timedelta(days=B2B_INVITE_EXPIRY_DAYS),
                "referee_gmv_nzd": 0.0,
                "commission_due_nzd": 0.0,
                "commission_paid_nzd": 0.0,
            }
        )
    return referrer["user_id"]


async def mark_referral_approved(referee_user_id: str) -> None:
    """Bump status to `approved` when the referee passes business verification."""
    await db.seller_referrals.update_one(
        {
            "referee_seller_id": referee_user_id,
            "status": {"$in": ["signed_up"]},
        },
        {"$set": {"status": "approved", "approved_at": now_utc()}},
    )


async def accrue_referral_commission(order: dict) -> None:
    """Credit B2B commission to the referrer when a referee fulfils an order.

    Should be called once per (order, seller_item) at the moment the platform
    commission is realised — i.e. after the order is `paid` and (for safety) once
    the parcel is `delivered` (so refunds don't leak commission).

    Idempotency: each (order_id, seller_id) is recorded in
    `seller_referrals.applied_orders` so re-invocation is harmless.
    """
    if not order:
        return
    seller_ids = {it.get("seller_id") for it in (order.get("items") or []) if it.get("seller_id")}
    if not seller_ids:
        return
    order_id = order.get("id")
    if not order_id:
        return

    for sid in seller_ids:
        seller = await db.sellers.find_one(
            {"user_id": sid}, {"_id": 0, "referred_by_seller_id": 1}
        )
        if not seller or not seller.get("referred_by_seller_id"):
            continue
        ref = await db.seller_referrals.find_one(
            {
                "referrer_seller_id": seller["referred_by_seller_id"],
                "referee_seller_id": sid,
            },
            {"_id": 0},
        )
        if not ref or ref.get("status") in {"expired"}:
            continue
        # Window check
        signed = ref.get("signed_up_at")
        if signed and (now_utc() - signed) > timedelta(days=B2B_WINDOW_DAYS):
            continue
        # Idempotency check
        if order_id in (ref.get("applied_orders") or []):
            continue

        # Sum the seller's slice of the order (in NZD) — only items they own.
        gmv_increment = sum(
            (it.get("price_nzd") or 0) * int(it.get("quantity") or 1)
            for it in order.get("items", [])
            if it.get("seller_id") == sid
        )
        if gmv_increment <= 0:
            continue

        # Apply GMV cap remaining
        remaining_gmv = max(0.0, B2B_GMV_CAP_NZD - float(ref.get("referee_gmv_nzd") or 0.0))
        eligible_gmv = min(gmv_increment, remaining_gmv)
        if eligible_gmv <= 0:
            continue

        commission = round(eligible_gmv * B2B_COMMISSION_PCT, 2)
        # Apply absolute cap
        cap_remaining = max(0.0, B2B_COMMISSION_CAP_NZD - float(ref.get("commission_due_nzd") or 0.0))
        commission = round(min(commission, cap_remaining), 2)
        if commission <= 0:
            continue

        update_doc = {
            "$inc": {
                "referee_gmv_nzd": eligible_gmv,
                "commission_due_nzd": commission,
            },
            "$addToSet": {"applied_orders": order_id},
        }
        if not ref.get("first_sale_at"):
            update_doc["$set"] = {
                "status": "first_sale",
                "first_sale_at": now_utc(),
            }
        await db.seller_referrals.update_one({"id": ref["id"]}, update_doc)


async def expire_stale_invites() -> int:
    """Cron task helper: mark un-redeemed invites older than the expiry as `expired`.

    Returns the number of rows mutated. Idempotent.
    """
    cutoff = now_utc() - timedelta(days=B2B_INVITE_EXPIRY_DAYS)
    res = await db.seller_referrals.update_many(
        {"status": "pending", "invited_at": {"$lt": cutoff}},
        {"$set": {"status": "expired"}},
    )
    return res.modified_count
