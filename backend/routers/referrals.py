"""Referral program endpoints — get my code, history, totals."""
from __future__ import annotations

import os
from typing import List

from fastapi import APIRouter, Depends

from db import db
from deps import get_current_user
from models import ReferralEntry, ReferralMe
from services.referrals import (
    EXPIRY_DAYS,
    REFEREE_REWARD_PTS,
    REFERRER_REWARD_PTS,
    ensure_referral_code,
)

router = APIRouter(prefix="/referrals", tags=["referrals"])


def _share_url(code: str) -> str:
    base = os.environ.get("ALLSALE_WEB_BASE", "https://allsale.co.nz").rstrip("/")
    return f"{base}/?ref={code}"


def _share_message(code: str, url: str) -> str:
    return (
        f"Shop unique handmade & cross-border products on Allsale! "
        f"Use my code {code} when you sign up and you'll get +{REFEREE_REWARD_PTS} pts "
        f"toward your first order. ✨\n{url}"
    )


@router.get("/me", response_model=ReferralMe)
async def my_referrals(current=Depends(get_current_user)):
    code = await ensure_referral_code(current["id"])

    history: list[ReferralEntry] = []
    total_referred = 0
    total_rewarded = 0
    pts_earned = 0
    async for r in db.referrals.find({"referrer_id": current["id"]}, {"_id": 0}).sort(
        "created_at", -1
    ):
        total_referred += 1
        if r.get("status") == "rewarded":
            total_rewarded += 1
            pts_earned += int(r.get("pts_referrer", 0) or 0)
        history.append(
            ReferralEntry(
                id=r["id"],
                referee_id=r["referee_id"],
                referee_name=r.get("referee_name"),
                status=r.get("status", "pending"),
                pts_referrer=int(r.get("pts_referrer", 0) or 0),
                created_at=r["created_at"],
                completed_at=r.get("completed_at"),
            )
        )

    url = _share_url(code)
    return ReferralMe(
        code=code,
        share_url=url,
        share_message=_share_message(code, url),
        referrer_reward_pts=REFERRER_REWARD_PTS,
        referee_reward_pts=REFEREE_REWARD_PTS,
        expiry_days=EXPIRY_DAYS,
        total_referred=total_referred,
        total_rewarded=total_rewarded,
        pts_earned=pts_earned,
        history=history[:50],
    )
