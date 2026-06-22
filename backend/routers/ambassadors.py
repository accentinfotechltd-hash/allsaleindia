"""Ambassador / Nano-Influencer Affiliate Program.

Two-channel program split by country:
  • Non-India (NZ/AU/US/UK/CA) → B2C — customer code, 5/8/12% tiered
  • India only → B2B — seller code, ₹5K bounty + 10% rev-share (6mo, cap ₹75K)
                       + 1% lifetime tail

Coupon system is reused: on signup we auto-create a coupon doc keyed by
the ambassador's code so checkout's existing coupon flow validates it for
free.  Order-time attribution writes the ambassador_id back onto the order.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr, Field

from db import db
from deps import get_current_user
from services.admin_auth import require_roles

logger = logging.getLogger("allsale.ambassadors")
router = APIRouter(tags=["ambassadors"])

# ---------------------------------------------------------------------------
# Constants — programme rules (single source of truth)
# ---------------------------------------------------------------------------
B2C_COUNTRIES = {"NZ", "AU", "US", "GB", "CA"}
B2B_COUNTRIES = {"IN"}

# B2C tiered commission (% per order)
B2C_TIERS = [
    {"key": "starter",  "label": "Starter",  "rate_pct": 5,  "min_orders_30d": 0},
    {"key": "gold",     "label": "Gold",     "rate_pct": 8,  "min_orders_30d": 10},
    {"key": "platinum", "label": "Platinum", "rate_pct": 12, "min_orders_30d": 50},
]
B2C_CUSTOMER_DISCOUNT_PCT = 5          # the discount the BUYER gets
B2C_ATTRIBUTION_DAYS = 90              # cookie window for repeat purchases

# B2B (India) rev-share
B2B_BOUNTY_INR = 5_000                  # paid after referred seller ships 5 orders
B2B_BOUNTY_TRIGGER_ORDERS = 5
B2B_HOT_PHASE_RATE_PCT = 10             # % of Allsale platform fee, months 1–6
B2B_HOT_PHASE_MONTHS = 6
B2B_HOT_PHASE_CAP_INR = 75_000          # per referred seller
B2B_TAIL_PHASE_RATE_PCT = 1             # % of platform fee, month 7+ forever
B2B_CLAWBACK_DAYS = 90                  # bounty refundable if seller suspended <90d
B2B_REFERRED_SELLER_FREE_PRO_MONTHS = 3

# Withdrawal minimums (in payout currency)
MIN_WITHDRAWAL = {"INR": 500, "NZD": 20, "AUD": 20,
                  "USD": 20, "GBP": 15, "CAD": 20}

# Inactivity rules
INACTIVE_DORMANT_DAYS = 60
INACTIVE_FORFEIT_DAYS = 180

# Content requirement
POSTS_REQUIRED_PER_MONTH = 4
COMMISSION_HOLD_DAYS = 7                # mirrors return window

# Country → ISO-4217 payout currency
COUNTRY_PAYOUT_CCY = {
    "NZ": "NZD", "AU": "AUD", "US": "USD", "GB": "GBP",
    "CA": "CAD", "IN": "INR",
}

# Programme type per country
PROGRAM_FOR_COUNTRY = {**{c: "B2C" for c in B2C_COUNTRIES},
                       **{c: "B2B" for c in B2B_COUNTRIES}}


# ---------------------------------------------------------------------------
# Pydantic — request / response shapes
# ---------------------------------------------------------------------------
class JoinRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    country: str = Field(..., min_length=2, max_length=2,
                         description="ISO-3166 alpha-2 — NZ/AU/US/GB/CA/IN")
    social_handle: Optional[str] = Field(default=None, max_length=120,
        description="Primary social handle, e.g. @sarahjenkins")
    primary_platform: Optional[Literal["instagram", "tiktok", "youtube",
                                       "facebook", "other"]] = "instagram"


class AmbassadorPublic(BaseModel):
    """Light-weight summary safe to expose at e.g. /code/{code}/preview."""
    name: str
    code: str
    primary_platform: Optional[str]
    program: Literal["B2C", "B2B", "BOTH"]
    code_b2b: Optional[str] = None  # set only when program == "BOTH"


class AmbassadorCodeResolve(BaseModel):
    """Public landing page payload for `/a/{code}` smart link.

    Lets the frontend show two CTAs ("Shop now" / "Sell on Allsale") and
    auto-apply the right code to the right surface even if the visitor
    arrived through the wrong-audience link.
    """
    type: Literal["b2c", "b2b"]
    code: str
    counterpart_code: Optional[str] = None
    name: str
    primary_platform: Optional[str] = None
    program: Literal["B2C", "B2B", "BOTH"]


class AmbassadorJoinResponse(BaseModel):
    """Returned by POST /ambassadors/join — includes an access token so the
    web/mobile UI can route straight to the dashboard without a separate
    login step. ``needs_password_setup`` is True for brand-new stub users
    (passwordless) — the UI should prompt them to set a password so they
    can return on another device."""
    access_token: str
    needs_password_setup: bool
    me: "AmbassadorMe"


class TierInfo(BaseModel):
    key: str
    label: str
    rate_pct: float
    min_orders_30d: int


class AmbassadorMe(BaseModel):
    id: str
    code: str                              # primary B2C code (everyone has one)
    code_b2b: Optional[str] = None         # set only for Indian ambassadors
    name: str
    email: EmailStr
    country: str
    payout_currency: str
    program: Literal["B2C", "B2B", "BOTH"]
    status: Literal["pending_approval", "active", "dormant", "suspended",
                    "forfeited", "rejected", "permanently_banned"]
    terms_accepted_at: Optional[datetime] = None
    terms_accepted_version: Optional[str] = None
    can_reapply_at: Optional[datetime] = None
    rejected_reason: Optional[str] = None
    tier: TierInfo
    next_tier: Optional[TierInfo]
    posts_this_month: int
    posts_required: int
    orders_30d: int
    lifetime_orders: int
    lifetime_commission: float            # in payout currency
    unpaid_balance: float                 # in payout currency
    pending_commission: float             # within 7-day hold
    revenue_driven: float                 # GMV in payout currency (B2C) / "—" (B2B)
    referred_sellers_count: int            # B2B only
    # Editable profile fields (see PATCH /me)
    social_handle: Optional[str] = None
    primary_platform: Optional[str] = None
    phone: Optional[str] = None
    audience_size: Optional[int] = None
    created_at: datetime
    last_active_at: Optional[datetime]


# Patch request — only the fields the web/mobile UI is allowed to edit.
# Everything else (code, country, email, program) ties to identity/payouts
# and must go through support.
_PHONE_RE = re.compile(r"^\+?[0-9 ()\-]{6,20}$")
_ALLOWED_PAYOUT_CCYS = set(COUNTRY_PAYOUT_CCY.values())  # {NZD,AUD,USD,GBP,CAD,INR}


class AmbassadorProfileUpdate(BaseModel):
    social_handle: Optional[str] = Field(default=None, max_length=120)
    primary_platform: Optional[Literal["instagram", "tiktok", "youtube",
                                       "facebook", "other"]] = None
    payout_currency: Optional[Literal["NZD", "AUD", "USD", "GBP", "CAD", "INR"]] = None
    phone: Optional[str] = Field(default=None, max_length=20)
    audience_size: Optional[int] = Field(default=None, ge=0, le=1_000_000_000)


class SaleRow(BaseModel):
    order_id: str
    order_short_id: str
    placed_at: datetime
    status: str
    order_total: float
    commission: float
    currency: str
    locked_at: Optional[datetime]   # commission becomes withdrawable after hold


class ReferredSellerRow(BaseModel):
    seller_id: str
    seller_name: str
    onboarded_at: datetime
    orders_to_date: int
    bounty_paid: bool
    months_since_onboard: int
    months_in_hot_phase_remaining: int
    earnings_to_date_inr: float


class ContentSubmission(BaseModel):
    id: str
    submitted_at: datetime
    post_url: str
    platform: str
    caption_preview: Optional[str]
    thumbnail_url: Optional[str]
    has_required_tag: bool
    status: Literal["pending", "verified", "rejected"]
    reject_reason: Optional[str]


class ContentSubmitRequest(BaseModel):
    post_url: str = Field(..., min_length=8, max_length=500)


# ---------------------------------------------------------------------------
# Helpers — code generation, tier resolution, profile read
# ---------------------------------------------------------------------------
_NAME_RE = re.compile(r"[^A-Z0-9]+")


def _generate_code(name: str, suffix: str) -> str:
    """Sarah Jenkins → SARAHJENKINS5  /  Rajesh Patel → RAJESHPATELBIZ."""
    base = _NAME_RE.sub("", (name or "").upper())[:18] or "AMBASSADOR"
    return f"{base}{suffix}"


async def _ensure_code_unique(code: str) -> str:
    """If `code` collides with existing coupon, append numeric tail until free."""
    attempt = code
    n = 2
    while await db.coupons.find_one({"code": attempt}, {"_id": 0, "code": 1}):
        attempt = f"{code}{n}"
        n += 1
        if n > 99:
            attempt = f"{code}{uuid.uuid4().hex[:4].upper()}"
            break
    return attempt


def _resolve_tier(orders_30d: int) -> tuple[dict, Optional[dict]]:
    """Return (current_tier, next_tier_or_None)."""
    current = B2C_TIERS[0]
    nxt: Optional[dict] = None
    for tier in B2C_TIERS:
        if orders_30d >= tier["min_orders_30d"]:
            current = tier
    for tier in B2C_TIERS:
        if tier["min_orders_30d"] > orders_30d:
            nxt = tier
            break
    return current, nxt


async def _count_orders_30d(user_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    return await db.orders.count_documents({
        "ambassador_id": user_id,
        "created_at": {"$gte": since},
        "$or": [
            {"payment_status": "paid"},
            {"status": {"$in": ["confirmed", "shipped", "delivered"]}},
        ],
    })


def _short_oid(oid: str) -> str:
    return (oid or "").replace("order_", "")[:10].upper()


# ---------------------------------------------------------------------------
# Public — preview an ambassador code (used by landing pages)
# ---------------------------------------------------------------------------
@router.get("/ambassadors/by-code/{code}", response_model=AmbassadorPublic)
async def lookup_code(code: str):
    """Public lookup. Returns 404 if code isn't a real ambassador code.
    Matches against EITHER the B2C code or the B2B code (Indian ambassadors
    have both)."""
    code = (code or "").upper().strip()
    user = await db.users.find_one(
        {"$or": [
            {"ambassador_profile.code": code},
            {"ambassador_profile.code_b2b": code},
         ],
         # Only `active` codes resolve publicly — pending_approval / rejected /
         # suspended / permanently_banned codes return 404 so buyers don't see
         # discounts that aren't yet live.
         "ambassador_profile.status": "active"},
        {"_id": 0, "full_name": 1, "ambassador_profile": 1},
    )
    if not user or not user.get("ambassador_profile"):
        raise HTTPException(status_code=404, detail="Ambassador code not found")
    prof = user["ambassador_profile"]
    return AmbassadorPublic(
        name=user.get("full_name") or "Ambassador",
        code=prof["code"],
        code_b2b=prof.get("code_b2b"),
        primary_platform=prof.get("primary_platform"),
        program=prof["program"],
    )


# ---------------------------------------------------------------------------
# Public — smart-link resolver for /a/{code} landing page
# ---------------------------------------------------------------------------
@router.get("/ambassadors/resolve/{code}", response_model=AmbassadorCodeResolve)
async def resolve_code(code: str):
    """Resolve an ambassador code (either B2C or B2B) to its full context.

    Returns ``type`` (b2c | b2b), the matched code, the counterpart (if any),
    and ambassador info — so the unified `/a/{code}` smart-link landing page
    can show the right CTA for each audience without confusing the visitor.

    404 if the code isn't an active ambassador code.
    """
    code = (code or "").upper().strip()
    user = await db.users.find_one(
        {"$or": [
            {"ambassador_profile.code": code},
            {"ambassador_profile.code_b2b": code},
         ],
         "ambassador_profile.status": "active"},
        {"_id": 0, "full_name": 1, "ambassador_profile": 1},
    )
    if not user or not user.get("ambassador_profile"):
        raise HTTPException(status_code=404, detail="Ambassador code not found")
    prof = user["ambassador_profile"]
    name = user.get("full_name") or "Ambassador"
    program = prof["program"]
    code_b2c = prof.get("code")
    code_b2b = prof.get("code_b2b")

    # ---- Decide which audience this code targets --------------------------
    # Precedence:
    #   1. Explicit match on `code_b2b` field → B2B
    #   2. Program is "B2B" only (legacy India ambassadors stored their
    #      single BIZ code under `code` not `code_b2b`) → B2B
    #   3. Otherwise → B2C
    is_b2b_match = bool(code_b2b) and code == (code_b2b or "").upper()
    legacy_b2b_only = (program == "B2B") and not code_b2b
    if is_b2b_match or legacy_b2b_only:
        # Counterpart B2C only meaningful for BOTH-program ambassadors who have
        # both a live customer code AND a recruit code.
        counterpart = code_b2c if (program == "BOTH" and code_b2c and code_b2c != code) else None
        # Resolved code is whichever field actually stores the BIZ code.
        resolved_code = code_b2b or code_b2c
        return AmbassadorCodeResolve(
            type="b2b",
            code=resolved_code,
            counterpart_code=counterpart,
            name=name,
            primary_platform=prof.get("primary_platform"),
            program=program,
        )
    # Visitor arrived via B2C link — auto-fire impression beacon below
    counterpart = code_b2b if program in ("B2B", "BOTH") else None
    return AmbassadorCodeResolve(
        type="b2c",
        code=code_b2c,
        counterpart_code=counterpart,
        name=name,
        primary_platform=prof.get("primary_platform"),
        program=program,
    )


# ---------------------------------------------------------------------------
# Public — impression tracking for /a/{code} smart-link analytics
# ---------------------------------------------------------------------------
class TrackVisitResp(BaseModel):
    ok: bool


@router.post("/ambassadors/track-visit/{code}", response_model=TrackVisitResp)
async def track_visit(code: str, request: Request):
    """Beacon-style impression counter for the `/a/{code}` smart-link.

    Fire-and-forget from the smart-link landing page on mount. Stores a
    privacy-safe row in ``ambassador_link_clicks`` (no raw IPs, no PII)
    plus rolling lifetime counter on the ambassador profile so the
    dashboard can render KPIs without an aggregation pipeline.

    Always returns 200 — never blocks the visitor's UX even when the code
    is invalid or the database is briefly unavailable. Aggregations are
    computed lazily in ``/ambassadors/me/link-metrics``.
    """
    code = (code or "").upper().strip()
    if not code:
        return TrackVisitResp(ok=False)
    user = await db.users.find_one(
        {"$or": [
            {"ambassador_profile.code": code},
            {"ambassador_profile.code_b2b": code},
         ],
         "ambassador_profile.status": "active"},
        {"_id": 0, "id": 1, "ambassador_profile.code_b2b": 1,
         "ambassador_profile.code": 1, "ambassador_profile.program": 1},
    )
    if not user:
        return TrackVisitResp(ok=False)
    prof = user.get("ambassador_profile") or {}
    # Decide which audience this code targets so analytics can split.
    is_b2b_match = bool(prof.get("code_b2b")) and code == prof["code_b2b"].upper()
    legacy_b2b_only = (prof.get("program") == "B2B") and not prof.get("code_b2b")
    click_type = "b2b" if (is_b2b_match or legacy_b2b_only) else "b2c"

    # Privacy-safe IP hash for unique-visitor estimation (no raw IPs stored).
    import hashlib
    ip_raw = request.client.host if request.client else ""
    ip_hash = hashlib.sha256(f"allsale:{ip_raw}".encode()).hexdigest()[:16] if ip_raw else None
    ua = (request.headers.get("user-agent") or "")[:200]

    now = datetime.now(timezone.utc)
    try:
        await db.ambassador_link_clicks.insert_one({
            "user_id": user["id"],
            "code": code,
            "type": click_type,
            "ts": now,
            "ip_hash": ip_hash,
            "user_agent": ua,
        })
        # Rolling lifetime counters on the profile for cheap dashboard reads.
        inc_field = "link_clicks_b2b" if click_type == "b2b" else "link_clicks_b2c"
        await db.users.update_one(
            {"id": user["id"]},
            {"$inc": {f"ambassador_profile.{inc_field}": 1,
                      "ambassador_profile.link_clicks_total": 1}},
        )
    except Exception:
        # Never fail the visitor's request — analytics are best-effort.
        pass
    return TrackVisitResp(ok=True)


class LinkMetrics(BaseModel):
    """Per-ambassador click → conversion KPIs surfaced on the dashboard."""
    clicks_total: int
    clicks_b2c: int
    clicks_b2b: int
    clicks_7d: int
    clicks_30d: int
    uniques_7d: int                # distinct ip_hash visitors in last 7d
    uniques_30d: int               # distinct ip_hash visitors in last 30d
    conversions_30d: int           # attributed paid orders (B2C) in last 30d
    seller_signups_30d: int        # referred sellers in last 30d (B2B)
    conversion_rate_30d: float     # conversions / clicks_30d × 100


@router.get("/ambassadors/me/link-metrics", response_model=LinkMetrics)
async def my_link_metrics(current=Depends(get_current_user)):
    """Click → conversion KPIs for the calling ambassador's smart-link.

    Used by the ambassador dashboard "Link Performance" card.
    Returns 404 if the caller isn't an active ambassador.
    """
    prof = (current.get("ambassador_profile") or {}) if isinstance(current, dict) else {}
    if not prof:
        # Defensive — current is a Pydantic model on most routes; re-fetch.
        u = await db.users.find_one({"id": current.id if hasattr(current, "id") else current["id"]},
                                    {"_id": 0, "id": 1, "ambassador_profile": 1})
        if not u or not u.get("ambassador_profile"):
            raise HTTPException(status_code=404, detail="Not an ambassador")
        prof = u["ambassador_profile"]
        user_id = u["id"]
    else:
        user_id = current["id"] if isinstance(current, dict) else current.id

    now = datetime.now(timezone.utc)
    since_7d = now - timedelta(days=7)
    since_30d = now - timedelta(days=30)

    clicks_7d = await db.ambassador_link_clicks.count_documents(
        {"user_id": user_id, "ts": {"$gte": since_7d}}
    )
    clicks_30d = await db.ambassador_link_clicks.count_documents(
        {"user_id": user_id, "ts": {"$gte": since_30d}}
    )

    # Unique-visitor estimation: distinct non-null ip_hash within each window.
    # Privacy-safe (the raw IP is hashed via SHA-256 at insert time).
    uniques_7d_rows = await db.ambassador_link_clicks.distinct(
        "ip_hash", {"user_id": user_id, "ts": {"$gte": since_7d}, "ip_hash": {"$ne": None}}
    )
    uniques_30d_rows = await db.ambassador_link_clicks.distinct(
        "ip_hash", {"user_id": user_id, "ts": {"$gte": since_30d}, "ip_hash": {"$ne": None}}
    )

    # Conversions = B2C attributed paid orders in last 30d
    conversions_30d = await db.orders.count_documents({
        "ambassador_user_id": user_id,
        "payment_status": {"$in": ["paid", "succeeded", "captured"]},
        "created_at": {"$gte": since_30d},
    })
    # Seller signups credited to this ambassador in last 30d
    seller_signups_30d = await db.users.count_documents({
        "referred_by_ambassador_id": user_id,
        "is_seller": True,
        "created_at": {"$gte": since_30d},
    })

    rate = round(conversions_30d / clicks_30d * 100, 1) if clicks_30d > 0 else 0.0
    return LinkMetrics(
        clicks_total=int(prof.get("link_clicks_total", 0)),
        clicks_b2c=int(prof.get("link_clicks_b2c", 0)),
        clicks_b2b=int(prof.get("link_clicks_b2b", 0)),
        clicks_7d=clicks_7d,
        clicks_30d=clicks_30d,
        uniques_7d=len(uniques_7d_rows),
        uniques_30d=len(uniques_30d_rows),
        conversions_30d=conversions_30d,
        seller_signups_30d=seller_signups_30d,
        conversion_rate_30d=rate,
    )


class DailyClicks(BaseModel):
    date: str            # ISO date e.g. "2026-06-21"
    b2c: int
    b2b: int
    total: int


@router.get("/ambassadors/me/link-clicks-daily", response_model=list[DailyClicks])
async def my_link_clicks_daily(
    days: int = 30,
    current=Depends(get_current_user),
):
    """Daily click time-series for the calling ambassador's smart-links.

    Returns one row per day (UTC) for the last ``days`` (max 90, min 1),
    including zero-rows for days with no clicks so the dashboard chart can
    render a contiguous bar series without client-side gap-filling.
    """
    days = max(1, min(int(days or 30), 90))
    user_id = current.id if hasattr(current, "id") else current["id"]
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Mongo aggregation: group by UTC date.
    pipeline = [
        {"$match": {"user_id": user_id, "ts": {"$gte": start}}},
        {"$project": {
            "type": 1,
            "date": {"$dateToString": {"format": "%Y-%m-%d", "date": "$ts"}},
        }},
        {"$group": {
            "_id": "$date",
            "b2c": {"$sum": {"$cond": [{"$eq": ["$type", "b2c"]}, 1, 0]}},
            "b2b": {"$sum": {"$cond": [{"$eq": ["$type", "b2b"]}, 1, 0]}},
        }},
    ]
    buckets: dict[str, dict[str, int]] = {}
    async for row in db.ambassador_link_clicks.aggregate(pipeline):
        buckets[row["_id"]] = {"b2c": int(row["b2c"]), "b2b": int(row["b2b"])}

    series: list[DailyClicks] = []
    for i in range(days):
        d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        bk = buckets.get(d, {"b2c": 0, "b2b": 0})
        series.append(DailyClicks(date=d, b2c=bk["b2c"], b2b=bk["b2b"], total=bk["b2c"] + bk["b2b"]))
    return series


# ---------------------------------------------------------------------------
# POST /api/ambassadors/join  —  signup
# ---------------------------------------------------------------------------
@router.post("/ambassadors/join", status_code=201, response_model=AmbassadorJoinResponse)
async def join_program(body: JoinRequest, request: Request):
    country = body.country.upper()
    program = PROGRAM_FOR_COUNTRY.get(country)
    if not program:
        raise HTTPException(
            status_code=400,
            detail=f"Sorry — the ambassador programme isn't open in {country} yet.",
        )

    payout_ccy = COUNTRY_PAYOUT_CCY[country]
    email_lc = str(body.email).lower()
    existing = await db.users.find_one({"email": email_lc}, {"_id": 0})
    now = datetime.now(timezone.utc)

    # ---- Re-application path -------------------------------------------------
    # If the user previously applied and was rejected, we let them re-apply
    # once their 30-day cool-down has elapsed. Permanently-banned users
    # cannot ever re-apply.
    if existing and existing.get("ambassador_profile"):
        prof = existing["ambassador_profile"]
        status = prof.get("status")
        if status == "permanently_banned":
            raise HTTPException(
                status_code=403,
                detail="This account is not eligible for the ambassador programme.",
            )
        if status == "rejected":
            can_reapply_at = prof.get("can_reapply_at")
            if can_reapply_at and can_reapply_at.tzinfo is None:
                can_reapply_at = can_reapply_at.replace(tzinfo=timezone.utc)
            if can_reapply_at and can_reapply_at > now:
                raise HTTPException(
                    status_code=409,
                    detail=(f"You can re-apply after "
                            f"{can_reapply_at.strftime('%-d %B %Y')}."),
                )
            # Reset back to pending_approval — keep their existing code so any
            # legacy links still work post-approval.
            await db.users.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "ambassador_profile.status": "pending_approval",
                    "ambassador_profile.social_handle": body.social_handle,
                    "ambassador_profile.primary_platform": body.primary_platform,
                    "ambassador_profile.last_active_at": now,
                    "ambassador_profile.reapplied_at": now,
                 },
                 "$unset": {"ambassador_profile.rejected_at": "",
                            "ambassador_profile.rejected_reason": "",
                            "ambassador_profile.rejected_by": "",
                            "ambassador_profile.can_reapply_at": ""}},
            )
            # Best-effort notify; failure must not block re-application.
            try:
                from services.ambassador_email import (
                    send_application_received,
                    send_new_application_to_admin,
                )
                send_application_received(
                    email_lc, body.name, prof["code"], prof.get("code_b2b"))
                send_new_application_to_admin(
                    body.name, email_lc, country,
                    body.social_handle, body.primary_platform, prof["code"])
            except Exception:
                logger.exception("re-application email send failed")
            return await _build_join_response(existing["id"])
        # Active / pending / dormant / suspended → already enrolled.
        raise HTTPException(
            status_code=409,
            detail="You're already enrolled in the ambassador programme.",
        )

    # ---- Fresh application ---------------------------------------------------
    desired_b2c = _generate_code(body.name, "5")
    code_b2c = await _ensure_code_unique(desired_b2c)
    code_b2b: Optional[str] = None
    if program in ("B2B", "BOTH"):
        desired_b2b = _generate_code(body.name, "BIZ")
        code_b2b = await _ensure_code_unique(desired_b2b)

    profile_doc = {
        "code": code_b2c,
        "code_b2b": code_b2b,
        "country": country,
        "payout_currency": payout_ccy,
        "primary_platform": body.primary_platform,
        "social_handle": body.social_handle,
        "program": program,
        # NEW: applications start in pending_approval and require both
        # T&C acceptance + admin approval before going live.
        "status": "pending_approval",
        "tier_key": "starter",
        "lifetime_commission_minor": 0,
        "unpaid_balance_minor": 0,
        "pending_commission_minor": 0,
        "revenue_driven_minor": 0,
        "lifetime_orders": 0,
        "referred_sellers_count": 0,
        "joined_at": now,
        "last_active_at": now,
        "signup_ip": request.client.host if request.client else None,
    }

    if existing:
        user_id = existing["id"]
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"ambassador_profile": profile_doc}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "id": user_id,
            "email": email_lc,
            "full_name": body.name,
            "country": country,
            "is_seller": False,
            "is_admin": False,
            "email_verified": False,
            "password_hash": None,         # passwordless until claimed
            "created_at": now,
            "ambassador_profile": profile_doc,
        })

    # Auto-create the corresponding coupon doc so checkout validates the code
    # natively (only for B2C — B2B codes aren't used at customer checkout).
    # NOTE: starts INACTIVE — flipped to active=true only on admin approval.
    if program in ("B2C", "BOTH"):
        await db.coupons.insert_one({
            "id": f"cpn_amb_{uuid.uuid4().hex[:10]}",
            "code": code_b2c,
            "label": f"{body.name}'s ambassador code · {B2C_CUSTOMER_DISCOUNT_PCT}% off",
            "type": "percent",
            "value": float(B2C_CUSTOMER_DISCOUNT_PCT),
            "scope": "all",
            "scope_value": [],
            "min_order_nzd": 0.0,
            "max_discount_nzd": None,
            "active": False,               # ← INACTIVE until approval
            "valid_from": now,
            "valid_to": None,
            "usage_limit_total": 0,
            "per_user_limit": 999,
            "used_count": 0,
            "countries": [],
            "coupon_type": "ambassador_b2c",
            "ambassador_user_id": user_id,
            "created_at": now,
        })

    # Fire welcome + admin notify (best-effort, never block the API).
    try:
        from services.ambassador_email import (
            send_application_received,
            send_new_application_to_admin,
        )
        send_application_received(email_lc, body.name, code_b2c, code_b2b)
        send_new_application_to_admin(
            body.name, email_lc, country,
            body.social_handle, body.primary_platform, code_b2c)
    except Exception:
        logger.exception("application email send failed")

    return await _build_join_response(user_id)


async def _build_join_response(user_id: str) -> AmbassadorJoinResponse:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    me = await _build_me_response(user_id)
    needs_pw = not bool(user and user.get("password_hash"))
    from utils import create_token
    token = create_token(user_id, int((user or {}).get("token_version", 0) or 0))
    return AmbassadorJoinResponse(
        access_token=token, needs_password_setup=needs_pw, me=me,
    )


# ---------------------------------------------------------------------------
# GET /api/ambassadors/me
# ---------------------------------------------------------------------------
@router.get("/ambassadors/me", response_model=AmbassadorMe)
async def me(current=Depends(get_current_user)):
    return await _build_me_response(current["id"])


async def _build_me_response(user_id: str) -> AmbassadorMe:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user or not user.get("ambassador_profile"):
        raise HTTPException(status_code=404, detail="Not enrolled in the ambassador programme")
    prof = user["ambassador_profile"]
    payout_ccy = prof["payout_currency"]

    orders_30d = await _count_orders_30d(user_id)
    current_tier, next_tier = _resolve_tier(orders_30d)

    # Count content submissions this calendar month
    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0)
    posts_this_month = await db.ambassador_content.count_documents({
        "ambassador_id": user_id,
        "submitted_at": {"$gte": month_start},
        "status": {"$in": ["pending", "verified"]},
    })

    return AmbassadorMe(
        id=user_id,
        code=prof["code"],
        code_b2b=prof.get("code_b2b"),
        name=user.get("full_name") or "",
        email=user["email"],
        country=prof["country"],
        payout_currency=payout_ccy,
        program=prof["program"],
        status=prof.get("status", "active"),
        tier=TierInfo(**current_tier),
        next_tier=TierInfo(**next_tier) if next_tier else None,
        posts_this_month=posts_this_month,
        posts_required=POSTS_REQUIRED_PER_MONTH,
        orders_30d=orders_30d,
        lifetime_orders=int(prof.get("lifetime_orders", 0)),
        lifetime_commission=round(prof.get("lifetime_commission_minor", 0) / 100, 2),
        unpaid_balance=round(prof.get("unpaid_balance_minor", 0) / 100, 2),
        pending_commission=round(prof.get("pending_commission_minor", 0) / 100, 2),
        revenue_driven=round(prof.get("revenue_driven_minor", 0) / 100, 2),
        referred_sellers_count=int(prof.get("referred_sellers_count", 0)),
        social_handle=prof.get("social_handle"),
        primary_platform=prof.get("primary_platform"),
        phone=prof.get("phone"),
        audience_size=prof.get("audience_size"),
        terms_accepted_at=prof.get("terms_accepted_at"),
        terms_accepted_version=prof.get("terms_accepted_version"),
        can_reapply_at=prof.get("can_reapply_at"),
        rejected_reason=prof.get("rejected_reason"),
        created_at=prof.get("joined_at") or user.get("created_at") or datetime.now(timezone.utc),
        last_active_at=prof.get("last_active_at"),
    )


# ---------------------------------------------------------------------------
# PATCH /api/ambassadors/me  —  edit social_handle / payout_currency / phone /
#                              audience_size (no other fields editable here)
# ---------------------------------------------------------------------------
@router.patch("/ambassadors/me", response_model=AmbassadorMe)
async def update_me(body: AmbassadorProfileUpdate,
                    current=Depends(get_current_user)):
    prof = current.get("ambassador_profile") or {}
    if not prof:
        raise HTTPException(status_code=403, detail="Not enrolled in the ambassador programme")

    updates: dict = {}
    # ---- social_handle -----------------------------------------------------
    if body.social_handle is not None:
        sh = body.social_handle.strip()
        if sh and len(sh) < 2:
            raise HTTPException(status_code=400, detail="social_handle too short")
        updates["ambassador_profile.social_handle"] = sh or None

    # ---- primary_platform --------------------------------------------------
    if body.primary_platform is not None:
        updates["ambassador_profile.primary_platform"] = body.primary_platform

    # ---- phone -------------------------------------------------------------
    if body.phone is not None:
        ph = body.phone.strip()
        if ph and not _PHONE_RE.match(ph):
            raise HTTPException(
                status_code=400,
                detail="phone must be 6–20 chars: digits, spaces, '+', '-', '(' ')'",
            )
        updates["ambassador_profile.phone"] = ph or None

    # ---- audience_size -----------------------------------------------------
    if body.audience_size is not None:
        updates["ambassador_profile.audience_size"] = int(body.audience_size)

    # ---- payout_currency (extra guardrails) --------------------------------
    if body.payout_currency is not None:
        new_ccy = body.payout_currency
        if new_ccy not in _ALLOWED_PAYOUT_CCYS:
            raise HTTPException(status_code=400, detail="Unsupported payout currency")
        # Block change while money is in flight (avoids FX accounting headaches).
        unpaid = int(prof.get("unpaid_balance_minor", 0))
        pending = int(prof.get("pending_commission_minor", 0))
        if (unpaid + pending) > 0 and new_ccy != prof.get("payout_currency"):
            raise HTTPException(
                status_code=409,
                detail=("Cannot change payout currency while a balance is pending. "
                        "Withdraw or wait for the current balance to clear first."),
            )
        # India ambassadors stay on INR (Razorpay constraint).
        if prof.get("country") == "IN" and new_ccy != "INR":
            raise HTTPException(
                status_code=400,
                detail="India-based ambassadors must keep INR as payout currency.",
            )
        updates["ambassador_profile.payout_currency"] = new_ccy

    if not updates:
        # No-op patch is a valid response — just return current state.
        return await _build_me_response(current["id"])

    updates["ambassador_profile.last_active_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"id": current["id"]}, {"$set": updates})
    logger.info("ambassador profile updated id=%s fields=%s",
                current["id"], list(updates.keys()))
    return await _build_me_response(current["id"])


# ---------------------------------------------------------------------------
# GET /api/ambassadors/me/sales  —  B2C order history
# ---------------------------------------------------------------------------
@router.get("/ambassadors/me/sales", response_model=List[SaleRow])
async def my_sales(
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
    current=Depends(get_current_user),
):
    prof = (current.get("ambassador_profile") or {})
    if not prof:
        raise HTTPException(status_code=403, detail="Not enrolled")
    payout_ccy = prof.get("payout_currency", "NZD")
    rows: list[SaleRow] = []
    cursor = db.orders.find(
        {"ambassador_id": current["id"]},
        {"_id": 0, "id": 1, "created_at": 1, "status": 1,
         "payment_status": 1, "total_nzd": 1,
         "ambassador_commission_minor": 1,
         "ambassador_commission_currency": 1,
         "ambassador_locked_at": 1},
    ).sort("created_at", -1).skip(skip).limit(limit)
    async for o in cursor:
        comm = float(o.get("ambassador_commission_minor", 0)) / 100
        rows.append(SaleRow(
            order_id=o["id"],
            order_short_id=_short_oid(o["id"]),
            placed_at=o.get("created_at") or datetime.now(timezone.utc),
            status=o.get("status") or o.get("payment_status") or "pending",
            order_total=float(o.get("total_nzd") or 0),
            commission=comm,
            currency=o.get("ambassador_commission_currency") or payout_ccy,
            locked_at=o.get("ambassador_locked_at"),
        ))
    return rows


# ---------------------------------------------------------------------------
# GET /api/ambassadors/me/referred-sellers  —  B2B-only
# ---------------------------------------------------------------------------
@router.get("/ambassadors/me/referred-sellers",
            response_model=List[ReferredSellerRow])
async def my_referred_sellers(current=Depends(get_current_user)):
    prof = (current.get("ambassador_profile") or {})
    if not prof:
        raise HTTPException(status_code=403, detail="Not enrolled")
    if prof.get("program") != "B2B":
        return []
    now = datetime.now(timezone.utc)
    out: list[ReferredSellerRow] = []
    cursor = db.users.find(
        {"referred_by_ambassador_id": current["id"], "is_seller": True},
        {"_id": 0, "id": 1, "full_name": 1, "company_name": 1,
         "seller_onboarded_at": 1, "referral_bounty_paid": 1,
         "referral_earnings_inr": 1},
    ).sort("seller_onboarded_at", -1)
    async for s in cursor:
        onboarded = s.get("seller_onboarded_at") or now
        orders_to_date = await db.orders.count_documents({
            "items.seller_id": s["id"],
            "$or": [
                {"payment_status": "paid"},
                {"status": {"$in": ["confirmed", "shipped", "delivered"]}},
            ],
        })
        months_since = max(0, int((now - onboarded).days // 30))
        out.append(ReferredSellerRow(
            seller_id=s["id"],
            seller_name=s.get("company_name") or s.get("full_name") or "Seller",
            onboarded_at=onboarded,
            orders_to_date=orders_to_date,
            bounty_paid=bool(s.get("referral_bounty_paid")),
            months_since_onboard=months_since,
            months_in_hot_phase_remaining=max(0, B2B_HOT_PHASE_MONTHS - months_since),
            earnings_to_date_inr=round(float(s.get("referral_earnings_inr") or 0), 2),
        ))
    return out


# ---------------------------------------------------------------------------
# Content submission
# ---------------------------------------------------------------------------
@router.post("/ambassadors/me/content", response_model=ContentSubmission,
             status_code=201)
async def submit_content(body: ContentSubmitRequest,
                         current=Depends(get_current_user)):
    if not current.get("ambassador_profile"):
        raise HTTPException(status_code=403, detail="Not enrolled")
    url = body.post_url.strip()
    if not re.match(r"^https?://", url):
        raise HTTPException(status_code=400, detail="post_url must start with http(s)://")
    platform = "other"
    for plat, dom in [
        ("instagram", "instagram.com"), ("tiktok", "tiktok.com"),
        ("youtube", "youtu"), ("facebook", "facebook.com"),
        ("twitter", "twitter.com"), ("twitter", "x.com"),
    ]:
        if dom in url:
            platform = plat
            break
    doc_id = f"cont_{uuid.uuid4().hex[:12]}"
    doc = {
        "id": doc_id,
        "ambassador_id": current["id"],
        "post_url": url,
        "platform": platform,
        "submitted_at": datetime.now(timezone.utc),
        "status": "pending",
        "has_required_tag": False,         # admin verifies / future scrape job
        "caption_preview": None,
        "thumbnail_url": None,
        "reject_reason": None,
    }
    await db.ambassador_content.insert_one(doc)
    return ContentSubmission(**doc)


@router.get("/ambassadors/me/content", response_model=List[ContentSubmission])
async def list_my_content(current=Depends(get_current_user),
                          limit: int = Query(50, ge=1, le=200)):
    if not current.get("ambassador_profile"):
        raise HTTPException(status_code=403, detail="Not enrolled")
    out: list[ContentSubmission] = []
    cursor = db.ambassador_content.find(
        {"ambassador_id": current["id"]}, {"_id": 0}
    ).sort("submitted_at", -1).limit(limit)
    async for d in cursor:
        out.append(ContentSubmission(**d))
    return out


# ---------------------------------------------------------------------------
# Withdrawal
# ---------------------------------------------------------------------------
class WithdrawalResponse(BaseModel):
    requested_amount: float
    currency: str
    payout_method: Literal["razorpay", "stripe_connect"]
    status: Literal["queued", "blocked"]
    reason: Optional[str]


@router.post("/ambassadors/me/withdraw", response_model=WithdrawalResponse)
async def request_withdraw(current=Depends(get_current_user)):
    prof = current.get("ambassador_profile") or {}
    if not prof:
        raise HTTPException(status_code=403, detail="Not enrolled")
    balance = float(prof.get("unpaid_balance_minor", 0)) / 100
    ccy = prof.get("payout_currency", "NZD")
    min_amt = MIN_WITHDRAWAL.get(ccy, 20)
    if balance < min_amt:
        return WithdrawalResponse(
            requested_amount=balance, currency=ccy,
            payout_method="razorpay" if ccy == "INR" else "stripe_connect",
            status="blocked",
            reason=f"Below minimum withdrawal of {ccy} {min_amt}.",
        )
    # Phase 1 — queue only.  Actual payout via cron/admin action.
    await db.ambassador_withdrawals.insert_one({
        "id": f"wd_{uuid.uuid4().hex[:12]}",
        "ambassador_id": current["id"],
        "amount_minor": int(round(balance * 100)),
        "currency": ccy,
        "status": "queued",
        "requested_at": datetime.now(timezone.utc),
    })
    return WithdrawalResponse(
        requested_amount=balance, currency=ccy,
        payout_method="razorpay" if ccy == "INR" else "stripe_connect",
        status="queued", reason=None,
    )


# ---------------------------------------------------------------------------
# POST /api/ambassadors/accept-terms  —  user accepts the T&Cs
# ---------------------------------------------------------------------------
# Tracked terms version. Bumping this in code triggers a "re-accept" prompt
# on the frontend because /me will return null terms_accepted_at when the
# stored version is older. Keep simple v1 -> v2 etc. integers.
TERMS_CURRENT_VERSION = "v1"


class AcceptTermsRequest(BaseModel):
    version: Optional[str] = Field(default=None, max_length=8)


class AcceptTermsResponse(BaseModel):
    ok: bool
    terms_accepted_at: datetime
    terms_accepted_version: str


@router.post("/ambassadors/accept-terms", response_model=AcceptTermsResponse)
async def accept_terms(body: AcceptTermsRequest,
                       current=Depends(get_current_user)):
    """Records the logged-in ambassador's acceptance of the current T&Cs.

    Idempotent: re-accepting the same version returns the original
    timestamp. Accepting a newer version overwrites.
    """
    prof = current.get("ambassador_profile") or {}
    if not prof:
        raise HTTPException(status_code=403,
                            detail="Not enrolled in the ambassador programme")
    version = (body.version or TERMS_CURRENT_VERSION).strip()
    if version != TERMS_CURRENT_VERSION:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown terms version. Current is {TERMS_CURRENT_VERSION}.",
        )
    # Idempotency — if already on current version, return existing stamp.
    if (prof.get("terms_accepted_version") == version
            and prof.get("terms_accepted_at")):
        ts = prof["terms_accepted_at"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return AcceptTermsResponse(ok=True, terms_accepted_at=ts,
                                   terms_accepted_version=version)
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {
            "ambassador_profile.terms_accepted_at": now,
            "ambassador_profile.terms_accepted_version": version,
            "ambassador_profile.last_active_at": now,
        }},
    )
    # Best-effort confirmation email.
    try:
        from services.ambassador_email import send_terms_accepted
        send_terms_accepted(current["email"],
                            current.get("full_name") or "there", version)
    except Exception:
        logger.exception("terms_accepted email send failed")
    return AcceptTermsResponse(ok=True, terms_accepted_at=now,
                               terms_accepted_version=version)


# ---------------------------------------------------------------------------
# POST /api/ambassadors/resend-activation
#   — Re-fires the most relevant programme email for the logged-in user.
#     Smart-picks based on current status:
#       • pending_approval → re-sends the "Application received" email
#       • active           → re-sends the "Welcome, your code is live" email
#       • rejected         → 400 (use the rejection email's re-apply date)
#       • permanently_banned → 403
#     Rate-limited to 1 send per hour per ambassador to prevent abuse and
#     respect Resend's 2 req/sec ceiling.
# ---------------------------------------------------------------------------
RESEND_ACTIVATION_COOLDOWN_SECONDS = 3600  # 1 hour


class ResendActivationResponse(BaseModel):
    ok: bool
    kind: Literal["application_received", "welcome"]
    next_allowed_at: datetime


@router.post("/ambassadors/resend-activation",
             response_model=ResendActivationResponse)
async def resend_activation(current=Depends(get_current_user)):
    prof = current.get("ambassador_profile") or {}
    if not prof:
        raise HTTPException(status_code=403,
                            detail="Not enrolled in the ambassador programme")

    status = prof.get("status")
    if status == "permanently_banned":
        raise HTTPException(status_code=403,
                            detail="This account is not eligible.")
    if status in {"rejected", "suspended", "forfeited"}:
        raise HTTPException(
            status_code=400,
            detail=f"No activation email to resend in status '{status}'.",
        )
    if status not in {"pending_approval", "active", "dormant"}:
        raise HTTPException(status_code=400,
                            detail=f"Unsupported status '{status}'.")

    # Rate-limit check.
    now = datetime.now(timezone.utc)
    last = prof.get("last_resend_at")
    if last and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last:
        elapsed = (now - last).total_seconds()
        if elapsed < RESEND_ACTIVATION_COOLDOWN_SECONDS:
            retry_after = int(RESEND_ACTIVATION_COOLDOWN_SECONDS - elapsed)
            raise HTTPException(
                status_code=429,
                detail=(f"Please wait {retry_after // 60} more minute(s) "
                        f"before requesting another email."),
                headers={"Retry-After": str(retry_after)},
            )

    # Pick which email to send.
    kind: Literal["application_received", "welcome"]
    try:
        if status == "pending_approval":
            from services.ambassador_email import send_application_received
            send_application_received(
                current["email"], current.get("full_name") or "there",
                prof["code"], prof.get("code_b2b"))
            kind = "application_received"
        else:
            # active or dormant — re-send the "welcome, code is live" email
            from routers.ambassadors import _count_orders_30d, _resolve_tier
            orders_30d = await _count_orders_30d(current["id"])
            tier, _ = _resolve_tier(orders_30d)
            from services.ambassador_email import send_application_approved
            send_application_approved(
                current["email"], current.get("full_name") or "there",
                prof["code"], prof.get("code_b2b"),
                tier_label=tier["label"], rate_pct=tier["rate_pct"])
            kind = "welcome"
    except Exception:
        # Even if Resend rate-limits us, stamp the cooldown so callers can't
        # hammer the endpoint trying to retry our internal failures.
        logger.exception("resend-activation email send failed")

    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"ambassador_profile.last_resend_at": now}},
    )
    return ResendActivationResponse(
        ok=True, kind=kind,
        next_allowed_at=now + timedelta(seconds=RESEND_ACTIVATION_COOLDOWN_SECONDS),
    )


# ---------------------------------------------------------------------------
# ADMIN — listing, payout, content review
# ---------------------------------------------------------------------------
class AdminAmbRow(BaseModel):
    id: str
    name: str
    email: EmailStr
    code: str
    code_b2b: Optional[str] = None
    country: str
    payout_currency: str
    program: Literal["B2C", "B2B", "BOTH"]
    status: str
    tier_key: str
    unpaid_balance: float
    lifetime_commission: float
    lifetime_orders: int
    referred_sellers_count: int
    joined_at: datetime


@router.get("/admin/ambassadors", response_model=List[AdminAmbRow])
async def admin_list_ambassadors(
    program: Optional[Literal["B2C", "B2B"]] = None,
    status: Optional[str] = None,
    country: Optional[str] = None,
    has_unpaid_above: float = Query(0, ge=0,
        description="Filter to ambassadors whose unpaid balance exceeds this (in payout currency)"),
    limit: int = Query(50, ge=1, le=500),
    skip: int = Query(0, ge=0),
    admin=Depends(require_roles("manager", "support")),
):
    q: dict = {"ambassador_profile": {"$exists": True}}
    if program:
        q["ambassador_profile.program"] = program
    if status:
        q["ambassador_profile.status"] = status
    if country:
        q["ambassador_profile.country"] = country.upper()
    if has_unpaid_above > 0:
        q["ambassador_profile.unpaid_balance_minor"] = {"$gte": int(has_unpaid_above * 100)}
    out: list[AdminAmbRow] = []
    cursor = db.users.find(q, {"_id": 0}).sort(
        "ambassador_profile.joined_at", -1).skip(skip).limit(limit)
    async for u in cursor:
        prof = u["ambassador_profile"]
        out.append(AdminAmbRow(
            id=u["id"],
            name=u.get("full_name") or "",
            email=u["email"],
            code=prof["code"],
            code_b2b=prof.get("code_b2b"),
            country=prof["country"],
            payout_currency=prof["payout_currency"],
            program=prof["program"],
            status=prof.get("status", "active"),
            tier_key=prof.get("tier_key", "starter"),
            unpaid_balance=round(prof.get("unpaid_balance_minor", 0) / 100, 2),
            lifetime_commission=round(prof.get("lifetime_commission_minor", 0) / 100, 2),
            lifetime_orders=int(prof.get("lifetime_orders", 0)),
            referred_sellers_count=int(prof.get("referred_sellers_count", 0)),
            joined_at=prof.get("joined_at") or datetime.now(timezone.utc),
        ))
    return out


@router.post("/admin/ambassadors/{ambassador_id}/mark-paid")
async def admin_mark_paid(ambassador_id: str, request: Request,
                          admin=Depends(require_roles("manager"))):
    """Phase-1 manual payout: zero out the balance and log the action.
    Phase 2 will trigger real Razorpay/Stripe Connect transfer."""
    user = await db.users.find_one({"id": ambassador_id}, {"_id": 0})
    if not user or not user.get("ambassador_profile"):
        raise HTTPException(status_code=404, detail="Ambassador not found")
    prof = user["ambassador_profile"]
    paid_minor = int(prof.get("unpaid_balance_minor", 0))
    if paid_minor <= 0:
        return {"ok": True, "paid_amount": 0, "note": "Balance already zero."}
    await db.users.update_one(
        {"id": ambassador_id},
        {"$set": {"ambassador_profile.unpaid_balance_minor": 0,
                  "ambassador_profile.last_paid_at": datetime.now(timezone.utc)}},
    )
    await db.ambassador_payout_log.insert_one({
        "id": f"pay_{uuid.uuid4().hex[:12]}",
        "ambassador_id": ambassador_id,
        "amount_minor": paid_minor,
        "currency": prof["payout_currency"],
        "method": "manual",
        "admin_id": admin.get("id"),
        "admin_email": admin.get("email"),
        "paid_at": datetime.now(timezone.utc),
    })
    return {
        "ok": True,
        "paid_amount": round(paid_minor / 100, 2),
        "currency": prof["payout_currency"],
    }


@router.post("/admin/ambassadors/{ambassador_id}/content/{content_id}/review")
async def admin_review_content(
    ambassador_id: str, content_id: str,
    action: Literal["verify", "reject"] = Query(...),
    reason: Optional[str] = Query(default=None),
    admin=Depends(require_roles("manager", "support")),
):
    new_status = "verified" if action == "verify" else "rejected"
    res = await db.ambassador_content.update_one(
        {"id": content_id, "ambassador_id": ambassador_id},
        {"$set": {
            "status": new_status,
            "reviewed_at": datetime.now(timezone.utc),
            "reviewed_by_email": admin.get("email"),
            "has_required_tag": new_status == "verified",
            "reject_reason": reason if action == "reject" else None,
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Content submission not found")
    return {"ok": True, "status": new_status}


@router.post("/admin/ambassadors/{ambassador_id}/suspend")
async def admin_suspend(ambassador_id: str,
                        reason: str = Query(..., min_length=4),
                        admin=Depends(require_roles("manager"))):
    res = await db.users.update_one(
        {"id": ambassador_id, "ambassador_profile": {"$exists": True}},
        {"$set": {
            "ambassador_profile.status": "suspended",
            "ambassador_profile.suspended_at": datetime.now(timezone.utc),
            "ambassador_profile.suspended_reason": reason,
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ambassador not found")
    return {"ok": True, "status": "suspended"}


@router.post("/admin/ambassadors/{ambassador_id}/unsuspend")
async def admin_unsuspend(ambassador_id: str,
                          admin=Depends(require_roles("manager"))):
    """Reverse a suspension. Reactivates the ambassador's code immediately."""
    res = await db.users.update_one(
        {"id": ambassador_id, "ambassador_profile.status": "suspended"},
        {"$set": {"ambassador_profile.status": "active"},
         "$unset": {"ambassador_profile.suspended_at": "",
                    "ambassador_profile.suspended_reason": ""}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Suspended ambassador not found")
    return {"ok": True, "status": "active"}


@router.get("/admin/ambassadors/{ambassador_id}/content",
            response_model=List[ContentSubmission])
async def admin_list_ambassador_content(
    ambassador_id: str,
    status_filter: Optional[Literal["pending", "verified", "rejected"]] = Query(
        default=None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    admin=Depends(require_roles("manager", "support")),
):
    """List a given ambassador's content submissions, newest first."""
    q: dict = {"ambassador_id": ambassador_id}
    if status_filter:
        q["status"] = status_filter
    cursor = db.ambassador_content.find(
        q, {"_id": 0}).sort("submitted_at", -1).limit(limit)
    return [ContentSubmission(**doc) async for doc in cursor]


# ---------------------------------------------------------------------------
# ADMIN — approve / reject pending applications
# ---------------------------------------------------------------------------
REAPPLY_COOLDOWN_DAYS = 30


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=4, max_length=500)
    permanent: bool = False    # True ⇒ "permanently_banned" (fraud)


@router.post("/admin/ambassadors/{ambassador_id}/approve")
async def admin_approve(ambassador_id: str,
                        admin=Depends(require_roles("manager"))):
    """Flip a pending application to active. Activates the ambassador's
    coupon code and fires the welcome email.

    Pre-conditions:
        - ambassador exists
        - status == "pending_approval"
        - terms_accepted_at is set (admins cannot approve until the user has
          accepted the T&Cs — guards against legal liability)
    """
    user = await db.users.find_one(
        {"id": ambassador_id, "ambassador_profile": {"$exists": True}},
        {"_id": 0},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Ambassador not found")
    prof = user["ambassador_profile"]
    if prof.get("status") != "pending_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot approve — current status is '{prof.get('status')}'.",
        )
    if not prof.get("terms_accepted_at"):
        raise HTTPException(
            status_code=412,   # precondition failed
            detail="Cannot approve before the ambassador accepts the T&Cs.",
        )
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"id": ambassador_id},
        {"$set": {
            "ambassador_profile.status": "active",
            "ambassador_profile.approved_at": now,
            "ambassador_profile.approved_by": admin["id"],
            "ambassador_profile.last_active_at": now,
        }},
    )
    # Flip the coupon active so /by-code/{code} resolves and checkout
    # actually applies the discount.
    if prof.get("code"):
        await db.coupons.update_one(
            {"code": prof["code"], "coupon_type": "ambassador_b2c"},
            {"$set": {"active": True}},
        )
    # Best-effort email.
    try:
        from routers.ambassadors import _count_orders_30d, _resolve_tier
        # (Re-uses the same helpers used by /me — keeps tier label consistent.)
        orders_30d = await _count_orders_30d(ambassador_id)
        tier, _ = _resolve_tier(orders_30d)
        from services.ambassador_email import send_application_approved
        send_application_approved(
            user["email"], user.get("full_name") or "there",
            prof["code"], prof.get("code_b2b"),
            tier_label=tier["label"], rate_pct=tier["rate_pct"])
    except Exception:
        logger.exception("approval email send failed")
    logger.info("ambassador approved id=%s by=%s", ambassador_id, admin["id"])
    return {"ok": True, "status": "active", "approved_at": now}


@router.post("/admin/ambassadors/{ambassador_id}/reject")
async def admin_reject(ambassador_id: str, body: RejectRequest,
                       admin=Depends(require_roles("manager"))):
    """Decline an application. By default the applicant can re-apply after
    REAPPLY_COOLDOWN_DAYS; set ``permanent: true`` for fraud cases (no
    further re-applications)."""
    user = await db.users.find_one(
        {"id": ambassador_id, "ambassador_profile": {"$exists": True}},
        {"_id": 0},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Ambassador not found")
    prof = user["ambassador_profile"]
    current_status = prof.get("status")
    if current_status not in {"pending_approval", "active"}:
        # No-op for already rejected/banned/suspended/forfeited/dormant.
        raise HTTPException(
            status_code=409,
            detail=f"Cannot reject — current status is '{current_status}'.",
        )
    now = datetime.now(timezone.utc)
    new_status = "permanently_banned" if body.permanent else "rejected"
    can_reapply_at = (None if body.permanent
                      else now + timedelta(days=REAPPLY_COOLDOWN_DAYS))
    update_set: dict = {
        "ambassador_profile.status": new_status,
        "ambassador_profile.rejected_at": now,
        "ambassador_profile.rejected_reason": body.reason,
        "ambassador_profile.rejected_by": admin["id"],
    }
    if can_reapply_at:
        update_set["ambassador_profile.can_reapply_at"] = can_reapply_at
    await db.users.update_one({"id": ambassador_id}, {"$set": update_set})
    # Deactivate the coupon so the code stops working.
    if prof.get("code"):
        await db.coupons.update_one(
            {"code": prof["code"], "coupon_type": "ambassador_b2c"},
            {"$set": {"active": False}},
        )
    try:
        from services.ambassador_email import send_application_rejected
        send_application_rejected(
            user["email"], user.get("full_name") or "there",
            body.reason, can_reapply_at)
    except Exception:
        logger.exception("rejection email send failed")
    logger.info("ambassador rejected id=%s permanent=%s by=%s",
                ambassador_id, body.permanent, admin["id"])
    return {
        "ok": True,
        "status": new_status,
        "rejected_at": now,
        "can_reapply_at": can_reapply_at,
    }


# ---------------------------------------------------------------------------
# Programme config exposure (for both web + mobile to render rules)
# ---------------------------------------------------------------------------
@router.get("/ambassadors/program/config")
async def program_config():
    """Public read of all programme rules — for landing pages, T&C pages,
    tier explainers, FAQ etc.  Single source of truth."""
    return {
        "eligible_countries": {
            "B2C": sorted(B2C_COUNTRIES),
            "B2B": sorted(B2B_COUNTRIES),
        },
        "b2c": {
            "tiers": B2C_TIERS,
            "customer_discount_pct": B2C_CUSTOMER_DISCOUNT_PCT,
            "attribution_days": B2C_ATTRIBUTION_DAYS,
            "code_suffix": "5",
        },
        "b2b": {
            "bounty_inr": B2B_BOUNTY_INR,
            "bounty_trigger_orders": B2B_BOUNTY_TRIGGER_ORDERS,
            "hot_phase_rate_pct": B2B_HOT_PHASE_RATE_PCT,
            "hot_phase_months": B2B_HOT_PHASE_MONTHS,
            "hot_phase_cap_inr": B2B_HOT_PHASE_CAP_INR,
            "tail_rate_pct": B2B_TAIL_PHASE_RATE_PCT,
            "clawback_days": B2B_CLAWBACK_DAYS,
            "referred_seller_free_pro_months": B2B_REFERRED_SELLER_FREE_PRO_MONTHS,
            "code_suffix": "BIZ",
        },
        "content_requirement": {
            "posts_per_month": POSTS_REQUIRED_PER_MONTH,
            "required_tag": "@allsale.co.nz",
            "required_hashtag": "#allsale",
            "languages_allowed": "any",
        },
        "withdrawal_minimums": MIN_WITHDRAWAL,
        "commission_hold_days": COMMISSION_HOLD_DAYS,
        "inactivity": {
            "dormant_after_days": INACTIVE_DORMANT_DAYS,
            "forfeit_after_days": INACTIVE_FORFEIT_DAYS,
        },
    }
