"""Referral program — built on top of the loyalty points ledger.

Lifecycle:
1. Every user gets a unique `referral_code` on signup (8-char base36-ish).
2. Sharer sends `https://allsale.co.nz/?ref=CODE` or `Use code CODE`.
3. When a NEW user registers with a `referral_code` in their request body,
   we record a `pending` referral and immediately credit the referee +100 pts
   (on top of their base 500 welcome bonus).
4. When that referee's FIRST order is paid (and within 30 days of signup),
   the referrer gets +250 pts and the referral row becomes `rewarded`.

Idempotency: the `referrals` collection has unique `(referee_id)` so each
new user can only be the referee of ONE referrer. Each payment-success path
checks if a referee is unlocking their first paid order.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from db import db


REFERRER_REWARD_PTS = 250
REFEREE_REWARD_PTS = 100
EXPIRY_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_code() -> str:
    """Short, human-friendly referral code (10 chars, no ambiguous chars)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
    return "".join(secrets.choice(alphabet) for _ in range(8))


async def ensure_referral_code(user_id: str) -> str:
    """Idempotent — generate + persist if missing."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "referral_code": 1})
    code = (u or {}).get("referral_code")
    if code:
        return code
    # Retry on collision
    for _ in range(8):
        code = generate_code()
        try:
            await db.users.update_one(
                {"id": user_id, "referral_code": {"$exists": False}},
                {"$set": {"referral_code": code}},
            )
            doc = await db.users.find_one({"id": user_id}, {"_id": 0, "referral_code": 1})
            if doc and doc.get("referral_code") == code:
                return code
        except Exception:
            continue
    raise RuntimeError("Could not allocate a referral code")


async def register_referral(referee_id: str, referee_name: str | None, code: str) -> bool:
    """Called during /auth/register when `referral_code` was provided.

    - Looks up the referrer user by code.
    - Rejects self-referral and duplicate-referee.
    - Inserts a `pending` referral row.
    - Awards +100 pts to the referee (idempotent via ledger ref_id).
    """
    code = (code or "").strip().upper()
    if not code:
        return False
    referrer = await db.users.find_one(
        {"referral_code": code}, {"_id": 0, "id": 1, "full_name": 1, "email": 1}
    )
    if not referrer or referrer["id"] == referee_id:
        return False
    # 1 referrer per referee
    existing = await db.referrals.find_one(
        {"referee_id": referee_id}, {"_id": 0, "id": 1}
    )
    if existing:
        return False
    doc = {
        "id": f"ref_{secrets.token_hex(8)}",
        "referrer_id": referrer["id"],
        "referee_id": referee_id,
        "referee_name": referee_name,
        "status": "pending",
        "pts_referrer": 0,
        "code": code,
        "created_at": _now(),
        "completed_at": None,
    }
    try:
        await db.referrals.insert_one(doc)
    except Exception:
        return False

    # Immediate referee bonus via points ledger (idempotent on ref_id)
    try:
        from services.points import _award_idempotent
        await _award_idempotent(
            referee_id, REFEREE_REWARD_PTS, "referral_bonus",
            f"Referral bonus · +{REFEREE_REWARD_PTS} pts",
            ref_id=doc["id"], ref_type="referral_receive",
        )
    except Exception:
        pass
    return True


async def maybe_unlock_referrer_reward(referee_id: str, order_id: str) -> int:
    """Called from `_on_payment_succeeded`. If the buyer is a referee and
    this is their FIRST paid order (within EXPIRY_DAYS), credit +250 to
    the referrer and mark the referral as `rewarded`. Idempotent.
    """
    ref = await db.referrals.find_one(
        {"referee_id": referee_id, "status": "pending"}, {"_id": 0}
    )
    if not ref:
        return 0

    created = ref.get("created_at")
    if isinstance(created, datetime):
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if _now() - created > timedelta(days=EXPIRY_DAYS):
            await db.referrals.update_one(
                {"id": ref["id"]}, {"$set": {"status": "expired"}}
            )
            return 0

    # Award referrer (idempotent via ref_id=ref.id)
    try:
        from services.points import _award_idempotent
        created_flag = await _award_idempotent(
            ref["referrer_id"],
            REFERRER_REWARD_PTS,
            "referral_reward",
            f"Friend's first order · +{REFERRER_REWARD_PTS} pts",
            ref_id=ref["id"],
            ref_type="referral_send",
        )
    except Exception:
        created_flag = False

    if created_flag:
        await db.referrals.update_one(
            {"id": ref["id"]},
            {
                "$set": {
                    "status": "rewarded",
                    "pts_referrer": REFERRER_REWARD_PTS,
                    "completed_at": _now(),
                    "first_paid_order_id": order_id,
                }
            },
        )
        return REFERRER_REWARD_PTS
    return 0
