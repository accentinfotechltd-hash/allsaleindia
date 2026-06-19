"""Admin user-management actions — suspend / reactivate / reset-2FA /
points-balance adjustment.

Guarded by `manager` role.  All operations are recorded to the admin
activity log so support can audit who did what and when.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from services.admin_auth import log_admin_action, require_roles
from services.points import current_balance

router = APIRouter(tags=["admin-users"])


SENSITIVE_USER_PROJECTION = {
    "_id": 0,
    "password_hash": 0,
    "two_factor_secret_hash": 0,
    "password_reset_token": 0,
    "email_verification_token": 0,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Bodies
# ---------------------------------------------------------------------------
class SuspendUserBody(BaseModel):
    reason: str = Field(..., min_length=4, max_length=240)


class PointsAdjustBody(BaseModel):
    delta: int = Field(..., description="Positive credits, negative debits. Must be != 0.")
    reason: str = Field(..., min_length=4, max_length=240)


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
@router.get("/admin/users/{user_id}")
async def admin_get_user(
    user_id: str,
    admin: dict = Depends(require_roles("manager", "support")),
):
    """Fetch a single user with ops fields (suspension state, points balance)."""
    user = await db.users.find_one({"id": user_id}, SENSITIVE_USER_PROJECTION)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Live points balance (sum of ledger) — cheaper than re-running per request,
    # but it's only the admin tool so keep it correct.
    try:
        user["points_balance"] = await current_balance(user_id)
    except Exception:
        user["points_balance"] = int(user.get("points_balance") or 0)

    user["orders_count"] = await db.orders.count_documents({"user_id": user_id})
    return user


# ---------------------------------------------------------------------------
# Suspend
# ---------------------------------------------------------------------------
@router.post("/admin/users/{user_id}/suspend")
async def admin_suspend_user(
    user_id: str,
    body: SuspendUserBody,
    admin: dict = Depends(require_roles("manager")),
):
    """Mark user account as suspended. Bumps `token_version` so any existing
    session JWT is immediately rejected on the next request."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "token_version": 1, "is_suspended": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.get("is_suspended"):
        return {"ok": True, "already": True, "is_suspended": True}

    new_tv = int(user.get("token_version") or 0) + 1
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "is_suspended": True,
                "suspended_at": _now(),
                "suspend_reason": body.reason.strip(),
                "suspended_by_admin_id": admin["id"],
                "token_version": new_tv,
            }
        },
    )
    await log_admin_action(
        admin["id"],
        "user.suspend",
        target=user_id,
        meta={"reason": body.reason.strip(), "email": user.get("email")},
    )
    return {"ok": True, "is_suspended": True}


@router.post("/admin/users/{user_id}/reactivate")
async def admin_reactivate_user(
    user_id: str,
    admin: dict = Depends(require_roles("manager")),
):
    """Reverse a previous suspension."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "is_suspended": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.get("is_suspended"):
        return {"ok": True, "already": True, "is_suspended": False}

    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {"is_suspended": False, "reactivated_at": _now()},
            "$unset": {
                "suspended_at": "",
                "suspend_reason": "",
                "suspended_by_admin_id": "",
            },
        },
    )
    await log_admin_action(
        admin["id"], "user.reactivate", target=user_id,
        meta={"email": user.get("email")},
    )
    return {"ok": True, "is_suspended": False}


# ---------------------------------------------------------------------------
# 2FA reset
# ---------------------------------------------------------------------------
@router.post("/admin/users/{user_id}/reset-2fa")
async def admin_reset_2fa(
    user_id: str,
    admin: dict = Depends(require_roles("manager")),
):
    """Disable 2FA so the buyer can re-enrol — used when a buyer loses
    their authenticator app and writes in to support."""
    user = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "id": 1, "email": 1, "two_factor_enabled": 1, "token_version": 1}
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    new_tv = int(user.get("token_version") or 0) + 1
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "two_factor_enabled": False,
                "token_version": new_tv,
            },
            "$unset": {
                "two_factor_secret_hash": "",
                "two_factor_pending_secret": "",
                "two_factor_recovery_codes": "",
            },
        },
    )
    await log_admin_action(
        admin["id"], "user.reset_2fa", target=user_id,
        meta={"email": user.get("email"), "was_enabled": bool(user.get("two_factor_enabled"))},
    )
    return {"ok": True, "two_factor_enabled": False}


# ---------------------------------------------------------------------------
# Points adjustment
# ---------------------------------------------------------------------------
@router.post("/admin/users/{user_id}/points-adjust")
async def admin_points_adjust(
    user_id: str,
    body: PointsAdjustBody,
    admin: dict = Depends(require_roles("manager")),
):
    """Manually credit or debit loyalty points. Writes an `admin_adjustment`
    row in the points ledger and updates the `points_balance` cache.

    Debits cannot drive the balance below zero — request will 400 instead."""
    if body.delta == 0:
        raise HTTPException(status_code=400, detail="delta must be non-zero")

    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    bal = await current_balance(user_id)
    if body.delta < 0 and bal + body.delta < 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot debit {abs(body.delta)} pts — balance is only {bal}.",
        )

    now = _now()
    ledger_row = {
        "id": f"pt_{uuid.uuid4().hex[:14]}",
        "user_id": user_id,
        "delta": int(body.delta),
        "reason": "admin_adjustment",
        "title": (
            f"Admin credit · +{body.delta} pts"
            if body.delta > 0
            else f"Admin debit · {body.delta} pts"
        ),
        "ref_id": admin["id"],
        "ref_type": "admin",
        "note": body.reason.strip(),
        "created_at": now,
        # Credits expire just like earned points (12 months). Debits never expire.
        "expires_at": (now + timedelta(days=365)) if body.delta > 0 else None,
    }
    await db.points_ledger.insert_one(ledger_row)
    new_bal = await current_balance(user_id)
    # Keep the denormalised field in sync so other places that read it stay correct.
    await db.users.update_one(
        {"id": user_id}, {"$set": {"points_balance": new_bal}}
    )

    await log_admin_action(
        admin["id"],
        "user.points_adjust",
        target=user_id,
        meta={
            "delta": int(body.delta),
            "new_balance": new_bal,
            "reason": body.reason.strip(),
            "email": user.get("email"),
        },
    )
    return {"ok": True, "delta": int(body.delta), "balance": new_bal}
