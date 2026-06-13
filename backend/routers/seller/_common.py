"""Shared helpers used by all seller sub-routers.

Kept tiny on purpose: only the verified-seller dependency, the business
upsert helper, and the country-code → flag map for analytics.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from db import db
from deps import get_current_user
from models import SellerBusiness
from utils import now_utc, validate_indian_business

# Flag emoji per ISO-3166 alpha-2 used by the analytics insights endpoint.
COUNTRY_FLAGS = {
    "NZ": "\U0001F1F3\U0001F1FF",
    "AU": "\U0001F1E6\U0001F1FA",
    "US": "\U0001F1FA\U0001F1F8",
    "GB": "\U0001F1EC\U0001F1E7",
    "UK": "\U0001F1EC\U0001F1E7",
    "CA": "\U0001F1E8\U0001F1E6",
    "IN": "\U0001F1EE\U0001F1F3",
}


VALID_SELLER_STATUSES = {
    "pending_documents",  # Just registered — must upload ID + business proof
    "pending_review",     # Documents submitted — admin reviewing (7-day SLA)
    "approved",           # Cleared by admin — can list products
    "rejected",           # Admin rejected (see rejection_reason)
    "auto_verified",      # Legacy/back-compat — treated as approved
}
APPROVED_STATUSES = {"approved", "auto_verified"}


async def require_verified_seller(current=Depends(get_current_user)) -> dict:
    """Dependency: caller must be a fully-approved seller (manual or legacy)."""
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    status = current.get("seller_verification_status")
    if status not in APPROVED_STATUSES:
        if status == "pending_documents":
            raise HTTPException(
                status_code=403,
                detail="Please upload your ID proof and business proof to continue.",
            )
        if status == "pending_review":
            raise HTTPException(
                status_code=403,
                detail="Your seller application is under review. We'll notify you within 7 business days.",
            )
        if status == "rejected":
            raise HTTPException(
                status_code=403,
                detail="Your seller application was rejected. Please contact support.",
            )
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


async def verify_business_and_persist(
    user_id: str, business: SellerBusiness
) -> dict:
    """Validate the supplied business docs and upsert the seller profile.

    Sellers now start at ``pending_documents`` — they must upload ID proof
    and business proof, then admin approves within 7 business days.
    """
    cleaned = validate_indian_business(business)
    if cleaned.get("gstin"):
        existing = await db.sellers.find_one(
            {"gstin": cleaned["gstin"], "user_id": {"$ne": user_id}},
            {"_id": 1},
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail="This GSTIN is already registered with another seller",
            )
    verification_status = "pending_documents"
    profile = {
        "user_id": user_id,
        **cleaned,
        "verification_status": verification_status,
        "submitted_at": None,
        "approved_at": None,
        "rejected_at": None,
        "rejection_reason": None,
        "reviewed_by": None,
        "id_proof_url": None,
        "business_proof_url": None,
        "created_at": now_utc(),
    }
    try:
        await db.sellers.update_one(
            {"user_id": user_id}, {"$set": profile}, upsert=True
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="This GSTIN is already registered with another seller",
        )
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "is_seller": True,
                "seller_verification_status": verification_status,
                "company_name": cleaned["company_name"],
            }
        },
    )
    return profile
