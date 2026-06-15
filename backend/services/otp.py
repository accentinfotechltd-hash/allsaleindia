"""Email-based OTP service for two-factor authentication.

Codes are 6-digit numeric, hashed with SHA-256 before storage,
expire after OTP_TTL_MINUTES, and lock out after MAX_ATTEMPTS.
Generation is rate-limited per email (MAX_REQUESTS_PER_WINDOW).
"""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import timedelta
from typing import Optional

from db import db
from utils import now_utc

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
MAX_REQUESTS_PER_WINDOW = 5
REQUEST_WINDOW_MINUTES = 60

# Ephemeral 2FA session token TTL (only used between password-step and OTP-step)
EPHEMERAL_TTL_MINUTES = 5


def _hash_code(code: str) -> str:
    """SHA-256 is fine here — codes are 6 digits with 10-min TTL and 5-attempt cap.
    bcrypt would slow down the verify path needlessly for such small entropy.
    """
    pepper = os.getenv("OTP_PEPPER", "allsale-otp-pepper-change-me")
    return hashlib.sha256(f"{pepper}:{code}".encode("utf-8")).hexdigest()


def generate_code() -> str:
    """Cryptographically-strong 6-digit numeric code."""
    return f"{secrets.randbelow(1_000_000):06d}"


async def issue_otp(
    *,
    email: str,
    user_id: str,
    purpose: str,
) -> tuple[str, dict]:
    """Generate + persist a new OTP. Returns (plaintext_code, db_doc).
    Caller is responsible for emailing the plaintext code.

    `purpose` is one of: 'login_2fa', 'enable_2fa', 'disable_2fa'.

    Enforces rate-limit: max MAX_REQUESTS_PER_WINDOW issuances per email per hour.
    """
    email = email.lower()
    window_start = now_utc() - timedelta(minutes=REQUEST_WINDOW_MINUTES)
    recent_count = await db.email_otps.count_documents(
        {"email": email, "created_at": {"$gte": window_start}}
    )
    if recent_count >= MAX_REQUESTS_PER_WINDOW:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=429,
            detail=f"Too many OTP requests. Try again in {REQUEST_WINDOW_MINUTES} minutes.",
        )

    # Invalidate any existing un-used codes for the same (email, purpose).
    await db.email_otps.update_many(
        {"email": email, "purpose": purpose, "used_at": None},
        {"$set": {"used_at": now_utc(), "invalidated": True}},
    )

    code = generate_code()
    doc = {
        "id": secrets.token_hex(16),
        "email": email,
        "user_id": user_id,
        "purpose": purpose,
        "code_hash": _hash_code(code),
        "attempts": 0,
        "used_at": None,
        "invalidated": False,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(minutes=OTP_TTL_MINUTES),
    }
    await db.email_otps.insert_one(doc)
    return code, doc


async def verify_otp(
    *,
    email: str,
    purpose: str,
    code: str,
) -> Optional[dict]:
    """Verify a code. Returns the OTP doc on success, raises HTTPException on failure.

    Side-effects:
      - increments `attempts` on failure
      - marks `used_at` on success
      - invalidates after MAX_ATTEMPTS exceeded
    """
    from fastapi import HTTPException

    email = email.lower()
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="OTP must be a 6-digit code")

    doc = await db.email_otps.find_one(
        {
            "email": email,
            "purpose": purpose,
            "used_at": None,
            "invalidated": False,
        },
        sort=[("created_at", -1)],
    )
    if not doc:
        raise HTTPException(status_code=400, detail="No active code — please request a new one")
    # Mongo strips tzinfo; re-attach UTC for safe comparison
    expires_at = doc["expires_at"]
    if expires_at.tzinfo is None:
        from datetime import timezone as _tz
        expires_at = expires_at.replace(tzinfo=_tz.utc)
    if expires_at < now_utc():
        await db.email_otps.update_one(
            {"id": doc["id"]}, {"$set": {"invalidated": True, "used_at": now_utc()}}
        )
        raise HTTPException(status_code=400, detail="Code expired — please request a new one")
    if doc["attempts"] >= MAX_ATTEMPTS:
        await db.email_otps.update_one(
            {"id": doc["id"]}, {"$set": {"invalidated": True, "used_at": now_utc()}}
        )
        raise HTTPException(status_code=429, detail="Too many wrong attempts — request a new code")

    if _hash_code(code) != doc["code_hash"]:
        await db.email_otps.update_one({"id": doc["id"]}, {"$inc": {"attempts": 1}})
        remaining = MAX_ATTEMPTS - (doc["attempts"] + 1)
        if remaining <= 0:
            raise HTTPException(status_code=429, detail="Too many wrong attempts — request a new code")
        raise HTTPException(status_code=400, detail=f"Wrong code. {remaining} attempts left.")

    await db.email_otps.update_one(
        {"id": doc["id"]}, {"$set": {"used_at": now_utc()}}
    )
    return doc


def render_otp_email_html(code: str, *, full_name: str, purpose: str) -> tuple[str, str]:
    """Returns (subject, html_body) for an OTP email."""
    label = {
        "login_2fa": "sign-in code",
        "enable_2fa": "code to enable two-factor authentication",
        "disable_2fa": "code to disable two-factor authentication",
    }.get(purpose, "verification code")
    subject = f"Your Allsale {label}: {code}"
    safe_name = full_name or "there"
    html = f"""<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;padding:32px 16px;color:#0f172a;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.05);">
        <h1 style="margin:0 0 8px;color:#7c3aed;font-size:22px;">Allsale verification</h1>
        <p style="margin:0 0 24px;color:#475569;font-size:14px;line-height:1.5;">
          Hi {safe_name}, here is your {label}. It expires in {OTP_TTL_MINUTES} minutes.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <div style="font-family:'SF Mono',Menlo,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#0f172a;">{code}</div>
        </div>
        <p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.5;">
          If you didn't request this code, ignore this email — no action is needed and your account stays safe.
        </p>
        <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;">
          Allsale · Indian Bazaar — shipped worldwide<br/>
          shop.allsale.co.nz
        </p>
      </div>
    </div>"""
    return subject, html
