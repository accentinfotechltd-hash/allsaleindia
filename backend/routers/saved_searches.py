"""Saved searches — buyers persist their favourite filter combos and
re-launch them in one tap from `/account/saved-searches`. Optional
`notify` flag flags rows for a future digest cron.

Collection: `saved_searches`
Doc shape:
  { id, user_id, name, q, category, subcategory, filters: {...},
    notify: bool, created_at }
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user
from utils import now_utc

router = APIRouter(prefix="/me/saved-searches", tags=["saved-searches"])

MAX_PER_USER = 25


class SavedSearchIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    q: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    filters: dict = Field(default_factory=dict)
    notify: bool = False


def _strip(doc: dict) -> dict:
    doc.pop("_id", None)
    if doc.get("created_at"):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


@router.get("")
async def list_saved_searches(current=Depends(get_current_user)):
    rows = []
    async for s in db.saved_searches.find(
        {"user_id": current["id"]}
    ).sort("created_at", -1):
        rows.append(_strip(s))
    return {"items": rows}


@router.post("")
async def create_saved_search(
    body: SavedSearchIn, current=Depends(get_current_user)
):
    count = await db.saved_searches.count_documents({"user_id": current["id"]})
    if count >= MAX_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"You can save at most {MAX_PER_USER} searches.",
        )
    doc = {
        "id": f"ss_{uuid.uuid4().hex[:14]}",
        "user_id": current["id"],
        "name": body.name.strip(),
        "q": (body.q or "").strip() or None,
        "category": body.category,
        "subcategory": body.subcategory,
        "filters": body.filters or {},
        "notify": bool(body.notify),
        "created_at": now_utc(),
    }
    await db.saved_searches.insert_one(doc)
    return _strip({**doc})


@router.delete("/{ss_id}")
async def delete_saved_search(ss_id: str, current=Depends(get_current_user)):
    res = await db.saved_searches.delete_one(
        {"id": ss_id, "user_id": current["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Saved search not found")
    return {"removed": True}


@router.patch("/{ss_id}/notify")
async def toggle_notify(
    ss_id: str,
    body: dict,
    current=Depends(get_current_user),
):
    """Toggle `notify` flag (whether the buyer wants periodic alerts when
    new products match). A digest cron can later pick rows where
    `notify=True` and email matches."""
    res = await db.saved_searches.update_one(
        {"id": ss_id, "user_id": current["id"]},
        {"$set": {"notify": bool(body.get("notify"))}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Saved search not found")
    return {"ok": True}
