"""Authentication endpoints (email/password + Emergent Google OAuth)."""
from __future__ import annotations

import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from config import COUNTRY_CODES, DEFAULT_COUNTRY
from db import db
from deps import get_current_user
from models import (
    AuthResponse,
    GoogleSessionRequest,
    UserCreate,
    UserLogin,
    UserPublic,
)
from utils import create_token, hash_password, now_utc, public_user, verify_password

router = APIRouter(tags=["auth"])


def _normalize_country(value: Optional[str], request: Request) -> str:
    """Best-effort country resolution: explicit body > proxy header > default."""
    candidate = (value or "").strip().upper()
    if candidate in COUNTRY_CODES:
        return candidate
    raw = (
        request.headers.get("cf-ipcountry")
        or request.headers.get("x-country")
        or request.headers.get("x-vercel-ip-country")
        or ""
    ).upper()
    return raw if raw in COUNTRY_CODES else DEFAULT_COUNTRY


@router.post("/auth/register", response_model=AuthResponse)
async def register(body: UserCreate, request: Request):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "id": uid,
        "email": email,
        "full_name": body.full_name.strip(),
        "password_hash": hash_password(body.password),
        "provider": "email",
        "picture": None,
        "country": _normalize_country(body.country, request),
        "created_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    # Welcome bonus loyalty points (best-effort)
    try:
        from services.points import award_welcome_bonus
        await award_welcome_bonus(uid)
    except Exception:
        pass
    # Referral processing (best-effort, +100 to new user if valid)
    if body.referral_code:
        try:
            from services.referrals import register_referral
            await register_referral(uid, body.full_name, body.referral_code)
        except Exception:
            pass
    # Generate own referral code immediately (idempotent)
    try:
        from services.referrals import ensure_referral_code
        await ensure_referral_code(uid)
    except Exception:
        pass
    token = create_token(uid)
    return AuthResponse(user=public_user(user_doc), access_token=token)


@router.post("/auth/login", response_model=AuthResponse)
async def login(body: UserLogin):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if (
        not user
        or not user.get("password_hash")
        or not verify_password(body.password, user["password_hash"])
    ):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"])
    return AuthResponse(user=public_user(user), access_token=token)


@router.post("/auth/google-session", response_model=AuthResponse)
async def google_session(body: GoogleSessionRequest):
    """Exchange an Emergent `session_id` for our own JWT."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired Google session")
    data = r.json()
    email = (data.get("email") or "").lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    if not email:
        raise HTTPException(status_code=400, detail="Google profile missing email")

    existing = await db.users.find_one({"email": email})
    if existing:
        uid = existing["id"]
        await db.users.update_one(
            {"id": uid},
            {
                "$set": {
                    "full_name": existing.get("full_name") or name,
                    "picture": picture,
                    "last_login_at": now_utc(),
                }
            },
        )
    else:
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "id": uid,
                "email": email,
                "full_name": name,
                "password_hash": None,
                "provider": "google",
                "picture": picture,
                "created_at": now_utc(),
            }
        )
        try:
            from services.points import award_welcome_bonus
            await award_welcome_bonus(uid)
        except Exception:
            pass
    token = create_token(uid)
    user = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return AuthResponse(user=public_user(user), access_token=token)


@router.get("/auth/me", response_model=UserPublic)
async def me(current=Depends(get_current_user)):
    return public_user(current)


class CountryUpdate(BaseModel):
    country: str


@router.post("/auth/country", response_model=UserPublic)
async def update_country(body: CountryUpdate, current=Depends(get_current_user)):
    """Update the signed-in user's country (and therefore currency)."""
    code = (body.country or "").strip().upper()
    if code not in COUNTRY_CODES:
        raise HTTPException(status_code=400, detail=f"Unsupported country: {body.country}")
    await db.users.update_one({"id": current["id"]}, {"$set": {"country": code}})
    fresh = await db.users.find_one(
        {"id": current["id"]}, {"_id": 0, "password_hash": 0}
    )
    return public_user(fresh)
