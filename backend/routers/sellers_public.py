"""Public seller info — name, city, response-time badge.

Used by PDP, chat headers, and the seller-store landing pages. Read-only.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import db
from services.response_time import compute_seller_response_stats

router = APIRouter(tags=["sellers_public"])


class SellerPublic(BaseModel):
    id: str
    company_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    response_stats: Optional[dict] = None  # {minutes, samples, label, computed_at}


@router.get("/sellers/{seller_id}/public", response_model=SellerPublic)
async def get_seller_public(seller_id: str):
    user = await db.users.find_one(
        {"id": seller_id, "is_seller": True}, {"_id": 0, "id": 1, "full_name": 1}
    )
    if not user:
        raise HTTPException(status_code=404, detail="Seller not found")
    profile = await db.sellers.find_one(
        {"user_id": seller_id},
        {"_id": 0, "company_name": 1, "city": 1, "state": 1},
    ) or {}
    stats = await compute_seller_response_stats(seller_id)
    return SellerPublic(
        id=seller_id,
        company_name=profile.get("company_name") or user.get("full_name"),
        city=profile.get("city"),
        state=profile.get("state"),
        response_stats=stats,
    )
