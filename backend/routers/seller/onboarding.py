"""Seller onboarding endpoints: register, upgrade, fetch profile, KYC docs."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user
from models import (
    AuthResponse,
    SellerProfile,
    SellerRegister,
    SellerUpgrade,
    UserPublic,
)
from utils import create_token, hash_password, now_utc, public_user

from ._common import verify_business_and_persist

router = APIRouter(tags=["seller"])


async def _link_ambassador_referral(user_id: str, referral_code: str | None) -> None:
    """If ``referral_code`` resolves to an active ambassador (B2C *or* B2B
    code), set ``referred_by_ambassador_id`` on the seller's user doc and
    increment the ambassador's ``referred_sellers_count``. Idempotent."""
    code = (referral_code or "").strip().upper()
    if not code:
        return
    amb = await db.users.find_one(
        {"$or": [
            {"ambassador_profile.code": code},
            {"ambassador_profile.code_b2b": code},
        ],
         "ambassador_profile.status": {"$ne": "suspended"}},
        {"_id": 0, "id": 1},
    )
    if not amb:
        return  # invalid / suspended → silently ignore
    res = await db.users.update_one(
        {"id": user_id, "referred_by_ambassador_id": {"$exists": False}},
        {"$set": {
            "referred_by_ambassador_id": amb["id"],
            "seller_referral_code_used": code,
            "seller_onboarded_at": now_utc(),
        }},
    )
    if res.modified_count:
        await db.users.update_one(
            {"id": amb["id"]},
            {"$inc": {"ambassador_profile.referred_sellers_count": 1},
             "$set": {"ambassador_profile.last_active_at": now_utc()}},
        )


# --- KYC docs ---------------------------------------------------------------
class SellerDocumentsUpload(BaseModel):
    id_proof_url: str = Field(..., min_length=10, description="Cloudinary URL or data: URL of govt-issued ID")
    business_proof_url: str = Field(..., min_length=10, description="Cloudinary URL or data: URL of GSTIN / business cert / shop license")


@router.post("/seller/documents")
async def submit_seller_documents(
    body: SellerDocumentsUpload, current=Depends(get_current_user)
):
    """Seller uploads ID + business proof. Moves status to `pending_review`.

    Sellers can re-upload while still `pending_documents` or `rejected`
    (to address an admin's rejection reason). Once `pending_review` or
    `approved`, further uploads are blocked.
    """
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    status = current.get("seller_verification_status")
    if status not in {"pending_documents", "rejected"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot re-submit documents while status is '{status}'",
        )
    new_status = "pending_review"
    await db.sellers.update_one(
        {"user_id": current["id"]},
        {"$set": {
            "id_proof_url": body.id_proof_url.strip(),
            "business_proof_url": body.business_proof_url.strip(),
            "submitted_at": now_utc(),
            "verification_status": new_status,
            "rejection_reason": None,
        }},
    )
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"seller_verification_status": new_status}},
    )
    # In-app receipt
    try:
        from services.notifications import create_notification
        await create_notification(
            current["id"],
            title="Documents received ✓",
            body="Your application is under review. We'll respond within 7 business days.",
            link="/seller/onboarding",
        )
    except Exception:
        pass
    return {
        "status": new_status,
        "submitted_at": now_utc().isoformat(),
        "sla_days": 7,
    }


@router.get("/seller/me/status")
async def seller_status(current=Depends(get_current_user)):
    """Lightweight status endpoint for the seller's onboarding UI."""
    if not current.get("is_seller"):
        return {"status": "not_seller"}
    profile = await db.sellers.find_one(
        {"user_id": current["id"]},
        {
            "_id": 0,
            "verification_status": 1,
            "submitted_at": 1,
            "approved_at": 1,
            "rejected_at": 1,
            "rejection_reason": 1,
            "id_proof_url": 1,
            "business_proof_url": 1,
        },
    ) or {}
    from datetime import timedelta, timezone
    submitted = profile.get("submitted_at")
    days_remaining = None
    if submitted and profile.get("verification_status") == "pending_review":
        if submitted.tzinfo is None:
            submitted = submitted.replace(tzinfo=timezone.utc)
        delta_days = (now_utc() - submitted).days
        days_remaining = max(0, 7 - delta_days)
    approved_at = profile.get("approved_at")
    rejected_at = profile.get("rejected_at")
    return {
        "status": profile.get("verification_status") or current.get("seller_verification_status") or "pending_documents",
        "submitted_at": submitted.isoformat() if submitted else None,
        "approved_at": approved_at.isoformat() if approved_at else None,
        "rejected_at": rejected_at.isoformat() if rejected_at else None,
        "rejection_reason": profile.get("rejection_reason"),
        "has_id_proof": bool(profile.get("id_proof_url")),
        "has_business_proof": bool(profile.get("business_proof_url")),
        "sla_days_remaining": days_remaining,
    }


# --- Onboarding flows -------------------------------------------------------
@router.post("/seller/register", response_model=AuthResponse)
async def seller_register(body: SellerRegister):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "id": uid,
        "email": email,
        "full_name": body.business.contact_name.strip(),
        "password_hash": hash_password(body.password),
        "provider": "email",
        "picture": None,
        "is_seller": True,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    await verify_business_and_persist(uid, body.business)
    # Best-effort ambassador attribution — silent no-op on invalid codes.
    try:
        await _link_ambassador_referral(uid, body.referral_code)
    except Exception:
        pass
    fresh = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    token = create_token(uid)
    return AuthResponse(user=public_user(fresh), access_token=token)


@router.post("/seller/upgrade", response_model=UserPublic)
async def seller_upgrade(body: SellerUpgrade, current=Depends(get_current_user)):
    if current.get("is_seller"):
        raise HTTPException(status_code=400, detail="Already a seller")
    await verify_business_and_persist(current["id"], body.business)
    try:
        await _link_ambassador_referral(current["id"], body.referral_code)
    except Exception:
        pass
    fresh = await db.users.find_one(
        {"id": current["id"]}, {"_id": 0, "password_hash": 0}
    )
    return public_user(fresh)


@router.get("/seller/me", response_model=SellerProfile)
async def seller_me(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=404, detail="Not a seller")
    profile = await db.sellers.find_one({"user_id": current["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    # Defensive: settings-only writes (e.g. vacation toggle for a seller who
    # hasn't yet completed full onboarding) can leave the doc without every
    # field the SellerProfile schema marks required.  Pad with safe empty
    # strings so this endpoint never 500s — the actual onboarding flow still
    # demands real values via SellerRegister.
    for required_field in (
        "business_type", "company_name", "pan",
        "address_line1", "city", "state", "pincode",
        "contact_name", "contact_phone",
    ):
        profile.setdefault(required_field, "")
    profile.setdefault("verification_status", current.get("seller_verification_status") or "pending_review")
    return SellerProfile(**profile)
