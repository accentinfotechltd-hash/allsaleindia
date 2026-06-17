"""Seller personal profile / settings.

Lets an approved (or onboarding) seller manage their storefront identity,
contact info, payout bank details, vacation mode, shipping handling time,
notification preferences, plus password & session controls.

All endpoints live under ``/api/seller/profile/...``.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator

from db import db
from deps import get_current_user
from utils import (
    create_token,
    hash_password,
    now_utc,
    verify_password,
)


router = APIRouter(tags=["seller"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class NotificationPrefs(BaseModel):
    new_order_email: bool = True
    new_order_inapp: bool = True
    return_request_email: bool = True
    return_request_inapp: bool = True
    payout_email: bool = True
    payout_inapp: bool = True
    low_stock_email: bool = False
    low_stock_inapp: bool = True


_DEFAULT_PREFS = NotificationPrefs().model_dump()


class SellerProfileSettings(BaseModel):
    # Read-only identity
    user_id: str
    email: EmailStr
    company_name: str
    verification_status: str

    # Editable — storefront identity
    store_display_name: Optional[str] = None
    store_logo_url: Optional[str] = None
    store_banner_url: Optional[str] = None
    store_bio: Optional[str] = None

    # Editable — contact & support
    contact_name: str
    contact_phone: str
    support_email: Optional[EmailStr] = None

    # Editable — business address (mirrors KYC, edits flag review)
    address_line1: str
    address_line2: Optional[str] = ""
    city: str
    state: str
    pincode: str

    # Payout (display only — Stripe Connect handles real flow)
    bank_holder_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_account_last4: Optional[str] = None  # last 4 digits only

    # Operational
    vacation_mode: bool = False
    vacation_until: Optional[datetime] = None
    vacation_message: Optional[str] = None
    shipping_handling_days: int = 2

    # Notification prefs
    notification_prefs: NotificationPrefs = Field(default_factory=NotificationPrefs)


class SellerProfileUpdate(BaseModel):
    store_display_name: Optional[str] = Field(default=None, max_length=80)
    store_logo_url: Optional[str] = Field(default=None, max_length=2000)
    store_banner_url: Optional[str] = Field(default=None, max_length=2000)
    store_bio: Optional[str] = Field(default=None, max_length=300)

    contact_name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    contact_phone: Optional[str] = Field(default=None, min_length=6, max_length=20)
    support_email: Optional[EmailStr] = None

    address_line1: Optional[str] = Field(default=None, min_length=2, max_length=120)
    address_line2: Optional[str] = Field(default=None, max_length=120)
    city: Optional[str] = Field(default=None, min_length=2, max_length=60)
    state: Optional[str] = Field(default=None, min_length=2, max_length=60)
    pincode: Optional[str] = Field(default=None, min_length=6, max_length=6)

    # Bank details — only last 4 digits stored
    bank_holder_name: Optional[str] = Field(default=None, max_length=120)
    bank_name: Optional[str] = Field(default=None, max_length=80)
    bank_ifsc: Optional[str] = Field(default=None, min_length=11, max_length=11)
    bank_account_number: Optional[str] = Field(
        default=None,
        min_length=4,
        max_length=20,
        description="Full account number — only last 4 digits will be stored",
    )

    vacation_mode: Optional[bool] = None
    vacation_until: Optional[datetime] = None
    vacation_message: Optional[str] = Field(default=None, max_length=200)
    shipping_handling_days: Optional[int] = Field(default=None, ge=1, le=7)

    notification_prefs: Optional[NotificationPrefs] = None

    @field_validator("pincode")
    @classmethod
    def _digits(cls, v):
        if v is not None and not v.isdigit():
            raise ValueError("Pincode must be 6 digits")
        return v

    @field_validator("bank_ifsc")
    @classmethod
    def _ifsc(cls, v):
        if v is not None and not re.match(r"^[A-Z]{4}0[A-Z0-9]{6}$", v.upper()):
            raise ValueError("Invalid IFSC format (e.g. SBIN0001234)")
        return v.upper() if v else v


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def _strong(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one number")
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _load_settings(user: dict) -> dict:
    profile = await db.sellers.find_one({"user_id": user["id"]}, {"_id": 0}) or {}
    prefs_doc = profile.get("notification_prefs") or {}
    prefs = {**_DEFAULT_PREFS, **{k: v for k, v in prefs_doc.items() if k in _DEFAULT_PREFS}}
    return {
        "user_id": user["id"],
        "email": user.get("email"),
        "company_name": profile.get("company_name") or user.get("full_name") or "",
        "verification_status": profile.get("verification_status")
        or user.get("seller_verification_status")
        or "pending_documents",
        "store_display_name": profile.get("store_display_name"),
        "store_logo_url": profile.get("store_logo_url"),
        "store_banner_url": profile.get("store_banner_url"),
        "store_bio": profile.get("store_bio"),
        "contact_name": profile.get("contact_name") or user.get("full_name") or "",
        "contact_phone": profile.get("contact_phone") or "",
        "support_email": profile.get("support_email"),
        "address_line1": profile.get("address_line1") or "",
        "address_line2": profile.get("address_line2") or "",
        "city": profile.get("city") or "",
        "state": profile.get("state") or "",
        "pincode": profile.get("pincode") or "",
        "bank_holder_name": profile.get("bank_holder_name"),
        "bank_name": profile.get("bank_name"),
        "bank_ifsc": profile.get("bank_ifsc"),
        "bank_account_last4": profile.get("bank_account_last4"),
        "vacation_mode": bool(profile.get("vacation_mode", False)),
        "vacation_until": profile.get("vacation_until"),
        "vacation_message": profile.get("vacation_message"),
        "shipping_handling_days": int(profile.get("shipping_handling_days") or 2),
        "notification_prefs": prefs,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/seller/profile/settings", response_model=SellerProfileSettings)
async def get_settings(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    data = await _load_settings(current)
    return SellerProfileSettings(**data)


@router.patch("/seller/profile/settings", response_model=SellerProfileSettings)
async def update_settings(
    body: SellerProfileUpdate, current=Depends(get_current_user)
):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    updates: dict = {}
    address_changed = False
    address_fields = {"address_line1", "address_line2", "city", "state", "pincode"}

    raw = body.model_dump(exclude_unset=True, exclude_none=False)

    # Handle bank account separately — store only last 4
    if "bank_account_number" in raw:
        acct = (raw.pop("bank_account_number") or "").strip()
        if acct:
            if not acct.isdigit():
                raise HTTPException(
                    status_code=400, detail="Bank account number must be digits only"
                )
            updates["bank_account_last4"] = acct[-4:]
        else:
            updates["bank_account_last4"] = None

    # Notification prefs — merge with existing defaults
    if "notification_prefs" in raw:
        prefs = raw.pop("notification_prefs")
        if prefs is not None:
            updates["notification_prefs"] = {**_DEFAULT_PREFS, **prefs}

    for key, value in raw.items():
        if value is None and key not in {
            "vacation_until",
            "vacation_message",
            "support_email",
            "store_bio",
            "store_logo_url",
            "store_banner_url",
            "store_display_name",
            "address_line2",
        }:
            # Skip None for required fields, but allow explicit nulls for optionals
            continue
        if isinstance(value, str):
            value = value.strip() or None
        if key in address_fields:
            existing_profile = await db.sellers.find_one(
                {"user_id": current["id"]}, {key: 1, "_id": 0}
            ) or {}
            if existing_profile.get(key) and value and existing_profile.get(key) != value:
                address_changed = True
        updates[key] = value

    if not updates:
        # Nothing to write — just return current state.
        data = await _load_settings(current)
        return SellerProfileSettings(**data)

    updates["updated_at"] = now_utc()

    # If address changed for an approved seller, drop them back to pending_review.
    if address_changed and current.get("seller_verification_status") in {
        "approved",
        "auto_verified",
    }:
        updates["verification_status"] = "pending_review"
        updates["submitted_at"] = now_utc()
        await db.users.update_one(
            {"id": current["id"]},
            {"$set": {"seller_verification_status": "pending_review"}},
        )

    await db.sellers.update_one(
        {"user_id": current["id"]},
        {
            "$set": updates,
            "$setOnInsert": {
                "user_id": current["id"],
                "created_at": now_utc(),
            },
        },
        upsert=True,
    )

    fresh_user = await db.users.find_one({"id": current["id"]}, {"_id": 0}) or current
    data = await _load_settings(fresh_user)
    return SellerProfileSettings(**data)


@router.post("/seller/profile/password")
async def change_password(
    body: PasswordChangeRequest, current=Depends(get_current_user)
):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("provider") and current.get("provider") != "email":
        raise HTTPException(
            status_code=400,
            detail="Password is managed by your Google / Apple sign-in provider",
        )
    user_doc = await db.users.find_one({"id": current["id"]})
    if not user_doc or not user_doc.get("password_hash"):
        raise HTTPException(status_code=400, detail="No password set for this account")
    if not verify_password(body.current_password, user_doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if verify_password(body.new_password, user_doc["password_hash"]):
        raise HTTPException(
            status_code=400, detail="New password must be different from current"
        )
    new_tv = int(user_doc.get("token_version") or 0) + 1
    await db.users.update_one(
        {"id": current["id"]},
        {
            "$set": {
                "password_hash": hash_password(body.new_password),
                "password_changed_at": now_utc(),
                "token_version": new_tv,
            }
        },
    )
    new_token = create_token(current["id"], token_version=new_tv)
    return {"ok": True, "access_token": new_token, "token_type": "bearer"}


@router.post("/seller/profile/sign-out-all")
async def sign_out_all_devices(current=Depends(get_current_user)):
    """Bump the user's token version — all other sessions immediately invalidated.

    Returns a fresh token for the current device so the caller stays signed in.
    """
    user_doc = await db.users.find_one({"id": current["id"]}, {"token_version": 1}) or {}
    new_tv = int(user_doc.get("token_version") or 0) + 1
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"token_version": new_tv, "sessions_revoked_at": now_utc()}},
    )
    new_token = create_token(current["id"], token_version=new_tv)
    return {"ok": True, "access_token": new_token, "token_type": "bearer"}
