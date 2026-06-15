"""SSO bridge — accepts signed JWT from Seawind's allsale.co.nz classifieds site
and seamlessly logs the user into shop.allsale.co.nz.

Token contract Seawind must follow:
  Algorithm:  HS256
  Secret:     SSO_SHARED_SECRET (provided to Seawind out-of-band)
  TTL:        60 seconds max (replay protection)
  Claims:
    iss:   "allsale.co.nz"                    (issuer — must match SSO_ALLOWED_ISSUERS)
    aud:   "shop.allsale.co.nz"               (audience — fixed)
    sub:   "<seawind_user_id>"                (unique user id on classifieds site)
    email: "user@example.com"                 (required)
    name:  "Jane Doe"                         (optional)
    iat:   <unix timestamp>                   (issued-at)
    exp:   <unix timestamp + 60>              (must expire within 60s)
    jti:   "<unique-uuid>"                    (one-time-use; we cache to prevent replay)

Flow:
  User on classifieds clicks "Shop now" →
  Seawind generates JWT →
  Browser redirected to https://shop.allsale.co.nz/sso?token=<JWT>&next=/home →
  Our /sso frontend route POSTs to /api/auth/sso/callback →
  We validate the JWT, find/create the user, return an Allsale JWT
"""
from __future__ import annotations

import os
import time
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field

from db import db
from models import AuthResponse
from services.security import enforce_ip_rate_limit
from utils import create_token, now_utc, public_user

router = APIRouter(tags=["auth-sso"])

SSO_AUDIENCE = "shop.allsale.co.nz"
SSO_MAX_TTL_SECONDS = 60  # Reject tokens with longer than 60s lifetime
JTI_CACHE_TTL_SECONDS = 120  # Remember used jti's for 2× max TTL


class SsoCallbackRequest(BaseModel):
    token: str = Field(min_length=20, max_length=4096)


@router.post("/auth/sso/callback", response_model=AuthResponse)
async def sso_callback(body: SsoCallbackRequest, request: Request):
    """Validate a Seawind SSO JWT and return an Allsale access token."""
    await enforce_ip_rate_limit(request, "auth/sso", max_requests=20, window_seconds=60)

    secret = os.getenv("SSO_SHARED_SECRET")
    if not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail="SSO is not configured on this server")

    allowed_issuers = {
        s.strip() for s in (os.getenv("SSO_ALLOWED_ISSUERS") or "").split(",") if s.strip()
    }
    if not allowed_issuers:
        raise HTTPException(status_code=503, detail="No SSO issuers allowed")

    # 1) Decode + verify signature/aud/exp/iat
    try:
        payload = jwt.decode(
            body.token,
            secret,
            algorithms=["HS256"],
            audience=SSO_AUDIENCE,
            options={"require_aud": True, "require_exp": True, "require_iat": True, "require_sub": True},
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid SSO token: {e}")

    # 2) Issuer whitelist
    iss = payload.get("iss")
    if iss not in allowed_issuers:
        raise HTTPException(status_code=401, detail=f"SSO issuer not allowed: {iss}")

    # 3) Enforce short TTL — reject tokens that try to be valid for >60s
    iat = payload.get("iat")
    exp = payload.get("exp")
    if exp - iat > SSO_MAX_TTL_SECONDS:
        raise HTTPException(status_code=401, detail="SSO token TTL too long (max 60s)")
    if iat > int(time.time()) + 5:
        raise HTTPException(status_code=401, detail="SSO token issued in the future")

    # 4) Replay protection — jti must be unique
    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status_code=401, detail="SSO token missing jti")
    used = await db.sso_used_jtis.find_one({"jti": jti})
    if used:
        raise HTTPException(status_code=401, detail="SSO token already used (replay blocked)")

    # 5) Required claims
    email = (payload.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="SSO token missing email")
    seawind_user_id = payload.get("sub")
    full_name = (payload.get("name") or "").strip() or email.split("@", 1)[0]

    # 6) Find or create user
    user = await db.users.find_one({"email": email})
    if not user:
        import uuid
        user_doc = {
            "id": uuid.uuid4().hex,
            "email": email,
            "full_name": full_name,
            "country": "NZ",
            "auth_provider": "sso_seawind",
            "seawind_user_id": seawind_user_id,
            "email_verified": True,
            "created_at": now_utc(),
            "last_login_at": now_utc(),
            "two_factor_enabled": False,
        }
        await db.users.insert_one(user_doc)
        user = user_doc
    else:
        # Link Seawind ID if not already linked
        update = {"$set": {"last_login_at": now_utc()}}
        if not user.get("seawind_user_id"):
            update["$set"]["seawind_user_id"] = seawind_user_id
        await db.users.update_one({"id": user["id"]}, update)

    # 7) Mark jti as used (TTL-indexed)
    await db.sso_used_jtis.insert_one(
        {"jti": jti, "used_at": now_utc(), "expires_at": now_utc() + timedelta(seconds=JTI_CACHE_TTL_SECONDS)}
    )

    # 8) Issue Allsale JWT
    return AuthResponse(user=public_user(user), access_token=create_token(user["id"]))


@router.get("/auth/sso/healthcheck")
async def sso_healthcheck():
    """Pingable endpoint for Seawind to verify SSO is configured correctly.
    Returns 200 if secret is set, 503 if not — does not reveal the secret itself.
    """
    secret = os.getenv("SSO_SHARED_SECRET")
    return {
        "configured": bool(secret and len(secret) >= 32),
        "audience": SSO_AUDIENCE,
        "allowed_issuers": [
            s.strip() for s in (os.getenv("SSO_ALLOWED_ISSUERS") or "").split(",") if s.strip()
        ],
        "max_token_ttl_seconds": SSO_MAX_TTL_SECONDS,
        "algorithm": "HS256",
    }
