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
    status: Literal["active", "dormant", "suspended", "forfeited"]
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
    created_at: datetime
    last_active_at: Optional[datetime]


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
         "ambassador_profile.status": {"$ne": "suspended"}},
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
# POST /api/ambassadors/join  —  signup
# ---------------------------------------------------------------------------
@router.post("/ambassadors/join", status_code=201, response_model=AmbassadorMe)
async def join_program(body: JoinRequest, request: Request):
    country = body.country.upper()
    program = PROGRAM_FOR_COUNTRY.get(country)
    if not program:
        raise HTTPException(
            status_code=400,
            detail=f"Sorry — the ambassador programme isn't open in {country} yet.",
        )

    payout_ccy = COUNTRY_PAYOUT_CCY[country]
    # Everyone gets a B2C-style code.  Indian ambassadors ALSO get a B2B code
    # since they can drive both customer sales (to diaspora abroad) AND seller
    # recruitment (in India).
    desired_b2c = _generate_code(body.name, "5")
    code_b2c = await _ensure_code_unique(desired_b2c)
    code_b2b: Optional[str] = None
    if program in ("B2B", "BOTH"):
        desired_b2b = _generate_code(body.name, "BIZ")
        code_b2b = await _ensure_code_unique(desired_b2b)

    # Reuse existing user account if email already on file; otherwise create
    # a "passwordless" stub user — they can claim it by setting a password
    # via /auth/forgot-password.
    existing = await db.users.find_one({"email": str(body.email).lower()},
                                        {"_id": 0})
    now = datetime.now(timezone.utc)
    profile_doc = {
        "code": code_b2c,
        "code_b2b": code_b2b,
        "country": country,
        "payout_currency": payout_ccy,
        "primary_platform": body.primary_platform,
        "social_handle": body.social_handle,
        "program": program,
        "status": "active",
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
        if existing.get("ambassador_profile"):
            raise HTTPException(
                status_code=409,
                detail="You're already enrolled in the ambassador programme.",
            )
        user_id = existing["id"]
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"ambassador_profile": profile_doc}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "id": user_id,
            "email": str(body.email).lower(),
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
    if program in ("B2C", "BOTH"):
        await db.coupons.insert_one({
            "id": f"cpn_amb_{uuid.uuid4().hex[:10]}",
            "code": code_b2c,
            "label": f"{body.name}'s ambassador code",
            "discount_pct": B2C_CUSTOMER_DISCOUNT_PCT,
            "coupon_type": "ambassador_b2c",
            "ambassador_user_id": user_id,
            "is_active": True,
            "max_uses_per_user": 999,
            "max_total_uses": 0,           # 0 = unlimited
            "min_order_nzd": 0,
            "starts_at": now,
            "ends_at": None,
            "created_at": now,
        })

    return await _build_me_response(user_id)


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
        created_at=prof.get("joined_at") or user.get("created_at") or datetime.now(timezone.utc),
        last_active_at=prof.get("last_active_at"),
    )


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
