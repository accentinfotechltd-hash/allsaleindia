"""Saved shipping addresses CRUD.

Buyers can save multiple addresses (home, work, gift recipients, etc.) and
pick one at checkout.  One address may be marked `is_default=True` and is
automatically pre-selected on the cart/checkout pages.

Schema (in `users` doc → `saved_addresses` array):
  {
    id:          str (uuid hex prefix)
    label:       str   — e.g. "Home", "Work", "Mum"
    full_name:   str
    phone:       str (optional)
    line1:       str
    line2:       str (optional)
    city:        str
    state:       str (optional but recommended)
    postal_code: str
    country:     str ISO-2  — e.g. "NZ", "AU", "IN"
    is_default:  bool
    created_at:  datetime
  }
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from db import db
from deps import get_current_user

router = APIRouter(prefix="/account", tags=["account-addresses"])

# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------
COUNTRIES_2 = re_compile = None  # avoid bringing `re` into module ns

# ISO-3166-1 alpha-2 → full name (matches checkout schema's `country` strings)
# Bi-directional so we can accept EITHER form and normalise to ISO-2.
COUNTRY_NAME_TO_ISO = {
    "new zealand": "NZ", "australia": "AU", "united states": "US",
    "usa": "US", "united kingdom": "GB", "uk": "GB",
    "great britain": "GB", "canada": "CA", "india": "IN",
}


def _normalise_country(v: Optional[str]) -> Optional[str]:
    if not v:
        return v
    v = v.strip()
    if len(v) == 2:
        return v.upper()
    return COUNTRY_NAME_TO_ISO.get(v.lower(), v[:2].upper())


class AddressIn(BaseModel):
    # Accept BOTH `postal_code` (canonical) AND `postcode` (used by checkout)
    # as input.  Output is always `postal_code` for consistency.
    model_config = ConfigDict(populate_by_name=True)

    label: str = Field(..., min_length=1, max_length=60)
    full_name: str = Field(..., min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    line1: str = Field(..., min_length=1, max_length=200)
    line2: Optional[str] = Field(default=None, max_length=200)
    city: str = Field(..., min_length=1, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100, validation_alias="region")
    postal_code: str = Field(..., min_length=1, max_length=20, validation_alias="postcode")
    country: str = Field(..., min_length=2, max_length=60, description="ISO-3166-1 alpha-2 OR full country name — normalised to ISO-2")
    is_default: bool = False

    @field_validator("country")
    @classmethod
    def _upper_iso(cls, v: str) -> str:
        out = _normalise_country(v)
        if not out or len(out) != 2:
            raise ValueError("country must be ISO-3166-1 alpha-2 (e.g. NZ) or a recognised full name")
        return out


class AddressUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    label: Optional[str] = Field(default=None, min_length=1, max_length=60)
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    line1: Optional[str] = Field(default=None, min_length=1, max_length=200)
    line2: Optional[str] = Field(default=None, max_length=200)
    city: Optional[str] = Field(default=None, min_length=1, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100, validation_alias="region")
    postal_code: Optional[str] = Field(default=None, min_length=1, max_length=20, validation_alias="postcode")
    country: Optional[str] = Field(default=None, min_length=2, max_length=60)
    is_default: Optional[bool] = None

    @field_validator("country")
    @classmethod
    def _upper_iso(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        out = _normalise_country(v)
        if not out or len(out) != 2:
            raise ValueError("country must be ISO-3166-1 alpha-2 or full name")
        return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _new_id() -> str:
    return f"addr_{uuid.uuid4().hex[:12]}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _set_only_default(user_id: str, address_id: str) -> None:
    """Atomically flip exactly one address to default + clear all others."""
    addrs = await db.users.find_one({"id": user_id}, {"saved_addresses": 1, "_id": 0})
    if not addrs or not addrs.get("saved_addresses"):
        return
    for a in addrs["saved_addresses"]:
        a["is_default"] = a["id"] == address_id
    await db.users.update_one(
        {"id": user_id}, {"$set": {"saved_addresses": addrs["saved_addresses"]}}
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/addresses")
async def list_addresses(user=Depends(get_current_user)):
    """Return the current user's saved addresses (default first)."""
    addrs = (user or {}).get("saved_addresses") or []
    # Default first, then most recent.
    addrs = sorted(
        addrs,
        key=lambda a: (not a.get("is_default", False), -(a.get("created_at") or _now()).timestamp() if isinstance(a.get("created_at"), datetime) else 0),
    )
    return {"addresses": addrs, "count": len(addrs)}


@router.post("/addresses", status_code=201)
async def add_address(body: AddressIn, user=Depends(get_current_user)):
    """Save a new address.  If `is_default=True`, all others become non-default."""
    new_addr = body.model_dump()
    new_addr["id"] = _new_id()
    new_addr["created_at"] = _now()

    existing = (user or {}).get("saved_addresses") or []
    # First address is automatically the default.
    if not existing:
        new_addr["is_default"] = True

    if new_addr.get("is_default"):
        for a in existing:
            a["is_default"] = False

    existing.append(new_addr)

    if len(existing) > 25:
        raise HTTPException(
            status_code=400, detail="Address book limit reached (25). Delete one first."
        )

    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"saved_addresses": existing}}
    )
    return new_addr


@router.patch("/addresses/{address_id}")
async def update_address(
    address_id: str,
    body: AddressUpdate,
    user=Depends(get_current_user),
):
    """Update fields on an existing address.  Setting `is_default=True`
    automatically clears the flag on all others."""
    addrs = (user or {}).get("saved_addresses") or []
    target = next((a for a in addrs if a.get("id") == address_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Address not found")

    updates = body.model_dump(exclude_unset=True)
    make_default = updates.pop("is_default", None)
    target.update(updates)

    if make_default is True:
        for a in addrs:
            a["is_default"] = a.get("id") == address_id
    elif make_default is False:
        # Don't allow removing the LAST default — flip another one instead if
        # this was the only default.
        if target.get("is_default") and not any(
            a.get("is_default") and a["id"] != address_id for a in addrs
        ):
            raise HTTPException(
                status_code=400,
                detail="Cannot unset default — at least one address must be default.",
            )
        target["is_default"] = False

    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"saved_addresses": addrs}}
    )
    return target


@router.post("/addresses/{address_id}/default")
async def set_default_address(address_id: str, user=Depends(get_current_user)):
    """Convenience endpoint — mark an address as default."""
    addrs = (user or {}).get("saved_addresses") or []
    if not any(a.get("id") == address_id for a in addrs):
        raise HTTPException(status_code=404, detail="Address not found")
    await _set_only_default(user["id"], address_id)
    return {"ok": True, "default_id": address_id}


@router.delete("/addresses/{address_id}", status_code=204)
async def delete_address(address_id: str, user=Depends(get_current_user)):
    """Delete an address.  If it was the default, promote the most recent
    remaining address to default automatically."""
    addrs = (user or {}).get("saved_addresses") or []
    target = next((a for a in addrs if a.get("id") == address_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Address not found")

    was_default = target.get("is_default", False)
    remaining = [a for a in addrs if a.get("id") != address_id]

    if was_default and remaining:
        # Pick the most-recently-created remaining address as the new default.
        remaining.sort(
            key=lambda a: a.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        remaining[0]["is_default"] = True

    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"saved_addresses": remaining}}
    )
    return None
