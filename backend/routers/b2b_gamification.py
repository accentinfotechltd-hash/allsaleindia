"""B2B Referral Gamification — tiers, badges, leaderboard.

Sits on top of the existing ``seller_referrals`` collection. Pure
read-only/derived data — no schema changes, no migrations.

Tiers, badge rules and rank windows are configured below so a future
admin UI can take them over from a single source of truth.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db
from deps import get_current_user

router = APIRouter(prefix="/b2b/gamification", tags=["b2b-gamification"])


# ---------------------------------------------------------------------------
# Tier + badge configuration
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Tier:
    key: str
    label: str
    emoji: str
    color: str  # hex used by the UI for the ribbon
    min_approved: int  # inclusive lower bound of approved referrals


TIERS: tuple[Tier, ...] = (
    Tier("none",     "Newcomer", "🌱", "#94a3b8", 0),
    Tier("bronze",   "Bronze",   "🥉", "#b45309", 1),
    Tier("silver",   "Silver",   "🥈", "#64748b", 5),
    Tier("gold",     "Gold",     "🥇", "#ca8a04", 15),
    Tier("platinum", "Platinum", "💎", "#0e7490", 50),
)


@dataclass(frozen=True)
class Badge:
    key: str
    label: str
    description: str
    emoji: str
    # Predicate: returns True when the seller has earned this badge.
    # Receives ``stats`` (the dict that ``_compute_stats`` produces) and
    # ``rank`` (current all-time leaderboard rank or None).
    predicate: callable


def _badge_predicates() -> tuple[Badge, ...]:
    return (
        Badge("first_invite",   "First Yard",       "Sent your first invite",                        "✉️",   lambda s, r: s["invites_sent"] >= 1),
        Badge("first_win",      "First Win",        "First approved referral",                       "🎉",   lambda s, r: s["approved"] >= 1),
        Badge("hat_trick",      "Hat-Trick",        "3 approved referrals",                          "🎩",   lambda s, r: s["approved"] >= 3),
        Badge("power_network",  "Power Network",    "10 approved referrals",                         "⚡",   lambda s, r: s["approved"] >= 10),
        Badge("five_figures",   "Five Figures",     "$1,000 in lifetime commission earned",          "💰",   lambda s, r: s["commission_total_nzd"] >= 1000),
        Badge("six_figures",    "Six Figures",      "$10,000 in lifetime commission earned",         "🏦",   lambda s, r: s["commission_total_nzd"] >= 10000),
        Badge("top_10",         "Top 10",           "Currently in the all-time top 10 leaderboard",  "🏆",   lambda s, r: r is not None and r <= 10),
        Badge("top_3",          "Podium",           "Currently in the all-time top 3 leaderboard",   "🥇",   lambda s, r: r is not None and r <= 3),
        Badge("kingmaker",      "Kingmaker",        "Referred at least one Gold-tier seller",        "👑",   lambda s, r: s.get("kingmaker", False)),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _tier_for(approved: int) -> Tier:
    out = TIERS[0]
    for t in TIERS:
        if approved >= t.min_approved:
            out = t
    return out


def _next_tier(current: Tier) -> Optional[Tier]:
    for t in TIERS:
        if t.min_approved > current.min_approved:
            return t
    return None  # already platinum


async def _compute_stats(seller_id: str) -> dict:
    """Aggregate raw counts + commission from ``seller_referrals``."""
    invites_sent = 0
    signed_up = 0
    approved = 0
    commission_total = 0.0
    referee_ids: list[str] = []

    async for r in db.seller_referrals.find(
        {"referrer_seller_id": seller_id}, {"_id": 0}
    ):
        invites_sent += 1
        st = r.get("status")
        if st in ("signed_up", "approved"):
            signed_up += 1
        if st == "approved":
            approved += 1
            if r.get("referee_seller_id"):
                referee_ids.append(r["referee_seller_id"])
        commission_total += float(r.get("commission_due_nzd", 0)) + float(
            r.get("commission_paid_nzd", 0)
        )

    # Kingmaker: any referee currently sits at Gold tier+
    kingmaker = False
    if referee_ids:
        async for d in db.seller_referrals.aggregate(
            [
                {"$match": {"referrer_seller_id": {"$in": referee_ids}, "status": "approved"}},
                {"$group": {"_id": "$referrer_seller_id", "n": {"$sum": 1}}},
                {"$match": {"n": {"$gte": TIERS[3].min_approved}}},  # 15 = Gold
                {"$limit": 1},
            ]
        ):
            kingmaker = True
            break

    return {
        "invites_sent": invites_sent,
        "signed_up": signed_up,
        "approved": approved,
        "commission_total_nzd": round(commission_total, 2),
        "kingmaker": kingmaker,
    }


async def _all_time_rank(seller_id: str) -> Optional[int]:
    """Return 1-indexed rank by approved-referral count, or None if 0."""
    cursor = db.seller_referrals.aggregate(
        [
            {"$match": {"status": "approved"}},
            {"$group": {"_id": "$referrer_seller_id", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
        ]
    )
    rank = 0
    async for row in cursor:
        rank += 1
        if row["_id"] == seller_id:
            return rank
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/me")
async def me(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    stats = await _compute_stats(current["id"])
    tier = _tier_for(stats["approved"])
    next_t = _next_tier(tier)
    progress_pct = (
        100
        if next_t is None
        else min(
            100,
            int(stats["approved"] / max(next_t.min_approved, 1) * 100),
        )
    )
    rank = await _all_time_rank(current["id"])

    badges_out = []
    for b in _badge_predicates():
        unlocked = bool(b.predicate(stats, rank))
        badges_out.append(
            {
                "key": b.key,
                "label": b.label,
                "description": b.description,
                "emoji": b.emoji,
                "unlocked": unlocked,
            }
        )

    return {
        "stats": stats,
        "tier": {
            "key": tier.key,
            "label": tier.label,
            "emoji": tier.emoji,
            "color": tier.color,
            "min_approved": tier.min_approved,
        },
        "next_tier": (
            None
            if next_t is None
            else {
                "key": next_t.key,
                "label": next_t.label,
                "emoji": next_t.emoji,
                "min_approved": next_t.min_approved,
                "needed": max(0, next_t.min_approved - stats["approved"]),
            }
        ),
        "progress_pct": progress_pct,
        "rank_all_time": rank,
        "badges": badges_out,
        "unlocked_count": sum(1 for b in badges_out if b["unlocked"]),
    }


@router.get("/leaderboard")
async def leaderboard(
    period: Literal["all", "month", "week"] = "all",
    limit: int = Query(20, ge=1, le=50),
    current=Depends(get_current_user),
):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    match: dict = {"status": "approved"}
    if period in ("month", "week"):
        days = 30 if period == "month" else 7
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        match["approved_at"] = {"$gte": cutoff}

    rows: list[dict] = []
    async for r in db.seller_referrals.aggregate(
        [
            {"$match": match},
            {
                "$group": {
                    "_id": "$referrer_seller_id",
                    "approved": {"$sum": 1},
                    "commission": {"$sum": "$commission_due_nzd"},
                }
            },
            {"$sort": {"approved": -1, "commission": -1}},
            {"$limit": limit},
        ]
    ):
        rows.append(r)

    # Hydrate display name from sellers + users collections
    out = []
    me_rank: Optional[int] = None
    for idx, row in enumerate(rows, start=1):
        sid = row["_id"]
        if sid == current["id"]:
            me_rank = idx
        s_doc = await db.sellers.find_one(
            {"user_id": sid}, {"_id": 0, "company_name": 1, "city": 1}
        )
        u_doc = await db.users.find_one(
            {"id": sid}, {"_id": 0, "full_name": 1}
        )
        display = (
            (s_doc or {}).get("company_name")
            or (u_doc or {}).get("full_name")
            or "Allsale Seller"
        )
        tier = _tier_for(int(row["approved"]))
        out.append(
            {
                "rank": idx,
                "display_name": display,
                "city": (s_doc or {}).get("city"),
                "approved": int(row["approved"]),
                "commission_nzd": round(float(row.get("commission", 0)), 2),
                "tier": {
                    "key": tier.key,
                    "label": tier.label,
                    "emoji": tier.emoji,
                    "color": tier.color,
                },
                "is_me": sid == current["id"],
            }
        )

    return {
        "period": period,
        "count": len(out),
        "items": out,
        "my_rank": me_rank,
    }


@router.get("/tiers")
async def list_tiers():
    """Static info about the tier ladder — for the marketing card."""
    return {
        "tiers": [
            {
                "key": t.key,
                "label": t.label,
                "emoji": t.emoji,
                "color": t.color,
                "min_approved": t.min_approved,
            }
            for t in TIERS
        ],
        "badges": [
            {
                "key": b.key,
                "label": b.label,
                "description": b.description,
                "emoji": b.emoji,
            }
            for b in _badge_predicates()
        ],
    }
