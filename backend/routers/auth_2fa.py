"""Email OTP 2FA endpoints.

Flow:
  Login phase 1: POST /api/auth/login → if user.two_factor_enabled is True,
                 returns {requires_2fa: true, ephemeral_token: "..."}; otherwise
                 returns AuthResponse normally.
  Login phase 2: POST /api/auth/2fa/login-verify  {ephemeral_token, code}
                 → AuthResponse with real JWT.

Toggle:
  POST /api/auth/2fa/request-enable   (auth required)
  POST /api/auth/2fa/confirm-enable   {code}           (auth required)
  POST /api/auth/2fa/request-disable  (auth required)
  POST /api/auth/2fa/confirm-disable  {code}           (auth required)
"""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import JWTError, jwt
from pydantic import BaseModel, Field

from config import JWT_ALG, JWT_SECRET
from db import db
from deps import get_current_user
from models import AuthResponse
from services.email import send_email
from services.otp import (
    EPHEMERAL_TTL_MINUTES,
    issue_otp,
    render_otp_email_html,
    verify_otp,
)
from services.security import enforce_ip_rate_limit
from utils import create_token, now_utc, public_user

router = APIRouter(tags=["auth-2fa"])


# ---------- Schemas ----------


class LoginVerifyRequest(BaseModel):
    ephemeral_token: str
    code: str = Field(min_length=6, max_length=6)


class CodeOnlyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class TwoFactorStatus(BaseModel):
    two_factor_enabled: bool
    masked_email: str


# ---------- Ephemeral token helpers ----------


_EPHEMERAL_AUDIENCE = "2fa-login"


def _issue_ephemeral_token(user_id: str) -> str:
    """Short-lived signed token used only between password-step and OTP-step."""
    payload = {
        "sub": user_id,
        "aud": _EPHEMERAL_AUDIENCE,
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(minutes=EPHEMERAL_TTL_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _decode_ephemeral_token(token: str) -> str:
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALG],
            audience=_EPHEMERAL_AUDIENCE,
            options={"require_aud": True},
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired 2FA session — please log in again")
    uid = payload.get("sub")
    if not uid or payload.get("aud") != _EPHEMERAL_AUDIENCE:
        raise HTTPException(status_code=401, detail="Invalid 2FA session")
    return uid


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "your email"
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        masked = local[0] + "*"
    else:
        masked = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked}@{domain}"


# ---------- Internal helper (used by /auth/login) ----------


async def begin_two_factor_login(user: dict) -> dict:
    """Send login OTP & return the partial response shape used by /auth/login."""
    code, _ = await issue_otp(
        email=user["email"],
        user_id=user["id"],
        purpose="login_2fa",
    )
    subject, html = render_otp_email_html(
        code, full_name=user.get("full_name") or "", purpose="login_2fa"
    )
    send_email(user["email"], subject, html)
    return {
        "requires_2fa": True,
        "ephemeral_token": _issue_ephemeral_token(user["id"]),
        "masked_email": _mask_email(user["email"]),
        "ttl_minutes": EPHEMERAL_TTL_MINUTES,
    }


# ---------- Endpoints ----------


@router.post("/auth/2fa/login-verify", response_model=AuthResponse)
async def login_verify(body: LoginVerifyRequest, request: Request):
    """Phase 2 of 2FA login — exchange ephemeral_token + code for a real JWT."""
    await enforce_ip_rate_limit(request, "auth/2fa/login-verify", max_requests=10, window_seconds=60)
    uid = _decode_ephemeral_token(body.ephemeral_token)
    user = await db.users.find_one({"id": uid})
    if not user:
        raise HTTPException(status_code=401, detail="Account not found")
    if not user.get("two_factor_enabled"):
        # User disabled 2FA between phase 1 and phase 2 — fail closed.
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled on this account")
    await verify_otp(email=user["email"], purpose="login_2fa", code=body.code)
    await db.users.update_one({"id": uid}, {"$set": {"last_login_at": now_utc()}})
    return AuthResponse(user=public_user(user), access_token=create_token(uid, user.get("token_version") or 0))


@router.get("/auth/2fa/status", response_model=TwoFactorStatus)
async def status(current=Depends(get_current_user)):
    return TwoFactorStatus(
        two_factor_enabled=bool(current.get("two_factor_enabled")),
        masked_email=_mask_email(current.get("email") or ""),
    )


@router.post("/auth/2fa/request-enable")
async def request_enable(request: Request, current=Depends(get_current_user)):
    await enforce_ip_rate_limit(request, "auth/2fa/request-enable", max_requests=5, window_seconds=60)
    if current.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
    if not current.get("email"):
        raise HTTPException(status_code=400, detail="No email on file — add one before enabling 2FA")
    code, _ = await issue_otp(
        email=current["email"], user_id=current["id"], purpose="enable_2fa"
    )
    subject, html = render_otp_email_html(
        code, full_name=current.get("full_name") or "", purpose="enable_2fa"
    )
    send_email(current["email"], subject, html)
    return {"sent": True, "masked_email": _mask_email(current["email"])}


@router.post("/auth/2fa/confirm-enable", response_model=TwoFactorStatus)
async def confirm_enable(body: CodeOnlyRequest, current=Depends(get_current_user)):
    if current.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is already enabled")
    await verify_otp(email=current["email"], purpose="enable_2fa", code=body.code)
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"two_factor_enabled": True, "two_factor_enabled_at": now_utc()}},
    )
    # Best-effort confirmation email
    try:
        send_email(
            current["email"],
            "Two-factor authentication is now ON 🔒",
            f"""<div style="font-family:-apple-system,sans-serif;padding:24px;background:#f8fafc;color:#0f172a">
            <h2 style="color:#10b981;margin:0 0 8px">2FA is now enabled</h2>
            <p>From now on, you'll need a code from this email address to sign in to Allsale. Your account is more secure.</p>
            <p style="color:#94a3b8;font-size:12px;margin-top:24px">If this wasn't you, reply to this email immediately.</p></div>""",
        )
    except Exception:
        pass
    return TwoFactorStatus(
        two_factor_enabled=True, masked_email=_mask_email(current["email"])
    )


@router.post("/auth/2fa/request-disable")
async def request_disable(request: Request, current=Depends(get_current_user)):
    await enforce_ip_rate_limit(request, "auth/2fa/request-disable", max_requests=5, window_seconds=60)
    if not current.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    code, _ = await issue_otp(
        email=current["email"], user_id=current["id"], purpose="disable_2fa"
    )
    subject, html = render_otp_email_html(
        code, full_name=current.get("full_name") or "", purpose="disable_2fa"
    )
    send_email(current["email"], subject, html)
    return {"sent": True, "masked_email": _mask_email(current["email"])}


@router.post("/auth/2fa/confirm-disable", response_model=TwoFactorStatus)
async def confirm_disable(body: CodeOnlyRequest, current=Depends(get_current_user)):
    if not current.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    await verify_otp(email=current["email"], purpose="disable_2fa", code=body.code)
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"two_factor_enabled": False}, "$unset": {"two_factor_enabled_at": ""}},
    )
    try:
        send_email(
            current["email"],
            "Two-factor authentication was turned off",
            """<div style="font-family:-apple-system,sans-serif;padding:24px;background:#fef2f2;color:#0f172a">
            <h2 style="color:#dc2626;margin:0 0 8px">2FA disabled</h2>
            <p>Two-factor authentication has been turned off on your Allsale account.</p>
            <p>If you didn't do this, reply to this email immediately — your account may be compromised.</p></div>""",
        )
    except Exception:
        pass
    return TwoFactorStatus(
        two_factor_enabled=False, masked_email=_mask_email(current["email"])
    )


@router.post("/auth/2fa/resend")
async def resend_login_code(body: dict, request: Request):
    """Resend the login OTP using the ephemeral token (no auth required)."""
    await enforce_ip_rate_limit(request, "auth/2fa/resend", max_requests=5, window_seconds=60)
    token = (body or {}).get("ephemeral_token") or ""
    uid = _decode_ephemeral_token(token)
    user = await db.users.find_one({"id": uid})
    if not user or not user.get("two_factor_enabled"):
        raise HTTPException(status_code=400, detail="2FA not active for this session")
    code, _ = await issue_otp(email=user["email"], user_id=uid, purpose="login_2fa")
    subject, html = render_otp_email_html(
        code, full_name=user.get("full_name") or "", purpose="login_2fa"
    )
    send_email(user["email"], subject, html)
    return {"sent": True, "masked_email": _mask_email(user["email"])}
