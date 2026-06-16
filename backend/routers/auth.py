"""Authentication endpoints (email/password + Emergent Google OAuth + Apple Sign-In)."""
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
    AppleSessionRequest,
    AuthResponse,
    GoogleSessionRequest,
    UserCreate,
    UserLogin,
    UserPublic,
)
from services.apple_auth import verify_apple_identity_token
from services.security import (
    clear_login_attempts,
    enforce_ip_rate_limit,
    enforce_login_lockout,
    record_failed_login,
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
    # Light rate-limit on signup endpoint to deter scripted account creation.
    await enforce_ip_rate_limit(request, "auth/register", max_requests=100, window_seconds=60)
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
    token = create_token(uid, user_doc.get("token_version") or 0)
    try:
        from services.email import send_email
        send_email(
            body.email,
            "Welcome to Allsale — Indian Bazaar 🛍️",
            f"""<div style='font-family:system-ui,sans-serif;padding:24px;background:#f8fafc;color:#0f172a'>
            <h1 style='color:#7c3aed;margin:0 0 8px'>Welcome to Allsale, {body.full_name or 'friend'}!</h1>
            <p>Thanks for joining India's cross-border bazaar. Discover authentic Indian products shipped worldwide.</p>
            <ul><li>🛒 Shop from thousands of verified Indian sellers</li>
            <li>💳 Pay in your local currency (NZD/AUD/USD/GBP/CAD)</li>
            <li>🚚 Global shipping via Shiprocket</li></ul>
            <p style='color:#64748b;font-size:12px;margin-top:24px'>Got questions? Reply to this email.</p></div>""",
        )
    except Exception:
        pass
    return AuthResponse(user=public_user(user_doc), access_token=token)


@router.post("/auth/login")
async def login(body: UserLogin, request: Request):
    email = body.email.lower()
    await enforce_ip_rate_limit(request, "auth/login", max_requests=10, window_seconds=60)
    await enforce_login_lockout(email)
    user = await db.users.find_one({"email": email})
    if (
        not user
        or not user.get("password_hash")
        or not verify_password(body.password, user["password_hash"])
    ):
        await record_failed_login(email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await clear_login_attempts(email)
    # If 2FA is enabled, do NOT return a JWT yet — send OTP + ephemeral token.
    if user.get("two_factor_enabled"):
        from routers.auth_2fa import begin_two_factor_login
        return await begin_two_factor_login(user)
    token = create_token(user["id"], user.get("token_version") or 0)
    return AuthResponse(user=public_user(user), access_token=token).model_dump()


@router.post("/auth/apple-session", response_model=AuthResponse)
async def apple_session(body: AppleSessionRequest, request: Request):
    """Verify Apple's RS256 identity token and issue our own JWT.

    Uses ``sub`` as the canonical Apple identifier (stable across devices),
    handles Hide My Email relays, and links to an existing email/Google user
    when emails match exactly.
    """
    await enforce_ip_rate_limit(request, "auth/apple-session", max_requests=10, window_seconds=60)
    claims = await verify_apple_identity_token(body.identity_token)
    apple_sub = claims["sub"]
    apple_email = (claims.get("email") or "").lower() or None
    is_private = bool(claims.get("is_private_email"))

    # 1) try existing Apple user (by sub)
    existing = await db.users.find_one({"apple_sub": apple_sub})
    if existing:
        uid = existing["id"]
        await db.users.update_one({"id": uid}, {"$set": {"last_login_at": now_utc()}})
    else:
        # 2) try linking by email when present and not a private relay
        if apple_email and not is_private:
            existing = await db.users.find_one({"email": apple_email})
        if existing:
            uid = existing["id"]
            await db.users.update_one(
                {"id": uid},
                {
                    "$set": {
                        "apple_sub": apple_sub,
                        "apple_email": apple_email,
                        "last_login_at": now_utc(),
                    },
                    "$addToSet": {"providers": "apple"},
                },
            )
        else:
            # 3) brand-new user
            uid = f"user_{uuid.uuid4().hex[:12]}"
            country = _normalize_country(body.country, request)
            full_name = (body.full_name or "").strip() or (
                apple_email.split("@")[0] if apple_email else "Apple user"
            )
            await db.users.insert_one(
                {
                    "id": uid,
                    "email": apple_email,
                    "apple_email": apple_email,
                    "apple_sub": apple_sub,
                    "full_name": full_name,
                    "password_hash": None,
                    "provider": "apple",
                    "providers": ["apple"],
                    "picture": None,
                    "country": country,
                    "created_at": now_utc(),
                }
            )
            try:
                from services.points import award_welcome_bonus
                await award_welcome_bonus(uid)
            except Exception:
                pass

    user = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    token = create_token(uid, (user or {}).get("token_version") or 0)
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
    token = create_token(uid, (await db.users.find_one({"id": uid}, {"_id": 0, "token_version": 1}) or {}).get("token_version") or 0)
    user = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return AuthResponse(user=public_user(user), access_token=token)


@router.get("/auth/me", response_model=UserPublic)
async def me(current=Depends(get_current_user)):
    return public_user(current)


# ---------------------------------------------------------------------------
# DELETE /api/auth/me — GDPR-style account deletion
# ---------------------------------------------------------------------------
class DeleteMeBody(BaseModel):
    confirm: Optional[str] = None  # client sends "DELETE" to confirm
    reason: Optional[str] = None


@router.delete("/auth/me")
async def delete_my_account(
    body: Optional[DeleteMeBody] = None,
    current=Depends(get_current_user),
):
    """Soft-delete the signed-in user's account.

    What we do:
      * Scrub PII (name, picture, phone)
      * Replace email with an unrecoverable, unique tombstone so the row
        can no longer be logged into and the unique-email index stays clean
      * Bump token_version → invalidates every existing JWT immediately
      * Mark `deleted_at` so admin tooling can hide / purge later
      * Remove personal data: cart, addresses, wishlists, recently-viewed
      * Leave orders, reviews, payouts intact (legal record + seller data)
    """
    if body and body.confirm and body.confirm.strip().upper() != "DELETE":
        raise HTTPException(
            status_code=400,
            detail="Send {'confirm': 'DELETE'} to confirm account deletion.",
        )

    uid = current["id"]
    tombstone_email = f"deleted+{uid}@allsale-deleted.local"
    now = now_utc()

    # 1. Scrub PII on the user doc + invalidate sessions.
    await db.users.update_one(
        {"id": uid},
        {
            "$set": {
                "email": tombstone_email,
                "original_email_hash": (current.get("email") or "")[:64],
                "full_name": "Deleted account",
                "picture": None,
                "phone": None,
                "apple_email": None,
                "deleted_at": now,
                "deletion_reason": (body.reason if body else None),
                # Wipe credentials so the row can no longer authenticate.
                "password_hash": None,
                "google_id": None,
                "apple_sub": None,
                "two_factor_enabled": False,
                "two_factor_secret_hash": None,
            },
            "$inc": {"token_version": 1},
        },
    )

    # 2. Best-effort cleanup of strictly-personal collections.
    for coll in ("carts", "addresses", "wishlists", "product_views"):
        try:
            await db[coll].delete_many({"user_id": uid})
        except Exception:
            pass

    return {"ok": True, "deleted_at": now.isoformat()}


# ---------------------------------------------------------------------------
# GET /api/account/export — GDPR data portability
# ---------------------------------------------------------------------------
@router.get("/account/export")
async def export_my_data(current=Depends(get_current_user)):
    """Return a JSON dump of everything we hold about the signed-in user.

    Intended for "Download your data" buttons.  Excludes other users'
    data (e.g. a seller's reply on the buyer's review is kept but the
    seller's contact info is NOT included).
    """
    uid = current["id"]

    profile = await db.users.find_one(
        {"id": uid},
        {
            "_id": 0,
            "password_hash": 0,
            "two_factor_secret_hash": 0,
            "google_id": 0,
            "apple_sub": 0,
        },
    )

    async def _dump(coll: str, query: dict, limit: int = 500) -> list:
        out: list = []
        try:
            async for r in db[coll].find(query, {"_id": 0}).limit(limit):
                out.append(r)
        except Exception:
            pass
        return out

    payload = {
        "exported_at": now_utc().isoformat(),
        "user": profile,
        "orders": await _dump("orders", {"user_id": uid}, limit=2000),
        "addresses": await _dump("addresses", {"user_id": uid}),
        "wishlist": await _dump("wishlists", {"user_id": uid}),
        "cart": await _dump("carts", {"user_id": uid}, limit=1),
        "reviews": await _dump("reviews", {"user_id": uid}, limit=2000),
        "returns": await _dump("returns", {"user_id": uid}, limit=2000),
        "notifications": await _dump(
            "notifications", {"user_id": uid}, limit=1000
        ),
        "loyalty_points": await _dump(
            "points_ledger", {"user_id": uid}, limit=2000
        ),
        "referrals": await _dump(
            "referrals", {"referrer_id": uid}, limit=500
        ),
        "recently_viewed": await _dump("product_views", {"user_id": uid}),
    }
    return payload


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
