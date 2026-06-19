"""B2B Seller Referral Programme — seller-facing endpoints.

- GET  /api/seller/me/referrals          — list invites + roll-up stats
- POST /api/seller/me/referrals/invite   — generate an invite (sends Resend email best-effort)
- GET  /api/b2b/referral/{code}/preview  — public, used by signup form to display referrer name

Commission policy lives in `services/b2b_referrals.py`.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import timedelta
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import (
    SellerReferral,
    SellerReferralInviteRequest,
    SellerReferralStats,
    SellerReferralsPage,
)
from services.b2b_referrals import (
    B2B_COMMISSION_CAP_NZD,
    B2B_COMMISSION_PCT,
    B2B_INVITE_EXPIRY_DAYS,
    ensure_seller_b2b_code,
)
from utils import now_utc

router = APIRouter(tags=["seller_referrals"])
log = logging.getLogger("allsale.b2b_referrals")

_PUBLIC_HOST = os.getenv("PUBLIC_SHOP_URL", "https://shop.allsale.co.nz").rstrip("/")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _invite_url(code: str) -> str:
    return f"{_PUBLIC_HOST}/sellers/join?ref={code}"


@router.get("/seller/me/referrals", response_model=SellerReferralsPage)
async def list_my_referrals(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    # Lazy-issue a code if approval flow somehow missed it
    profile = await db.sellers.find_one({"user_id": current["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    code = profile.get("b2b_referral_code") or await ensure_seller_b2b_code(
        current["id"], profile.get("company_name")
    )

    rows: list[dict] = []
    cursor = db.seller_referrals.find(
        {"referrer_seller_id": current["id"]}, {"_id": 0}
    ).sort("invited_at", -1)
    async for r in cursor:
        rows.append(r)

    stats = SellerReferralStats(
        code=code,
        total_invited=len(rows),
        total_signed_up=sum(1 for r in rows if r.get("status") in {"signed_up", "approved", "first_sale", "paid_out"}),
        total_approved=sum(1 for r in rows if r.get("status") in {"approved", "first_sale", "paid_out"}),
        total_first_sale=sum(1 for r in rows if r.get("status") in {"first_sale", "paid_out"}),
        total_commission_due_nzd=round(sum(float(r.get("commission_due_nzd") or 0.0) for r in rows), 2),
        total_commission_paid_nzd=round(sum(float(r.get("commission_paid_nzd") or 0.0) for r in rows), 2),
        invite_url=_invite_url(code),
    )
    return SellerReferralsPage(stats=stats, referrals=[SellerReferral(**r) for r in rows])


@router.post("/seller/me/referrals/invite", response_model=SellerReferral, status_code=201)
async def send_referral_invite(
    body: SellerReferralInviteRequest, current=Depends(get_current_user)
):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    referee_email = body.referee_email.lower().strip()
    if not _EMAIL_RE.match(referee_email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    if referee_email == (current.get("email") or "").lower():
        raise HTTPException(status_code=400, detail="You can't invite yourself")

    # Block invites to existing sellers — quietly tell the caller
    existing_seller = await db.users.find_one(
        {"email": referee_email, "is_seller": True}, {"_id": 0, "id": 1}
    )
    if existing_seller:
        raise HTTPException(
            status_code=409,
            detail="This business is already a seller on Allsale.",
        )

    profile = await db.sellers.find_one({"user_id": current["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    code = profile.get("b2b_referral_code") or await ensure_seller_b2b_code(
        current["id"], profile.get("company_name")
    )

    # De-dupe within 30 days for the same (referrer, referee_email)
    recent = await db.seller_referrals.find_one(
        {
            "referrer_seller_id": current["id"],
            "referee_email": referee_email,
            "invited_at": {"$gte": now_utc() - timedelta(days=30)},
        },
        {"_id": 0},
    )
    if recent:
        return SellerReferral(**recent)

    now = now_utc()
    doc = {
        "id": f"ref_{uuid4().hex[:12]}",
        "referrer_seller_id": current["id"],
        "referrer_email": current.get("email"),
        "referee_email": referee_email,
        "referee_seller_id": None,
        "code": code,
        "status": "pending",
        "invited_at": now,
        "signed_up_at": None,
        "approved_at": None,
        "first_sale_at": None,
        "paid_out_at": None,
        "expires_at": now + timedelta(days=B2B_INVITE_EXPIRY_DAYS),
        "referee_gmv_nzd": 0.0,
        "commission_due_nzd": 0.0,
        "commission_paid_nzd": 0.0,
        "applied_orders": [],
    }
    await db.seller_referrals.insert_one(doc)

    # Best-effort email (Resend) — never blocks the response
    try:
        from services.email import send_email

        ref_name = (body.referee_name or "").strip() or "there"
        my_name = (profile.get("company_name") or current.get("full_name") or "A partner").strip()
        custom_note = (body.note or "").strip()
        note_block = (
            f'<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #FF6B35;color:#475569">'
            f'{custom_note}</blockquote>'
            if custom_note
            else ""
        )
        invite_url = _invite_url(code)
        html = f"""
        <div style="font-family:system-ui,Helvetica,Arial,sans-serif;padding:24px;max-width:560px;margin:0 auto;color:#0f172a">
          <h2 style="margin:0 0 12px">Hi {ref_name}, you're invited to sell on Allsale 🇮🇳→🇳🇿</h2>
          <p style="margin:0 0 12px;color:#475569">
            {my_name} thinks your business would be a great fit for Allsale — the cross-border
            marketplace bringing Indian sellers to buyers across New Zealand, Australia, the US, the UK and Canada.
          </p>
          {note_block}
          <p style="margin:24px 0 8px">
            <a href="{invite_url}" style="background:#FF6B35;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Apply to become a seller</a>
          </p>
          <p style="margin:8px 0 16px;font-size:13px;color:#64748b">Or paste this code in the seller signup form: <strong>{code}</strong></p>
          <p style="margin-top:24px;font-size:12px;color:#94a3b8">If this isn't for you, no worries — just ignore this email.</p>
        </div>
        """
        send_email(
            to=referee_email,
            subject=f"{my_name} invited you to sell on Allsale",
            html=html,
            text=(
                f"Hi {ref_name},\n\n{my_name} invited you to sell on Allsale.\n"
                f"Apply here: {invite_url}\nOr use referral code: {code}\n"
            ),
        )
    except Exception as e:
        log.warning("B2B invite email failed: %s", e)

    return SellerReferral(**doc)


@router.get("/b2b/referral/{code}/preview")
async def preview_referrer(code: str):
    """Public endpoint — the seller-signup form looks up the referrer's
    company name so the form can render "Invited by Foo Exports" inline.
    """
    code = code.strip().upper()
    if len(code) < 4 or len(code) > 24:
        raise HTTPException(status_code=400, detail="Invalid code")
    profile = await db.sellers.find_one(
        {"b2b_referral_code": code},
        {"_id": 0, "company_name": 1, "city": 1, "user_id": 1},
    )
    if not profile:
        raise HTTPException(status_code=404, detail="Referral code not found")
    return {
        "code": code,
        "referrer_company": profile.get("company_name") or "Allsale Partner",
        "referrer_city": profile.get("city"),
        "commission_pct": B2B_COMMISSION_PCT,
        "commission_cap_nzd": B2B_COMMISSION_CAP_NZD,
    }
