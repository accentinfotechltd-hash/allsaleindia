"""Email verification flow.

  POST /api/auth/verify-email/request   (auth)         → 204
       sends a tokenised link to the user's email.

  POST /api/auth/verify-email           { token }      → { ok, email }
       consumes the token and flips `email_verified=true`.

  GET  /api/auth/verify-email/status    (auth)         → { email_verified, email }

Tokens are short-lived (24h) JWTs signed with JWT_SECRET, embedding
scope='email_verify' so they can never be confused with login or password
reset tokens.  The token is stateless — no DB row is created when it is
issued — and is marked consumed by simply setting `email_verified` true.

The route is REST-friendly (`POST /api/auth/verify-email`) so the web
agent can fire it from the link landing page without needing extra
suffixes.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel, Field

from config import JWT_ALG, JWT_SECRET
from db import db
from deps import get_current_user
from services.email import send_email

logger = logging.getLogger("allsale.auth.email_verify")
router = APIRouter(tags=["auth"])

VERIFY_TOKEN_EXPIRY = timedelta(hours=24)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _make_verify_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email.lower(),
        "scope": "email_verify",
        "iat": int(_now().timestamp()),
        "exp": int((_now() + VERIFY_TOKEN_EXPIRY).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _verify_link(token: str) -> str:
    base = (
        os.getenv("PUBLIC_SITE_URL")
        or os.getenv("RESEND_DOMAIN_URL")
        or "https://shop.allsale.co.nz"
    )
    return f"{base.rstrip('/')}/verify-email?token={token}"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class VerifyBody(BaseModel):
    """Accepts the token under any of the common field names the web /
    mobile clients might send: `token`, `verification_token`, or `code`.
    """

    token: Optional[str] = Field(default=None, min_length=10, max_length=2048)
    verification_token: Optional[str] = Field(
        default=None, min_length=10, max_length=2048
    )
    code: Optional[str] = Field(default=None, min_length=10, max_length=2048)

    def first(self) -> Optional[str]:
        return self.token or self.verification_token or self.code


# ---------------------------------------------------------------------------
# POST /api/auth/verify-email/request   (auth)
# Also aliased as:
#   POST /api/auth/email/send-verification
#   POST /api/auth/resend-verification
# ---------------------------------------------------------------------------
@router.post("/auth/verify-email/request", status_code=204)
@router.post("/auth/email/send-verification", status_code=204)
@router.post("/auth/resend-verification", status_code=204)
async def request_verification(current=Depends(get_current_user)):
    """Email the signed-in user a verification link.

    Always returns 204.  If the user is already verified, the email is
    still sent (idempotent UX — let the user click & confirm).
    """
    email = (current.get("email") or "").lower().strip()
    if not email:
        # Apple Hide-My-Email accounts without an email cannot verify.
        raise HTTPException(
            status_code=400,
            detail="No email on file to verify. Add one in account settings first.",
        )

    token = _make_verify_token(current["id"], email)
    link = _verify_link(token)
    name = current.get("full_name") or "there"

    html = (
        "<div style=\"font-family:system-ui,-apple-system,sans-serif;"
        "max-width:520px;margin:0 auto;\">"
        "<h1 style=\"color:#0F172A;\">Confirm your email</h1>"
        f"<p>Hi {name},</p>"
        "<p>Tap the button below to confirm this is your email address.  "
        "The link is valid for the next 24 hours.</p>"
        f"<p style=\"text-align:center;margin:32px 0;\"><a href=\"{link}\" "
        "style=\"background:#F97316;color:#fff;text-decoration:none;"
        "padding:14px 28px;border-radius:8px;font-weight:700;\">"
        "Verify email</a></p>"
        "<p style=\"color:#64748B;font-size:13px;\">If you didn't request "
        "this, you can ignore the email — nothing will change.</p>"
        f"<p style=\"color:#94A3B8;font-size:11px;word-break:break-all;\">"
        f"Link: {link}</p>"
        "</div>"
    )
    try:
        send_email(
            to=email,
            subject="Verify your Allsale email",
            html=html,
            text=f"Verify your Allsale email: {link}\n\nValid for 24 hours.",
        )
    except Exception as exc:
        logger.warning("verify-email send failed: %s", exc)
    return None


# ---------------------------------------------------------------------------
# POST /api/auth/verify-email   { token }
# Also aliased as:
#   POST /api/auth/email/verify
# ---------------------------------------------------------------------------
@router.post("/auth/verify-email")
@router.post("/auth/email/verify")
async def confirm_verification(body: VerifyBody):
    """Consume a verification token and mark the user's email as verified."""
    raw = body.first()
    if not raw:
        raise HTTPException(
            status_code=400,
            detail="Provide the verification token in 'token', "
            "'verification_token', or 'code'.",
        )
    try:
        payload = jwt.decode(raw, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(
            status_code=400, detail="Verification link is invalid or expired"
        )
    if payload.get("scope") != "email_verify":
        raise HTTPException(status_code=400, detail="Wrong token type")
    user_id = payload.get("sub")
    email_in_token = (payload.get("email") or "").lower() or None
    if not user_id:
        raise HTTPException(status_code=400, detail="Malformed token")

    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="Account no longer exists")

    # If the email changed since the token was issued, refuse.
    current_email = (user.get("email") or "").lower() or None
    if email_in_token and current_email and email_in_token != current_email:
        raise HTTPException(
            status_code=400,
            detail="Email changed since this link was sent — request a new one",
        )

    if not user.get("email_verified"):
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"email_verified": True, "email_verified_at": _now()}},
        )
        logger.info("Email verified for user=%s", user_id)

    return {
        "ok": True,
        "email": current_email,
        "email_verified": True,
    }


# ---------------------------------------------------------------------------
# GET /api/auth/verify-email/status (auth) — convenience for the UI
# ---------------------------------------------------------------------------
@router.get("/auth/verify-email/status")
async def verification_status(current=Depends(get_current_user)):
    return {
        "email": (current.get("email") or "").lower() or None,
        "email_verified": bool(current.get("email_verified")),
    }
