"""Owner / Sub-admin team management (RBAC).

Only the **owner** can create, edit, deactivate, or delete other admin
accounts.  Sub-admins are scoped via the `role` field on `admin_users`.

Roles (see `services/admin_auth.ALL_ROLES`):
  * `owner`   — full control.  Implicit on every endpoint.
  * `manager` — payouts, seller approval, orders, financing, returns.
  * `support` — seller approval, tickets, read-only orders.  NO payouts.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from db import db
from services.admin_auth import (
    ALL_ROLES,
    log_admin_action,
    require_owner,
)
from utils import hash_password, now_utc

router = APIRouter(tags=["admin-team"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class AdminUserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: Optional[str] = None
    role: str
    is_active: bool = True
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None


class CreateAdminBody(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=120)
    role: str  # validated against ALL_ROLES below
    password: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=128,
        description="Initial password.  If omitted a strong one is generated.",
    )


class UpdateAdminBody(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    role: Optional[str] = None
    is_active: Optional[bool] = None


class ResetPasswordBody(BaseModel):
    new_password: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=128,
        description="Optional explicit new password; otherwise generated.",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _serialize_admin(doc: dict) -> dict:
    """Strip Mongo internals + password hash before returning."""
    return {
        "id": doc["id"],
        "email": doc["email"],
        "full_name": doc.get("full_name"),
        "role": doc.get("role", "owner"),
        "is_active": bool(doc.get("is_active", True)),
        "created_at": doc.get("created_at"),
        "last_login_at": doc.get("last_login_at"),
    }


def _generate_password() -> str:
    """Generate an URL-safe 16-char password.  Owner shares it once over a
    secure channel — the sub-admin must change it after first login."""
    return secrets.token_urlsafe(12)


def _validate_role(role: str) -> str:
    role = (role or "").lower().strip()
    if role not in ALL_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{role}'.  Allowed: {list(ALL_ROLES)}",
        )
    return role


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/admin/team", response_model=list[AdminUserOut])
async def list_admins(admin=Depends(require_owner)):
    """List ALL admin accounts.  Owner-only."""
    out: list[dict] = []
    async for row in db.admin_users.find(
        {}, {"_id": 0, "password_hash": 0}
    ).sort("created_at", 1):
        out.append(_serialize_admin(row))
    return out


@router.get("/admin/team/roles")
async def list_roles(admin=Depends(require_owner)):
    """Return the list of supported roles + a human-friendly description."""
    return {
        "roles": [
            {
                "value": "owner",
                "label": "Owner",
                "description": "Full control of the platform.  Can manage other admins.",
            },
            {
                "value": "manager",
                "label": "Manager",
                "description": "Payouts, seller approval, orders, financing, returns.",
            },
            {
                "value": "support",
                "label": "Support",
                "description": "Seller approval, customer tickets, read-only orders.  No payouts.",
            },
        ]
    }


@router.post("/admin/team", status_code=201)
async def create_admin(body: CreateAdminBody, admin=Depends(require_owner)):
    """Invite a new sub-admin.  Owner-only.

    Returns the new admin doc PLUS the initial password under
    `_initial_password` — show it ONCE in the UI and never persist it client
    side.  The sub-admin should rotate it after first login.
    """
    role = _validate_role(body.role)
    email = body.email.lower().strip()

    if await db.admin_users.find_one({"email": email}):
        raise HTTPException(
            status_code=409, detail="An admin with that email already exists"
        )

    raw_pwd = (body.password or "").strip() or _generate_password()
    doc = {
        "id": f"admin_{uuid.uuid4().hex[:12]}",
        "email": email,
        "full_name": body.full_name.strip(),
        "role": role,
        "password_hash": hash_password(raw_pwd),
        "is_active": True,
        "created_at": now_utc(),
        "last_login_at": None,
        "created_by": admin.get("id"),
    }
    await db.admin_users.insert_one(doc)

    await log_admin_action(
        admin.get("id", "bootstrap_owner"),
        "admin.create",
        target=doc["id"],
        meta={"email": email, "role": role},
    )

    out = _serialize_admin(doc)
    # Surface the initial password ONCE — frontend must show it and never
    # store it.  This is the only response that ever contains a password.
    out["_initial_password"] = raw_pwd
    return out


@router.patch("/admin/team/{admin_id}", response_model=AdminUserOut)
async def update_admin(
    admin_id: str,
    body: UpdateAdminBody,
    admin=Depends(require_owner),
):
    """Update full_name / role / is_active.  Owner-only."""
    target = await db.admin_users.find_one({"id": admin_id})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    updates: dict = {}
    if body.full_name is not None:
        updates["full_name"] = body.full_name.strip()
    if body.role is not None:
        new_role = _validate_role(body.role)
        # Safety: prevent demoting the LAST active owner (you'd lock yourself out).
        if target.get("role") == "owner" and new_role != "owner":
            other_owners = await db.admin_users.count_documents(
                {"role": "owner", "is_active": True, "id": {"$ne": admin_id}}
            )
            if other_owners == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot demote the last active owner.  "
                    "Promote another admin to owner first.",
                )
        updates["role"] = new_role
    if body.is_active is not None:
        # Safety: prevent deactivating the LAST active owner.
        if target.get("role") == "owner" and body.is_active is False:
            other_owners = await db.admin_users.count_documents(
                {"role": "owner", "is_active": True, "id": {"$ne": admin_id}}
            )
            if other_owners == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot deactivate the last active owner.",
                )
        updates["is_active"] = bool(body.is_active)

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    await db.admin_users.update_one({"id": admin_id}, {"$set": updates})

    await log_admin_action(
        admin.get("id", "bootstrap_owner"),
        "admin.update",
        target=admin_id,
        meta=updates,
    )

    fresh = await db.admin_users.find_one(
        {"id": admin_id}, {"_id": 0, "password_hash": 0}
    )
    return _serialize_admin(fresh)


@router.post("/admin/team/{admin_id}/reset-password")
async def reset_admin_password(
    admin_id: str,
    body: ResetPasswordBody,
    admin=Depends(require_owner),
):
    """Reset a sub-admin's password.  Owner-only.

    Returns the new password ONCE so the owner can hand it off.
    """
    target = await db.admin_users.find_one({"id": admin_id})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    new_pwd = (body.new_password or "").strip() or _generate_password()
    await db.admin_users.update_one(
        {"id": admin_id}, {"$set": {"password_hash": hash_password(new_pwd)}}
    )

    await log_admin_action(
        admin.get("id", "bootstrap_owner"),
        "admin.reset_password",
        target=admin_id,
        meta={"email": target.get("email")},
    )

    return {"new_password": new_pwd}


@router.delete("/admin/team/{admin_id}", status_code=204)
async def delete_admin(admin_id: str, admin=Depends(require_owner)):
    """Permanently delete a sub-admin.  Owner-only.

    Refuses to delete the last active owner (lockout protection).
    """
    target = await db.admin_users.find_one({"id": admin_id})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")

    if target.get("role") == "owner":
        other_owners = await db.admin_users.count_documents(
            {"role": "owner", "is_active": True, "id": {"$ne": admin_id}}
        )
        if other_owners == 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the last active owner.",
            )

    # Never let an admin delete themselves — they'd lose access mid-flight.
    if admin.get("id") == admin_id:
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own account.",
        )

    await db.admin_users.delete_one({"id": admin_id})

    await log_admin_action(
        admin.get("id", "bootstrap_owner"),
        "admin.delete",
        target=admin_id,
        meta={"email": target.get("email"), "role": target.get("role")},
    )
    return None
