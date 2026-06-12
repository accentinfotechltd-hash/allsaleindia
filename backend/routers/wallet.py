"""Buyer wallet — store credit balance & ledger.

Powers the "Get store credit instead of refund" path in the returns
flow. Sellers don't have wallets (they get Stripe payouts directly).
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user

router = APIRouter(tags=["wallet"])


@router.get("/wallet")
async def get_wallet(current=Depends(get_current_user)):
    """Return the current buyer's wallet balance + recent ledger entries."""
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0, "wallet_balance_nzd": 1})
    balance = float((user or {}).get("wallet_balance_nzd") or 0.0)
    cursor = (
        db.wallet_ledger.find({"user_id": current["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )
    entries: List[dict] = []
    async for e in cursor:
        e["created_at"] = (
            e["created_at"].isoformat() if hasattr(e.get("created_at"), "isoformat") else e.get("created_at")
        )
        entries.append(e)
    return {"balance_nzd": round(balance, 2), "entries": entries}
