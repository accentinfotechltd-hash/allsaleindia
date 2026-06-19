"""Server-side recently-viewed sync — survives device reinstalls + works
across mobile and web. Backed by `db.recently_viewed` (one row per
(user_id, product_id) with a rolling cap of 50 per user)."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from db import db
from deps import get_current_user
from utils import now_utc

router = APIRouter(tags=["recently-viewed"])

MAX_PER_USER = 50


class RecentViewIn(BaseModel):
    product_id: str


@router.post("/me/recently-viewed")
async def push_recently_viewed(
    body: RecentViewIn, current=Depends(get_current_user)
):
    """Mark a product as viewed (idempotent — refreshes the timestamp)."""
    # Upsert + bump timestamp.
    await db.recently_viewed.update_one(
        {"user_id": current["id"], "product_id": body.product_id},
        {"$set": {
            "user_id": current["id"],
            "product_id": body.product_id,
            "viewed_at": now_utc(),
        }},
        upsert=True,
    )
    # Trim oldest beyond MAX_PER_USER (cheap with the index Mongo creates).
    cnt = await db.recently_viewed.count_documents({"user_id": current["id"]})
    if cnt > MAX_PER_USER:
        overflow = cnt - MAX_PER_USER
        cursor = db.recently_viewed.find(
            {"user_id": current["id"]}, {"_id": 1}
        ).sort("viewed_at", 1).limit(overflow)
        old_ids = [d["_id"] async for d in cursor]
        if old_ids:
            await db.recently_viewed.delete_many({"_id": {"$in": old_ids}})
    return {"ok": True}


@router.get("/me/recently-viewed")
async def list_recently_viewed(
    limit: int = Query(default=20, ge=1, le=50),
    current=Depends(get_current_user),
):
    """Most-recent first. Hydrated against the live products collection so
    deleted / out-of-stock listings don't surface."""
    rows: list[dict] = []
    async for r in db.recently_viewed.find(
        {"user_id": current["id"]}, {"_id": 0}
    ).sort("viewed_at", -1).limit(limit * 2):
        # over-fetch so dropped products can be filtered out
        rows.append(r)
        if len(rows) >= limit * 2:
            break

    out: list[dict] = []
    for r in rows:
        prod = await db.products.find_one(
            {"id": r["product_id"]},
            {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1, "category": 1, "rating": 1},
        )
        if not prod:
            continue
        out.append(
            {
                **prod,
                "viewed_at": (
                    r["viewed_at"].isoformat() if r.get("viewed_at") else None
                ),
            }
        )
        if len(out) >= limit:
            break
    return {"items": out}


@router.delete("/me/recently-viewed")
async def clear_recently_viewed(current=Depends(get_current_user)):
    res = await db.recently_viewed.delete_many({"user_id": current["id"]})
    return {"removed": res.deleted_count}
