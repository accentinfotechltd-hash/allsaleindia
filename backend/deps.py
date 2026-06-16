"""FastAPI dependencies (auth context)."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Header, HTTPException
from jose import JWTError, jwt

from config import JWT_ALG, JWT_SECRET
from db import db


async def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        tv = int(payload.get("tv") or 0)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if int(user.get("token_version") or 0) != tv:
        raise HTTPException(status_code=401, detail="Session expired — please sign in again")
    return user


async def get_current_user_optional(
    authorization: Annotated[Optional[str], Header()] = None,
) -> Optional[dict]:
    """Same as `get_current_user` but returns None when auth is missing /
    invalid instead of raising.  Use for endpoints that work both signed-in
    and anonymous (e.g. analytics ingestion)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        tv = int(payload.get("tv") or 0)
    except JWTError:
        return None
    if not user_id:
        return None
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        return None
    if int(user.get("token_version") or 0) != tv:
        return None
    return user


async def require_verified_seller(current=None) -> dict:
    # NOTE: This is called via FastAPI `Depends(get_current_user)` chain.
    # We re-validate here so callers can use it directly.
    if current is None:
        raise HTTPException(status_code=401, detail="Auth required")
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current
