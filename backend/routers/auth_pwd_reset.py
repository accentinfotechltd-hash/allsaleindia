"""Password reset + email verification flows.

  POST /api/auth/forgot-password   { email }       → 204 (silent — anti-enumeration)
  POST /api/auth/reset-password    { token, new_password } → 200 {ok:true}

Tokens are short-lived JWTs signed with JWT_SECRET (1h expiry, embeds 
user_id + token_version + scope='pwd_reset').  Sending one increments 
nothing — the token is stateless and self-validating.  Once used, the 
user's `token_version` is bumped which invalidates ALL existing JWTs 
(including the reset link if re-clicked, and any active sessions).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field

from config import JWT_ALG, JWT_SECRET
from db import db
from services.email import send_email
from utils import hash_password

logger = logging.getLogger("allsale.auth.pwd_reset")
router = APIRouter(tags=["auth"])

RESET_TOKEN_EXPIRY = timedelta(hours=1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _make_reset_token(user_id: str, token_version: int) -> str:
    payload = {
        "sub": user_id,
        "tv": int(token_version or 0),
        "scope": "pwd_reset",
        "iat": int(_now().timestamp()),
        "exp": int((_now() + RESET_TOKEN_EXPIRY).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _reset_link(token: str) -> str:
    """Build the reset link the user clicks in their email.

    Prefers the public site URL when available so emails work in production;
    falls back to a relative path for dev.
    """
    base = (
        os.getenv("PUBLIC_SITE_URL")
        or os.getenv("RESEND_DOMAIN_URL")
        or "https://shop.allsale.co.nz"
    )
    return f"{base.rstrip('/')}/reset-password?token={token}"


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------
class ForgotBody(BaseModel):
    email: EmailStr


class ResetBody(BaseModel):
    token: str = Field(..., min_length=10, max_length=2048)
    new_password: str = Field(..., min_length=8, max_length=128)


# ---------------------------------------------------------------------------
# POST /api/auth/forgot-password
# ---------------------------------------------------------------------------
@router.post("/auth/forgot-password", status_code=204)
async def forgot_password(body: ForgotBody):
    """Always returns 204 — never reveals whether the email exists
    (anti-enumeration).  Rate-limited via the existing brute-force gate."""
    email = body.email.lower().strip()

    user = await db.users.find_one({"email": email})
    if user:
        token = _make_reset_token(user["id"], user.get("token_version") or 0)
        link = _reset_link(token)
        html = (
            "<div style=\"font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;\">"
            "<h1 style=\"color:#0F172A;\">Reset your Allsale password</h1>"
            f"<p>Hi {user.get('full_name') or 'there'},</p>"
            "<p>We received a request to reset your password.  Click the button "
            "below to choose a new one.  This link is valid for the next hour.</p>"
            f"<p style=\"text-align:center;margin:32px 0;\"><a href=\"{link}\" "
            "style=\"background:#F97316;color:#fff;text-decoration:none;"
            "padding:14px 28px;border-radius:8px;font-weight:700;\">"
            "Reset password</a></p>"
            "<p style=\"color:#64748B;font-size:13px;\">If you didn't request this, "
            "you can safely ignore this email — your password won't change.</p>"
            f"<p style=\"color:#94A3B8;font-size:11px;word-break:break-all;\">Link: {link}</p>"
            "</div>"
        )
        try:
            send_email(
                to=email,
                subject="Reset your Allsale password",
                html=html,
                text=f"Reset your Allsale password: {link}\n\nValid for 1 hour.",
            )
        except Exception as exc:
            logger.warning("forgot-password email failed: %s", exc)

    return None


# ---------------------------------------------------------------------------
# POST /api/auth/reset-password
# ---------------------------------------------------------------------------
@router.post("/auth/reset-password")
async def reset_password(body: ResetBody):
    """Verify the reset token, update the password, and invalidate ALL
    existing sessions by bumping token_version."""
    try:
        payload = jwt.decode(body.token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=400, detail="Reset link is invalid or expired")
    if payload.get("scope") != "pwd_reset":
        raise HTTPException(status_code=400, detail="Wrong token type")
    user_id = payload.get("sub")
    tv = int(payload.get("tv") or 0)
    if not user_id:
        raise HTTPException(status_code=400, detail="Malformed token")

    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=400, detail="Account no longer exists")
    if int(user.get("token_version") or 0) != tv:
        # Token was issued before another reset/sign-out-all happened.
        raise HTTPException(status_code=400, detail="Link expired — request a new one")

    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {"password_hash": hash_password(body.new_password)},
            "$inc": {"token_version": 1},
        },
    )
    logger.info("Password reset completed for user=%s", user_id)
    return {"ok": True, "email": user["email"]}
