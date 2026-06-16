"""Owner / Admin authentication (separate from buyer/seller JWT).

Issues short-lived admin JWTs with `is_admin: true` claim. Admin accounts
live in their own `admin_users` collection with bcrypt-hashed passwords.

Seeded owner account: see `seed_owner_admin()` — picks up email/password
from env vars `OWNER_ADMIN_EMAIL` and `OWNER_ADMIN_PASSWORD` (one-time
bootstrap; rotate password via API after first login).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException
from jose import jwt

from config import JWT_SECRET, ADMIN_SECRET
from db import db
from utils import hash_password, now_utc, verify_password

logger = logging.getLogger("allsale.admin_auth")

ADMIN_JWT_TTL_HOURS = 8  # admins re-login after 8 hours
ALG = "HS256"


def _create_admin_token(admin_id: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=ADMIN_JWT_TTL_HOURS)
    payload = {"sub": admin_id, "is_admin": True, "role": role, "exp": exp}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALG)


async def authenticate_admin(email: str, password: str) -> dict:
    """Verify admin email/password. Returns admin doc or raises 401."""
    email = email.lower().strip()
    admin = await db.admin_users.find_one({"email": email})
    if not admin or not verify_password(password, admin.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not admin.get("is_active", True):
        raise HTTPException(status_code=403, detail="Admin account is deactivated")
    await db.admin_users.update_one(
        {"id": admin["id"]}, {"$set": {"last_login_at": now_utc()}}
    )
    return admin


async def get_current_admin(authorization: Optional[str] = Header(None)) -> dict:
    """FastAPI dependency: extracts + verifies admin JWT from Authorization header.

    Accepts EITHER:
      * `Authorization: Bearer <admin_jwt>` (new flow), OR
      * `x-admin-secret` header matching ADMIN_SECRET (legacy bootstrap)
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Admin auth required")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bad authorization header")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not an admin account")
    admin = await db.admin_users.find_one({"id": payload["sub"]})
    if not admin or not admin.get("is_active", True):
        raise HTTPException(status_code=403, detail="Admin account not found/inactive")
    return admin


# ---------------------------------------------------------------------------
# Role-based access control (RBAC)
# ---------------------------------------------------------------------------
# Supported roles:
#   - "owner"   : full control — only role that can manage other admins.
#   - "manager" : payouts, seller approval, orders, financing, returns.
#   - "support" : seller approval, tickets, read-only orders. NO payouts.
ALL_ROLES = ("owner", "manager", "support")


def _normalize_role(role: Optional[str]) -> str:
    """Return a clean lowercase role, defaulting to 'owner' for legacy admins."""
    return (role or "owner").lower().strip()


async def require_admin_role(
    allowed_roles: tuple[str, ...],
    authorization: Optional[str],
    x_admin_secret: Optional[str],
) -> dict:
    """Hybrid auth used by sensitive admin endpoints.

    Returns the *current admin doc* if the caller is authorised, otherwise
    raises 401/403. Accepts EITHER:

      * `x-admin-secret: <ADMIN_SECRET>`  → treated as the bootstrap owner.
        Returns a synthetic admin dict so the caller can log the action.
      * `Authorization: Bearer <jwt>`     → role must be in `allowed_roles`.
    """
    # Legacy bootstrap path — full owner privileges.
    if x_admin_secret and x_admin_secret == ADMIN_SECRET:
        return {
            "id": "bootstrap_owner",
            "email": "(bootstrap)",
            "full_name": "Bootstrap Owner",
            "role": "owner",
            "is_active": True,
            "via": "shared_secret",
        }

    # JWT path
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Admin auth required")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    if not payload.get("is_admin"):
        raise HTTPException(status_code=403, detail="Not an admin account")
    admin = await db.admin_users.find_one({"id": payload["sub"]})
    if not admin or not admin.get("is_active", True):
        raise HTTPException(status_code=403, detail="Admin account not found/inactive")
    role = _normalize_role(admin.get("role"))
    if role not in allowed_roles:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' not permitted (requires one of {sorted(allowed_roles)})",
        )
    return admin


def require_roles(*allowed_roles: str):
    """Build a FastAPI dependency that allows the listed roles + owner.

    Usage:
        admin = Depends(require_roles("manager", "support"))
    """
    # Owner is implicitly allowed for everything.
    allowed = tuple({*allowed_roles, "owner"})

    async def _dep(
        authorization: Optional[str] = Header(None),
        x_admin_secret: Optional[str] = Header(None, alias="x-admin-secret"),
    ) -> dict:
        return await require_admin_role(allowed, authorization, x_admin_secret)

    return _dep


# Convenience: owner-only dep (used for sub-admin management).
require_owner = require_roles("owner")


async def log_admin_action(admin_id: str, action: str, target: str = "", meta: dict | None = None):
    """Audit-log every privileged action. Read via /api/admin/activity-log."""
    await db.admin_activity_log.insert_one(
        {
            "id": f"act_{uuid.uuid4().hex[:12]}",
            "admin_id": admin_id,
            "action": action,
            "target": target,
            "meta": meta or {},
            "at": now_utc(),
        }
    )


async def seed_owner_admin() -> None:
    """Bootstrap the first owner account from env vars on startup."""
    email = (os.environ.get("OWNER_ADMIN_EMAIL") or "").lower().strip()
    pwd = os.environ.get("OWNER_ADMIN_PASSWORD") or ""
    if not email or not pwd:
        return
    existing = await db.admin_users.find_one({"email": email})
    if existing:
        return
    await db.admin_users.insert_one(
        {
            "id": f"admin_{uuid.uuid4().hex[:12]}",
            "email": email,
            "full_name": "Owner",
            "role": "owner",
            "password_hash": hash_password(pwd),
            "is_active": True,
            "created_at": now_utc(),
            "last_login_at": None,
        }
    )
    logger.info("Owner admin seeded: %s", email)
