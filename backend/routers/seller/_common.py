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


async def require_verified_seller(current=Depends(get_current_user)) -> dict:
    """Dependency: caller must be an auto-verified seller."""
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


async def verify_business_and_persist(
    user_id: str, business: SellerBusiness
) -> dict:
    """Validate the supplied business docs and upsert the seller profile.

    Also flips the user doc to ``is_seller=True`` and stores the verified
    company name for fast joins on product listings.
    """
    cleaned = validate_indian_business(business)
    # Pre-flight uniqueness check on GSTIN (only if one is being set).
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
    verification_status = "auto_verified"
    profile = {
        "user_id": user_id,
        **cleaned,
        "verification_status": verification_status,
        "verified_at": now_utc(),
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
