"""Biometric device-token authentication.

Pattern: After a successful email/password login on a trusted device, the
client calls `/auth/biometric/pair` to register an opaque long-lived device
token. The raw token is returned to the client ONCE and stored in
expo-secure-store behind a biometric prompt; the server keeps only its
SHA-256 hash. On subsequent app launches the client biometric-prompts,
retrieves the token, and exchanges it via `/auth/biometric/login` for a
fresh JWT.

Why hash + token_version:
  - Hashed storage limits damage from a DB leak.
  - `token_version_at_issue` is copied from the user row; when the user
    rotates password / triggers global logout the user's token_version is
    bumped, instantly invalidating every paired biometric device.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user
from utils import create_token

logger = logging.getLogger("allsale.biometric")
router = APIRouter(tags=["biometric-auth"])

BIOMETRIC_TOKEN_BYTES = 32          # 256 bits — 64 hex chars
BIOMETRIC_TOKEN_TTL_DAYS = 180      # device must re-pair after ~6 months
MAX_DEVICES_PER_USER = 5            # cap registered devices per user


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class BiometricPairRequest(BaseModel):
    device_name: Optional[str] = Field(default=None, max_length=80)
    platform: Optional[str] = Field(default=None, max_length=16)  # ios / android / web


class BiometricPairResponse(BaseModel):
    device_id: str
    device_token: str          # raw — client stores in SecureStore, never logged
    expires_in_days: int


class BiometricLoginRequest(BaseModel):
    device_id: str = Field(..., min_length=4, max_length=64)
    device_token: str = Field(..., min_length=8, max_length=128)


class BiometricLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class BiometricDeviceInfo(BaseModel):
    device_id: str
    device_name: Optional[str]
    platform: Optional[str]
    created_at: datetime
    last_used_at: Optional[datetime]
    revoked: bool


class BiometricRevokeRequest(BaseModel):
    device_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _generate_token() -> str:
    return secrets.token_hex(BIOMETRIC_TOKEN_BYTES)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# POST /api/auth/biometric/pair  — register this device
# ---------------------------------------------------------------------------
@router.post("/auth/biometric/pair", response_model=BiometricPairResponse, status_code=201)
async def pair_biometric_device(
    body: BiometricPairRequest,
    request: Request,
    current=Depends(get_current_user),
):
    user_id = current["id"]
    # Enforce per-user device cap (only count non-revoked, non-expired).
    now = _now()
    active = await db.biometric_devices.count_documents({
        "user_id": user_id,
        "revoked": False,
        "expires_at": {"$gt": now},
    })
    if active >= MAX_DEVICES_PER_USER:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "device_limit_reached",
                "message": (
                    f"You've reached the limit of {MAX_DEVICES_PER_USER} "
                    "biometric devices. Revoke an old device before pairing this one."
                ),
                "max_devices": MAX_DEVICES_PER_USER,
            },
        )

    raw = _generate_token()
    device_id = f"bdev_{uuid.uuid4().hex[:16]}"
    # token_version follows the same pattern as utils.create_token — fall back to 0.
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "token_version": 1})
    tv = int((user_doc or {}).get("token_version") or 0)

    doc = {
        "device_id": device_id,
        "user_id": user_id,
        "token_hash": _hash_token(raw),
        "device_name": (body.device_name or "").strip() or None,
        "platform": (body.platform or "").strip().lower() or None,
        "user_agent": (request.headers.get("user-agent") or "")[:200],
        "created_at": now,
        "last_used_at": None,
        "expires_at": now + timedelta(days=BIOMETRIC_TOKEN_TTL_DAYS),
        "revoked": False,
        "revoked_at": None,
        "token_version_at_issue": tv,
    }
    await db.biometric_devices.insert_one(doc)
    logger.info(
        "biometric device paired user=%s device=%s platform=%s",
        user_id, device_id, doc["platform"],
    )
    return BiometricPairResponse(
        device_id=device_id,
        device_token=raw,
        expires_in_days=BIOMETRIC_TOKEN_TTL_DAYS,
    )


# ---------------------------------------------------------------------------
# POST /api/auth/biometric/login  — exchange device token for JWT
# ---------------------------------------------------------------------------
@router.post("/auth/biometric/login", response_model=BiometricLoginResponse)
async def biometric_login(body: BiometricLoginRequest):
    token_hash = _hash_token(body.device_token)
    now = _now()

    device = await db.biometric_devices.find_one({
        "device_id": body.device_id,
        "token_hash": token_hash,
    })
    if not device:
        # Defensive: same error for "unknown device" and "wrong token" so a
        # caller can't enumerate device IDs.
        raise HTTPException(status_code=401, detail="Invalid biometric credentials")

    if device.get("revoked"):
        raise HTTPException(status_code=401, detail="This device has been revoked")

    expires_at = device.get("expires_at")
    if expires_at:
        # Mongo strips tzinfo on persisted datetimes; normalise both sides.
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            raise HTTPException(
                status_code=401,
                detail="Biometric token expired, please log in again",
            )

    user = await db.users.find_one({"id": device["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Account not found")
    if user.get("deleted_at"):
        raise HTTPException(status_code=401, detail="Account inactive")

    user_tv = int(user.get("token_version") or 0)
    if user_tv != int(device.get("token_version_at_issue") or 0):
        # Password rotated, global logout fired, etc. — kill this device.
        await db.biometric_devices.update_one(
            {"device_id": device["device_id"]},
            {"$set": {"revoked": True, "revoked_at": now, "revoke_reason": "token_version_bumped"}},
        )
        raise HTTPException(status_code=401, detail="Biometric login invalidated, please log in with password")

    await db.biometric_devices.update_one(
        {"device_id": device["device_id"]},
        {"$set": {"last_used_at": now}},
    )

    jwt = create_token(user["id"], token_version=user_tv)
    # Return a minimal public user payload (matches /auth/me shape).
    user_pub = {
        "id": user["id"],
        "email": user.get("email"),
        "full_name": user.get("full_name"),
        "picture": user.get("picture"),
        "provider": user.get("provider", "email"),
        "is_seller": bool(user.get("is_seller")),
        "seller_verified": bool(user.get("seller_verified")),
        "email_verified": bool(user.get("email_verified")),
        "country": user.get("country"),
        "currency": user.get("currency"),
        "seen_onboarding": bool(user.get("seen_onboarding")),
    }
    return BiometricLoginResponse(access_token=jwt, user=user_pub)


# ---------------------------------------------------------------------------
# GET /api/auth/biometric/devices  — list this user's paired devices
# ---------------------------------------------------------------------------
@router.get("/auth/biometric/devices", response_model=List[BiometricDeviceInfo])
async def list_biometric_devices(current=Depends(get_current_user)):
    out: List[BiometricDeviceInfo] = []
    async for doc in db.biometric_devices.find(
        {"user_id": current["id"]},
        {"_id": 0, "token_hash": 0, "user_agent": 0, "user_id": 0, "expires_at": 0,
         "revoked_at": 0, "revoke_reason": 0, "token_version_at_issue": 0},
    ).sort("created_at", -1):
        out.append(BiometricDeviceInfo(**doc))
    return out


# ---------------------------------------------------------------------------
# POST /api/auth/biometric/revoke  — revoke a single device
# ---------------------------------------------------------------------------
@router.post("/auth/biometric/revoke", status_code=200)
async def revoke_biometric_device(
    body: BiometricRevokeRequest,
    current=Depends(get_current_user),
):
    res = await db.biometric_devices.update_one(
        {"user_id": current["id"], "device_id": body.device_id, "revoked": False},
        {"$set": {"revoked": True, "revoked_at": _now(), "revoke_reason": "user"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found or already revoked")
    return {"ok": True, "device_id": body.device_id}


# ---------------------------------------------------------------------------
# DELETE /api/auth/biometric/all  — revoke ALL devices (panic button)
# ---------------------------------------------------------------------------
@router.delete("/auth/biometric/all", status_code=200)
async def revoke_all_biometric_devices(current=Depends(get_current_user)):
    res = await db.biometric_devices.update_many(
        {"user_id": current["id"], "revoked": False},
        {"$set": {"revoked": True, "revoked_at": _now(), "revoke_reason": "user_panic"}},
    )
    return {"ok": True, "revoked_count": int(res.modified_count)}
