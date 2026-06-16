"""Client-side analytics + A/B exposure ingestion.

POST /api/events                — fire-and-forget event collector (anon OK)
GET  /api/admin/events/funnel   — per-experiment funnel aggregator (admin)
GET  /api/admin/events/recent   — tail of latest events for debugging (admin)

Storage: `client_events` collection, TTL'd to 90 days (see db.ensure_indexes).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from db import db
from deps import get_current_user_optional
from services.admin_auth import require_roles

logger = logging.getLogger("allsale.events")
router = APIRouter(tags=["events"])

# ---------------------------------------------------------------------------
# Limits — keep the payload small & well-behaved.
# ---------------------------------------------------------------------------
_MAX_NAME_LEN = 80
_MAX_PROPS_KEYS = 30
_MAX_PROPS_VALUE_LEN = 500
_ALLOWED_NAME_RX = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-:"


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------
class EventIn(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=_MAX_NAME_LEN,
        description="Event name, e.g. 'ab.exposure', 'page.view', 'cart.add'.",
    )
    props: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary client-supplied properties.  Capped at "
        f"{_MAX_PROPS_KEYS} keys / {_MAX_PROPS_VALUE_LEN}-char string values.",
    )
    session_id: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Stable anonymous client id (cookie-based) for attribution.",
    )
    page: Optional[str] = Field(
        default=None,
        max_length=512,
        description="Pathname (NOT full URL — strip origin client-side).",
    )

    @field_validator("name")
    @classmethod
    def _name_chars(cls, v: str) -> str:
        if not all(c in _ALLOWED_NAME_RX for c in v):
            raise ValueError(
                "name must use [A-Za-z0-9._:-] only (no spaces / quotes / slashes)"
            )
        return v

    @field_validator("props")
    @classmethod
    def _bound_props(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(v) > _MAX_PROPS_KEYS:
            raise ValueError(f"props supports at most {_MAX_PROPS_KEYS} keys")
        for k, val in list(v.items()):
            if not isinstance(k, str) or not k:
                raise ValueError("prop keys must be non-empty strings")
            if isinstance(val, str) and len(val) > _MAX_PROPS_VALUE_LEN:
                v[k] = val[:_MAX_PROPS_VALUE_LEN]
        return v


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# POST /api/events  (anonymous OK)
# ---------------------------------------------------------------------------
@router.post("/events", status_code=204)
async def ingest_event(
    body: EventIn,
    user=Depends(get_current_user_optional),
    user_agent: Annotated[Optional[str], Header(alias="user-agent")] = None,
):
    """Lightweight fire-and-forget event ingestion.

    * Anonymous OK (no auth header → user_id stays null).
    * If a valid `Authorization: Bearer <jwt>` is present, the user is
      attached server-side (clients can NOT spoof user_id from the body).
    * Always returns 204 even on validation soft-failures so the client never
      blocks on analytics.  Validation errors come through as 422 from
      Pydantic and are silently dropped by `keepalive: true` on the client.
    """
    doc = {
        "id": uuid.uuid4().hex,
        "name": body.name,
        "props": body.props or {},
        "session_id": body.session_id,
        "page": body.page,
        "user_id": (user or {}).get("id") if isinstance(user, dict) else None,
        "user_agent": (user_agent or "")[:300],
        "created_at": _now(),
    }
    try:
        await db.client_events.insert_one(doc)
    except Exception as exc:
        # Never let analytics break user flow.  Log + return 204 anyway so the
        # client's fire-and-forget contract holds.
        logger.warning("client_events insert failed: %s", exc)
    return None


# ---------------------------------------------------------------------------
# GET /api/admin/events/funnel  (owner + manager)
# ---------------------------------------------------------------------------
@router.get("/admin/events/funnel")
async def funnel(
    experiment: str,
    days: int = 14,
    conversion_event: Optional[str] = None,
    admin=Depends(require_roles("manager")),
):
    """Aggregate A/B exposures and (optionally) conversions per variant.

    Returns counts of exposures + downstream conversion events for the given
    experiment.  A "conversion" is any subsequent event by the SAME
    `session_id` (or `user_id` if logged in) that matches `conversion_event`.

    Args:
      experiment        — e.g. "personalised_rail_v1"
      days              — lookback window (default 14, max 90)
      conversion_event  — e.g. "checkout.complete" (optional)

    Response shape:
      {
        "experiment": "...",
        "window_days": 14,
        "variants": {
          "control":   { "exposures": 1234, "conversions": 87,  "rate": 0.0705 },
          "treatment": { "exposures": 1198, "conversions": 102, "rate": 0.0851 }
        }
      }
    """
    days = max(1, min(int(days), 90))
    since = _now() - timedelta(days=days)

    # Step 1 — exposure counts grouped by variant.
    exposure_pipeline = [
        {
            "$match": {
                "name": "ab.exposure",
                "props.experiment": experiment,
                "created_at": {"$gte": since},
            }
        },
        {
            "$group": {
                "_id": "$props.variant",
                "exposures": {"$sum": 1},
                "session_ids": {"$addToSet": "$session_id"},
                "user_ids": {"$addToSet": "$user_id"},
            }
        },
    ]
    exposures = {
        (row["_id"] or "_unknown"): row
        async for row in db.client_events.aggregate(exposure_pipeline)
    }

    out_variants: dict[str, dict] = {}
    for variant, row in exposures.items():
        out_variants[variant] = {
            "exposures": row["exposures"],
            "conversions": 0,
            "rate": 0.0,
        }

    # Step 2 — optional conversion counts (correlate by session_id OR user_id).
    if conversion_event:
        for variant, row in exposures.items():
            sids = [s for s in row.get("session_ids", []) if s]
            uids = [u for u in row.get("user_ids", []) if u]
            if not sids and not uids:
                continue
            match: dict[str, Any] = {
                "name": conversion_event,
                "created_at": {"$gte": since},
            }
            or_clauses = []
            if sids:
                or_clauses.append({"session_id": {"$in": sids}})
            if uids:
                or_clauses.append({"user_id": {"$in": uids}})
            match["$or"] = or_clauses
            conv = await db.client_events.count_documents(match)
            out_variants[variant]["conversions"] = conv
            if row["exposures"] > 0:
                out_variants[variant]["rate"] = round(
                    conv / row["exposures"], 4
                )

    return {
        "experiment": experiment,
        "window_days": days,
        "conversion_event": conversion_event,
        "variants": out_variants,
        "total_exposures": sum(v["exposures"] for v in out_variants.values()),
        "total_conversions": sum(v["conversions"] for v in out_variants.values()),
    }


# ---------------------------------------------------------------------------
# GET /api/admin/events/recent  (owner + manager) — debugging tail
# ---------------------------------------------------------------------------
@router.get("/admin/events/recent")
async def recent(
    limit: int = 50,
    name: Optional[str] = None,
    admin=Depends(require_roles("manager")),
):
    """Tail of the most recent events.  Useful while wiring client tracking."""
    limit = max(1, min(int(limit), 500))
    q: dict[str, Any] = {}
    if name:
        q["name"] = name
    out = []
    async for row in (
        db.client_events.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    ):
        out.append(row)
    return {"events": out, "count": len(out)}
