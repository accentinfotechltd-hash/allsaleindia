"""Site-wide configuration API — the single source of truth for mobile + web.

This is the "CMS-lite" layer.  Web frontend and mobile app both bootstrap
themselves from these endpoints so any time we change brand text, banners,
FAQ, featured collections, or trust copy in ONE place, both apps update
the next time a user opens them.

Endpoints:
  GET /api/site/config         — brand, contact, defaults, feature flags
  GET /api/site/banners        — homepage banner carousel
  GET /api/site/announcements  — active site-wide announcement bar
  GET /api/site/faq            — grouped FAQ articles
  GET /api/site/faq/{slug}     — single FAQ article
  GET /api/site/featured       — curated product collections / shelves
  GET /api/site/trust          — live trust indicators (counts from DB)

All endpoints are PUBLIC (no auth) — they power marketing surfaces.  Cache
the JSON for ~1 hour on the client (responses include ETag + Cache-Control).

Admin editability is deliberately NOT exposed yet — content lives in Python
constants below.  When we want CMS-style editing, we mount admin POST/PATCH
endpoints that write to a `site_overrides` Mongo collection and have the
GET endpoints check the override before falling back to the defaults here.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from db import db

logger = logging.getLogger("allsale.site")
router = APIRouter(tags=["site"])


# ---------------------------------------------------------------------------
# Brand + global config (single source of truth)
# ---------------------------------------------------------------------------
SUPPORTED_COUNTRIES = [
    {"code": "NZ", "label": "New Zealand", "currency": "NZD", "flag": "🇳🇿"},
    {"code": "AU", "label": "Australia", "currency": "AUD", "flag": "🇦🇺"},
    {"code": "US", "label": "United States", "currency": "USD", "flag": "🇺🇸"},
    {"code": "GB", "label": "United Kingdom", "currency": "GBP", "flag": "🇬🇧"},
    {"code": "CA", "label": "Canada", "currency": "CAD", "flag": "🇨🇦"},
    {"code": "IN", "label": "India", "currency": "INR", "flag": "🇮🇳"},
]


SITE_DEFAULTS = {
    "brand": {
        "name": "Allsale",
        "full_name": "Allsale: Indian Bazaar",
        "tagline": "Authentic India, delivered to your door.",
        "description": "Discover thousands of handpicked products from verified Indian sellers — sarees, jewellery, spices, decor & more — shipped to NZ, AU, US, UK & Canada.",
        "primary_color": "#7c3aed",
        "logo_url": "https://shop.allsale.co.nz/logo.png",
        "favicon_url": "https://shop.allsale.co.nz/favicon.ico",
    },
    "contact": {
        "support_email": "support@allsale.co.nz",
        "sales_email": "hello@allsale.co.nz",
        "phone": "+64 9 280 4500",
        "address": "Allsale Ltd, Auckland, New Zealand",
        "support_hours": "Mon–Fri, 9am–6pm NZST",
        "response_sla_hours": 24,
    },
    "social": {
        "instagram": "https://instagram.com/allsale.co.nz",
        "facebook": "https://facebook.com/allsale.co.nz",
        "tiktok": "https://tiktok.com/@allsale.co.nz",
        "youtube": None,
        "twitter": None,
        "linkedin": "https://linkedin.com/company/allsale",
    },
    "defaults": {
        "default_country": "NZ",
        "default_currency": "NZD",
        "default_language": "en",
        "free_shipping_threshold_nzd": 80.00,
        "return_window_days": 7,
        "cancellation_window_hours": 12,
        "estimated_delivery_min_days": 7,
        "estimated_delivery_max_days": 21,
        "loyalty_points_per_nzd": 1,
        "points_redemption_rate_pct": 50,  # max % of order redeemable in points
    },
    "feature_flags": {
        "google_signin": True,
        "apple_signin": True,
        "email_signup": True,
        "allsale_pro_for_sellers": True,
        "buy_now_pay_later": False,
        "wishlist": True,
        "loyalty_points": True,
        "referrals": True,
        "live_chat": False,
        "recently_viewed": True,
        "flash_sales": True,
        "coupons": True,
        "multi_currency": True,
    },
    "commerce": {
        "supported_countries": SUPPORTED_COUNTRIES,
        "commission_tiers_bps": {
            "electronics": 800,
            "default": 1200,
            "jewellery": 1500,
        },
        "payment_methods": ["card", "apple_pay", "google_pay"],
        "shipping_partners": ["Shiprocket X"],
    },
    "legal": {
        "company_name": "Allsale Ltd",
        "registered_in": "New Zealand",
        "nzbn": "PENDING",
        "gst_registered": False,
        "vat_registered": False,
    },
}


# ---------------------------------------------------------------------------
# Homepage banners (carousel)
# ---------------------------------------------------------------------------
BANNERS: list[dict] = [
    {
        "id": "banner_summer_2026",
        "title": "Festive picks from India",
        "subtitle": "Up to 40% off sarees, decor & jewellery",
        "image_url": "https://images.unsplash.com/photo-1605733513597-a8f8341084e6?w=1600",
        "cta_text": "Shop the collection",
        "cta_url": "/c/jewellery",
        "background_color": "#7c3aed",
        "text_color": "#ffffff",
        "priority": 10,
        "active": True,
    },
    {
        "id": "banner_free_shipping",
        "title": "Free shipping over NZD 80",
        "subtitle": "Across NZ, AU, US, UK & Canada",
        "image_url": "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=1600",
        "cta_text": "Browse products",
        "cta_url": "/products",
        "background_color": "#0f172a",
        "text_color": "#ffffff",
        "priority": 9,
        "active": True,
    },
    {
        "id": "banner_become_seller",
        "title": "Selling from India? Reach 5 countries with Allsale.",
        "subtitle": "Verified business onboarding · Stripe Connect payouts",
        "image_url": "https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=1600",
        "cta_text": "Apply to sell",
        "cta_url": "/seller/welcome",
        "background_color": "#0891b2",
        "text_color": "#ffffff",
        "priority": 5,
        "active": True,
    },
]


# ---------------------------------------------------------------------------
# Site-wide announcement bar
# ---------------------------------------------------------------------------
ANNOUNCEMENTS: list[dict] = [
    {
        "id": "ann_launch_2026",
        "message": "🎉 Allsale is now live — first 500 orders get a NZD 10 welcome credit!",
        "level": "info",   # info | warning | success
        "cta_text": "Claim credit",
        "cta_url": "/account/credits",
        "dismissible": True,
        "active": True,
        "starts_at": None,  # null = always
        "ends_at": None,
    },
]


# ---------------------------------------------------------------------------
# FAQ articles (grouped by category)
# ---------------------------------------------------------------------------
FAQ_CATEGORIES = [
    {"slug": "shopping", "label": "Shopping & Orders", "icon": "shopping-bag"},
    {"slug": "shipping", "label": "Shipping & Delivery", "icon": "truck"},
    {"slug": "returns", "label": "Returns & Refunds", "icon": "package"},
    {"slug": "payments", "label": "Payments & Currency", "icon": "credit-card"},
    {"slug": "account", "label": "Account & Privacy", "icon": "user"},
    {"slug": "seller", "label": "Selling on Allsale", "icon": "store"},
]


FAQ_ITEMS: list[dict] = [
    # --- Shopping ---
    {"slug": "what-is-allsale", "category": "shopping",
     "question": "What is Allsale?",
     "answer": "Allsale is a cross-border marketplace connecting verified Indian sellers with buyers in New Zealand, Australia, the United States, the United Kingdom and Canada. Every product is sourced directly from India and shipped internationally."},
    {"slug": "how-do-i-order", "category": "shopping",
     "question": "How do I place an order?",
     "answer": "Browse or search for a product, add it to your cart, sign in (email, Google or Apple), enter your shipping address, and pay with card via Stripe in your local currency. You'll get an instant email confirmation."},
    {"slug": "can-i-change-my-order", "category": "shopping",
     "question": "Can I change or cancel my order?",
     "answer": "Yes — you have a 12-hour cancellation window after payment. After that the seller has dispatched it. See our Cancellation Policy for details."},

    # --- Shipping ---
    {"slug": "how-long-shipping", "category": "shipping",
     "question": "How long does shipping take?",
     "answer": "International shipping via Shiprocket X typically takes 7–21 business days depending on your country. We share tracking the moment your seller dispatches."},
    {"slug": "shipping-cost", "category": "shipping",
     "question": "How much is shipping?",
     "answer": "Shipping is calculated at checkout based on weight and destination. Orders over NZD 80 (or equivalent) ship FREE to NZ, AU, US, UK and Canada."},
    {"slug": "customs-duty", "category": "shipping",
     "question": "Will I pay customs duty?",
     "answer": "For most orders under NZD 1,000 to New Zealand, no GST or duty applies. For other countries, customs duties may apply per local rules — these are the buyer's responsibility unless explicitly marked DDP at checkout."},
    {"slug": "track-order", "category": "shipping",
     "question": "How do I track my order?",
     "answer": "Once dispatched, you'll get an email with the tracking link. You can also see real-time tracking inside your Allsale account → Orders."},

    # --- Returns ---
    {"slug": "return-window", "category": "returns",
     "question": "What's the return window?",
     "answer": "7 days from delivery for genuine issues (wrong item, damaged, not as described). Items must be unused, in original packaging. See full Return Policy for details."},
    {"slug": "who-pays-return-shipping", "category": "returns",
     "question": "Who pays return shipping?",
     "answer": "If the return is due to a seller mistake (wrong item, damaged), Allsale covers return shipping. If you change your mind, the buyer pays return shipping."},
    {"slug": "refund-timing", "category": "returns",
     "question": "How long does a refund take?",
     "answer": "Once we receive the returned item, refunds are processed within 3 business days. The money typically appears in your bank within 5–10 business days via your original payment method."},

    # --- Payments ---
    {"slug": "payment-methods", "category": "payments",
     "question": "What payment methods do you accept?",
     "answer": "Credit/debit card via Stripe, Apple Pay, and Google Pay. We don't store your full card number — that's handled directly by Stripe."},
    {"slug": "what-currency", "category": "payments",
     "question": "What currency will I be charged in?",
     "answer": "You're charged in your local currency (NZD, AUD, USD, GBP or CAD) using daily live FX rates. The exact amount is shown clearly at checkout before you pay."},
    {"slug": "is-it-safe", "category": "payments",
     "question": "Is it safe to pay on Allsale?",
     "answer": "Yes — all payments go through Stripe, a PCI-DSS Level 1 certified processor used by millions of businesses worldwide. We never see or store your full card number."},

    # --- Account ---
    {"slug": "how-to-sign-up", "category": "account",
     "question": "How do I sign up?",
     "answer": "Tap Sign up and either use your email, or sign in with Google or Apple. Takes 30 seconds — no credit card needed to browse or wishlist."},
    {"slug": "delete-my-account", "category": "account",
     "question": "How do I delete my account?",
     "answer": "Go to Account → Privacy → Delete account. Your personal data is removed within 30 days. Order records are retained 7 years for tax/legal reasons."},
    {"slug": "export-my-data", "category": "account",
     "question": "Can I download my data?",
     "answer": "Yes — Account → Privacy → Download data gives you a full JSON export of your profile, orders, reviews, returns and points history."},

    # --- Seller ---
    {"slug": "how-to-become-seller", "category": "seller",
     "question": "How do I sell on Allsale?",
     "answer": "Allsale is open to verified Indian businesses with a valid GST registration. Apply at /seller/welcome — verification typically takes 3–7 business days."},
    {"slug": "seller-commission", "category": "seller",
     "question": "What commission do sellers pay?",
     "answer": "Tiered: 8% for Electronics, 12% for most categories, 15% for Jewellery. This covers payment processing, shipping label discounts, customer support and platform infrastructure."},
    {"slug": "when-do-i-get-paid", "category": "seller",
     "question": "When are sellers paid?",
     "answer": "Once the buyer's 7-day return window closes, your earnings (gross minus commission) are released. Payouts via Stripe Connect typically arrive within 2–3 business days of release."},
]


# ---------------------------------------------------------------------------
# Featured collections / curated shelves (homepage merchandising)
# ---------------------------------------------------------------------------
FEATURED_COLLECTIONS: list[dict] = [
    {
        "slug": "festive-picks",
        "title": "Festive picks",
        "subtitle": "Diwali · Eid · Christmas — handpicked for the holidays",
        "filter": {"category": "Jewellery"},
        "sort": "popular",
        "limit": 8,
        "priority": 10,
        "active": True,
    },
    {
        "slug": "trending-now",
        "title": "Trending now",
        "subtitle": "What buyers are loving this week",
        "filter": {},
        "sort": "popular",
        "limit": 12,
        "priority": 9,
        "active": True,
    },
    {
        "slug": "under-30",
        "title": "Under NZD 30",
        "subtitle": "Great finds under thirty bucks",
        "filter": {"max_price_nzd": 30},
        "sort": "popular",
        "limit": 8,
        "priority": 7,
        "active": True,
    },
    {
        "slug": "new-arrivals",
        "title": "New from Indian sellers",
        "subtitle": "Fresh listings this week",
        "filter": {},
        "sort": "newest",
        "limit": 12,
        "priority": 5,
        "active": True,
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_cache_headers(response: Response, max_age: int = 3600) -> None:
    response.headers["Cache-Control"] = f"public, max-age={max_age}, stale-while-revalidate=86400"


def _is_active(item: dict, now: Optional[datetime] = None) -> bool:
    if not item.get("active", True):
        return False
    now = now or datetime.now(timezone.utc)
    starts = item.get("starts_at")
    ends = item.get("ends_at")
    if isinstance(starts, datetime) and starts > now:
        return False
    if isinstance(ends, datetime) and ends < now:
        return False
    return True


# ---------------------------------------------------------------------------
# GET /api/site/config
# ---------------------------------------------------------------------------
@router.get("/site/config")
async def site_config(response: Response):
    """Single bootstrap endpoint for both mobile + web frontends.
    Pull this on app startup and cache for ~1 hour."""
    _set_cache_headers(response, max_age=3600)
    return {
        **SITE_DEFAULTS,
        "generated_at": _now_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/site/banners
# ---------------------------------------------------------------------------
@router.get("/site/banners")
async def site_banners(response: Response):
    """Homepage carousel banners, sorted by priority (high → low)."""
    _set_cache_headers(response, max_age=600)
    now = datetime.now(timezone.utc)
    active = [b for b in BANNERS if _is_active(b, now)]
    active.sort(key=lambda b: -int(b.get("priority", 0)))
    return {"banners": active, "generated_at": _now_iso()}


# ---------------------------------------------------------------------------
# GET /api/site/announcements
# ---------------------------------------------------------------------------
@router.get("/site/announcements")
async def site_announcements(response: Response):
    """Active site-wide announcement bar items."""
    _set_cache_headers(response, max_age=300)
    now = datetime.now(timezone.utc)
    active = [a for a in ANNOUNCEMENTS if _is_active(a, now)]
    return {"announcements": active, "generated_at": _now_iso()}


# ---------------------------------------------------------------------------
# GET /api/site/faq + /api/site/faq/{slug}
# ---------------------------------------------------------------------------
@router.get("/site/faq")
async def site_faq(response: Response, category: Optional[str] = None):
    """Full FAQ, optionally filtered by category."""
    _set_cache_headers(response, max_age=3600)
    items = FAQ_ITEMS
    if category:
        items = [i for i in items if i["category"] == category.lower()]
    # Group response by category for easy rendering
    by_category: dict[str, list[dict]] = {}
    for it in items:
        by_category.setdefault(it["category"], []).append(it)
    return {
        "categories": FAQ_CATEGORIES,
        "items": items,
        "grouped": by_category,
        "total": len(items),
        "generated_at": _now_iso(),
    }


@router.get("/site/faq/{slug}")
async def site_faq_item(slug: str, response: Response):
    """Single FAQ article by slug — for deep-linkable /faq/[slug] routes."""
    _set_cache_headers(response, max_age=3600)
    found = next((i for i in FAQ_ITEMS if i["slug"] == slug.lower()), None)
    if not found:
        raise HTTPException(status_code=404, detail=f"FAQ not found: {slug}")
    cat = next((c for c in FAQ_CATEGORIES if c["slug"] == found["category"]), None)
    return {**found, "category_info": cat, "generated_at": _now_iso()}


# ---------------------------------------------------------------------------
# GET /api/site/featured  —  curated shelves with HYDRATED products
# ---------------------------------------------------------------------------
@router.get("/site/featured")
async def site_featured(response: Response):
    """Returns featured collections with their actual product list pre-hydrated
    so the frontend can render homepage shelves without a second roundtrip
    per shelf.  Each shelf's `products` array is the result of running the
    shelf's filter+sort against the catalog.
    """
    _set_cache_headers(response, max_age=600)
    shelves = sorted(
        [c for c in FEATURED_COLLECTIONS if c.get("active")],
        key=lambda c: -int(c.get("priority", 0)),
    )
    out: list[dict] = []
    for shelf in shelves:
        flt = shelf.get("filter") or {}
        query: dict = {"is_active": {"$ne": False}}
        if flt.get("category"):
            query["category"] = flt["category"]
        if isinstance(flt.get("max_price_nzd"), (int, float)):
            query["price_nzd"] = {"$lte": float(flt["max_price_nzd"])}
        if isinstance(flt.get("min_price_nzd"), (int, float)):
            query.setdefault("price_nzd", {})
            query["price_nzd"]["$gte"] = float(flt["min_price_nzd"])
        sort_key = shelf.get("sort", "popular")
        sort_spec = (
            [("rating", -1), ("review_count", -1)] if sort_key == "popular"
            else [("created_at", -1)] if sort_key == "newest"
            else [("price_nzd", 1)] if sort_key == "price-asc"
            else [("price_nzd", -1)] if sort_key == "price-desc"
            else [("rating", -1)]
        )
        limit = max(1, min(int(shelf.get("limit", 12)), 50))
        try:
            cursor = db.products.find(
                query,
                {"_id": 0, "id": 1, "name": 1, "price_nzd": 1, "category": 1,
                 "images": 1, "rating": 1, "review_count": 1, "seller_name": 1,
                 "is_flash_sale": 1, "flash_sale_price_nzd": 1},
            ).sort(sort_spec).limit(limit)
            products = await cursor.to_list(length=limit)
        except Exception as e:
            logger.warning("featured shelf %s hydration failed: %s",
                           shelf["slug"], e)
            products = []
        out.append({
            "slug": shelf["slug"],
            "title": shelf["title"],
            "subtitle": shelf.get("subtitle"),
            "limit": limit,
            "filter": flt,
            "sort": sort_key,
            "product_count": len(products),
            "products": products,
        })
    return {"collections": out, "generated_at": _now_iso()}


# ---------------------------------------------------------------------------
# GET /api/site/trust  —  live counts from DB for trust strips
# ---------------------------------------------------------------------------
class TrustResponse(BaseModel):
    sellers_verified: int = Field(..., description="Currently verified seller count")
    products_listed: int = Field(..., description="Active product count")
    orders_delivered: int = Field(..., description="Orders successfully fulfilled")
    countries_served: int = Field(..., description="Buyer-facing countries")
    average_rating: float = Field(..., description="Mean rating across all reviews")
    total_reviews: int = Field(..., description="Total review count")
    generated_at: str


@router.get("/site/trust", response_model=TrustResponse)
async def site_trust(response: Response):
    """Live trust indicators — pulled fresh from Mongo on each call.
    Safe to render in marketing surfaces; numbers always reflect reality."""
    _set_cache_headers(response, max_age=300)
    sellers_verified = await db.users.count_documents({
        "is_seller": True,
        "seller_verification_status": {"$in": ["verified", "auto_verified"]},
    })
    products_listed = await db.products.count_documents({
        "is_active": {"$ne": False},
    })
    orders_delivered = await db.orders.count_documents({
        "status": {"$in": ["delivered", "completed"]},
    })
    countries_served = len(SUPPORTED_COUNTRIES) - 1  # IN is seller-side only
    # Rating aggregate — single $group stage
    agg_cursor = db.reviews.aggregate([
        {"$match": {"status": {"$ne": "hidden"}}},
        {"$group": {
            "_id": None,
            "avg": {"$avg": "$rating"},
            "count": {"$sum": 1},
        }},
    ])
    avg = 0.0
    total = 0
    async for doc in agg_cursor:
        avg = float(doc.get("avg") or 0)
        total = int(doc.get("count") or 0)
    return TrustResponse(
        sellers_verified=sellers_verified,
        products_listed=products_listed,
        orders_delivered=orders_delivered,
        countries_served=countries_served,
        average_rating=round(avg, 2),
        total_reviews=total,
        generated_at=_now_iso(),
    )


# Type re-export for the future admin endpoints — keeps test imports stable.
__all__ = ["router", "SITE_DEFAULTS", "BANNERS", "ANNOUNCEMENTS",
           "FAQ_ITEMS", "FAQ_CATEGORIES", "FEATURED_COLLECTIONS"]


# Silence unused imports (kept for future expansion)
_ = (Any, List)
