"""Loyalty points endpoints — balance, history, redeem preview."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import (
    PointsApplyRequest,
    PointsBalance,
    PointsHistoryPage,
    PointsLedgerEntry,
    PointsRedeemPreview,
)
from services.cart import hydrate_cart
from services.points import (
    EARN_RATE_PER_NZD,
    REDEEM_PTS_PER_NZD,
    WELCOME_BONUS,
    compute_redeem,
    current_balance,
    expiring_in_days,
    points_to_nzd,
)

router = APIRouter(prefix="/points", tags=["points"])


@router.get("/balance", response_model=PointsBalance)
async def get_balance(current=Depends(get_current_user)):
    bal = await current_balance(current["id"])
    exp = await expiring_in_days(current["id"], days=30)
    return PointsBalance(
        balance=bal,
        pending_earn=0,
        monetary_value_nzd=points_to_nzd(bal),
        expiring_soon=exp,
        earn_rate_per_nzd=EARN_RATE_PER_NZD,
        redeem_rate_per_nzd=REDEEM_PTS_PER_NZD,
        welcome_bonus=WELCOME_BONUS,
    )


@router.get("/history", response_model=PointsHistoryPage)
async def get_history(limit: int = 50, current=Depends(get_current_user)):
    limit = max(1, min(int(limit), 200))
    bal = await current_balance(current["id"])
    exp = await expiring_in_days(current["id"], days=30)
    items: list[PointsLedgerEntry] = []
    async for row in db.points_ledger.find(
        {"user_id": current["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(limit):
        items.append(PointsLedgerEntry(**row))
    return PointsHistoryPage(
        balance=PointsBalance(
            balance=bal,
            monetary_value_nzd=points_to_nzd(bal),
            expiring_soon=exp,
            earn_rate_per_nzd=EARN_RATE_PER_NZD,
            redeem_rate_per_nzd=REDEEM_PTS_PER_NZD,
            welcome_bonus=WELCOME_BONUS,
        ),
        items=items,
    )


@router.post("/redeem-preview", response_model=PointsRedeemPreview)
async def redeem_preview(body: PointsApplyRequest, current=Depends(get_current_user)):
    cart = await hydrate_cart(current["id"])
    bal = await current_balance(current["id"])
    res = compute_redeem(
        requested=body.points, balance=bal, subtotal_nzd=cart.subtotal_nzd
    )
    return PointsRedeemPreview(**res)
