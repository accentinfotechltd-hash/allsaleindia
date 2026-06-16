"""Recently-viewed & personalised product recommendations.

  POST /api/products/{product_id}/view              — track a product view
                                                       (auth optional)
  GET  /api/recommendations/recently-viewed         — last N products this
                                                       user looked at (auth)

The view tracker writes to a dedicated `product_views` collection so we
keep it independent of the analytics `client_events` stream (which is
TTL-purged at 90 days).  We dedupe consecutive views within a 30-second
window per (user_or_session, product_id) so refreshes don't pollute the
recently-viewed list.

If the caller is anonymous we attribute the view to `session_id`; both
auth users and anonymous sessions can subsequently READ their own
recently-viewed list (the latter via `?session_id=…`).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import db
from deps import get_current_user, get_current_user_optional
from models import Product

logger = logging.getLogger("allsale.recs")
router = APIRouter(tags=["recommendations"])

# Skip writing duplicate view docs if the same user/session viewed the
# same product within this window (helps with React Strict Mode double
# renders + plain page-refresh noise).
DEDUPE_WINDOW = timedelta(seconds=30)

# How many recently-viewed items to retain per identity.
MAX_RECENT = 50


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ViewIn(BaseModel):
    session_id: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Stable anonymous client id for unauthenticated callers.",
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# POST /api/products/{product_id}/view  (auth optional)
# ---------------------------------------------------------------------------
@router.post("/products/{product_id}/view", status_code=204)
async def track_product_view(
    product_id: str,
    body: Optional[ViewIn] = None,
    user=Depends(get_current_user_optional),
):
    """Record that a buyer viewed a product.

    * Auth user  →  attributed to `user_id`
    * Anonymous  →  attributed to `session_id` (must be supplied in body)

    The endpoint is fire-and-forget and never blocks the page render —
    failures are logged and swallowed (always 204).
    """
    # Cheap existence check so we don't accumulate views for typos / 404s.
    exists = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "id": 1}
    )
    if not exists:
        # Silent ignore — don't leak which IDs exist via analytics.
        return None

    user_id = (user or {}).get("id") if isinstance(user, dict) else None
    session_id = (body.session_id if body else None) or None
    if not user_id and not session_id:
        # Need at least one identity to attribute the view to.
        return None

    # Dedupe within DEDUPE_WINDOW — upsert by (identity, product_id) so we
    # always overwrite the most recent timestamp instead of appending.
    now = _now()
    identity_match: dict = (
        {"user_id": user_id} if user_id else {"session_id": session_id}
    )
    identity_match["product_id"] = product_id
    recent = await db.product_views.find_one(
        {**identity_match, "viewed_at": {"$gte": now - DEDUPE_WINDOW}},
        {"_id": 0, "id": 1},
    )
    if recent:
        return None

    try:
        await db.product_views.update_one(
            identity_match,
            {
                "$set": {
                    "user_id": user_id,
                    "session_id": session_id if not user_id else None,
                    "product_id": product_id,
                    "viewed_at": now,
                },
                "$inc": {"view_count": 1},
            },
            upsert=True,
        )
    except Exception as exc:
        logger.warning("product_views upsert failed: %s", exc)
    return None


# ---------------------------------------------------------------------------
# GET /api/recommendations/recently-viewed  (auth or session_id)
# ---------------------------------------------------------------------------
@router.get("/recommendations/recently-viewed", response_model=list[Product])
async def get_recently_viewed(
    limit: int = Query(default=12, ge=1, le=50),
    session_id: Optional[str] = Query(
        default=None,
        max_length=120,
        description="Required for anonymous users.",
    ),
    user=Depends(get_current_user_optional),
):
    """Return the user's most recently viewed products (excluding sold-out)."""
    user_id = (user or {}).get("id") if isinstance(user, dict) else None
    if not user_id and not session_id:
        raise HTTPException(
            status_code=400,
            detail="Sign in or provide a session_id to fetch recently-viewed.",
        )

    identity = {"user_id": user_id} if user_id else {"session_id": session_id}

    # Pull more than `limit` so we can filter dead products without re-querying.
    cursor = (
        db.product_views.find(identity, {"_id": 0, "product_id": 1, "viewed_at": 1})
        .sort("viewed_at", -1)
        .limit(MAX_RECENT)
    )
    rows = [r async for r in cursor]
    if not rows:
        return []

    product_ids = [r["product_id"] for r in rows]
    docs: dict[str, dict] = {}
    async for p in db.products.find(
        {"id": {"$in": product_ids}}, {"_id": 0}
    ):
        if (p.get("stock_count") or 0) > 0:
            docs[p["id"]] = p

    out: list[Product] = []
    for r in rows:
        pid = r["product_id"]
        p = docs.get(pid)
        if not p:
            continue
        try:
            out.append(Product(**p))
        except Exception:
            continue
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------------------
# DELETE /api/recommendations/recently-viewed  (auth or session_id)
# ---------------------------------------------------------------------------
@router.delete("/recommendations/recently-viewed", status_code=204)
async def clear_recently_viewed(
    session_id: Optional[str] = Query(default=None, max_length=120),
    user=Depends(get_current_user_optional),
):
    """Clear the caller's recently-viewed history."""
    user_id = (user or {}).get("id") if isinstance(user, dict) else None
    if not user_id and not session_id:
        raise HTTPException(
            status_code=400,
            detail="Sign in or provide a session_id to clear recently-viewed.",
        )
    identity = {"user_id": user_id} if user_id else {"session_id": session_id}
    try:
        await db.product_views.delete_many(identity)
    except Exception as exc:
        logger.warning("product_views clear failed: %s", exc)
    return None
