"""Admin operations (payouts, seller approval). Guarded by x-admin-secret header."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Header, HTTPException

from config import ADMIN_SECRET
from db import db
from models import Payout
from utils import now_utc

router = APIRouter(tags=["admin"])


@router.post("/admin/payouts/{payout_id}/mark-paid", response_model=Payout)
async def admin_mark_payout_paid(
    payout_id: str,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    po = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Payout not found")
    if po.get("status") == "paid_out":
        return Payout(**po)
    await db.payouts.update_one(
        {"id": payout_id},
        {"$set": {"status": "paid_out", "paid_out_at": now_utc()}},
    )
    fresh = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    return Payout(**fresh)


@router.post("/admin/sellers/{user_id}/approve")
async def admin_approve_seller(
    user_id: str,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    res1 = await db.users.update_one(
        {"id": user_id, "is_seller": True},
        {"$set": {"seller_verification_status": "auto_verified"}},
    )
    if res1.matched_count == 0:
        raise HTTPException(status_code=404, detail="Seller not found")
    await db.sellers.update_one(
        {"user_id": user_id},
        {"$set": {"verification_status": "auto_verified", "verified_at": now_utc()}},
    )
    return {"approved": True}
