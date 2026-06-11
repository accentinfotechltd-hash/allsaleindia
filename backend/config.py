"""Configuration constants and environment variables for Allsale backend.

No I/O or DB clients live here — just primitive constants and regexes.
"""
from __future__ import annotations

import os
import re
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Env-driven secrets / endpoints
# ---------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_urlsafe(48)
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "allsale-admin-dev-secret")

# ---------------------------------------------------------------------------
# Indian business document formats (uppercase, no spaces)
# ---------------------------------------------------------------------------
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
CIN_RE = re.compile(r"^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$")
LLPIN_RE = re.compile(r"^[A-Z]{3}-?[0-9]{4}$")

BUSINESS_TYPES_NEEDS_CIN = {"private_limited", "public_limited", "opc", "section_8"}
BUSINESS_TYPES_NEEDS_LLPIN = {"llp"}
BUSINESS_TYPES_NO_MCA = {"sole_proprietorship", "partnership_firm"}
VALID_BUSINESS_TYPES = (
    BUSINESS_TYPES_NEEDS_CIN | BUSINESS_TYPES_NEEDS_LLPIN | BUSINESS_TYPES_NO_MCA
)

# ---------------------------------------------------------------------------
# Pricing / shipping / commission rules
# ---------------------------------------------------------------------------
# 1 NZD ≈ 51 INR (display only). Hardcoded for MVP.
INR_PER_NZD = 51.0

# ---------------------------------------------------------------------------
# Multi-country support (Phase 1 — June 2026)
# ---------------------------------------------------------------------------
SUPPORTED_COUNTRIES: list[dict] = [
    {"code": "NZ", "name": "New Zealand",   "currency": "NZD", "symbol": "$",  "flag": "🇳🇿"},
    {"code": "AU", "name": "Australia",     "currency": "AUD", "symbol": "A$", "flag": "🇦🇺"},
    {"code": "US", "name": "United States", "currency": "USD", "symbol": "US$","flag": "🇺🇸"},
    {"code": "GB", "name": "United Kingdom","currency": "GBP", "symbol": "£",  "flag": "🇬🇧"},
    {"code": "CA", "name": "Canada",        "currency": "CAD", "symbol": "C$", "flag": "🇨🇦"},
]
COUNTRY_CODES = {c["code"] for c in SUPPORTED_COUNTRIES}
DEFAULT_COUNTRY = "NZ"

# Catalog prices are stored in NZD. These FX rates (NZD → target) are
# hardcoded for MVP — update every few months OR swap for a live rates API.
FX_RATES_FROM_NZD: dict[str, float] = {
    "NZD": 1.00,
    "AUD": 0.92,
    "USD": 0.61,
    "GBP": 0.48,
    "CAD": 0.83,
}

# Order cancellation window: buyers can cancel within 12 hours of payment.
CANCELLATION_WINDOW_HOURS = 12
# Payout hold: seller payouts only become eligible 10 days after delivery
# (used for the buyer-facing return / dispute window).
PAYOUT_HOLD_DAYS_AFTER_DELIVERY = 10
# Return request window: 7 days from delivery (NZ Consumer Guarantees Act).
RETURN_WINDOW_DAYS = 7

# Shipping rule: free over NZD 100, else NZD 12 flat.
FREE_SHIPPING_THRESHOLD_NZD = 100.0
FLAT_SHIPPING_NZD = 12.0
PLATFORM_COMMISSION = 0.15  # 15% of gross to the platform

# NZ Customs / IRD: GST 15% on every personal-import order. If the goods
# value exceeds NZD 1000 a 10% tariff is also applied (simplified MVP rule).
NZ_GST_RATE = 0.15
NZ_DUTY_THRESHOLD_NZD = 1000.0
NZ_DUTY_RATE = 0.10

# ---------------------------------------------------------------------------
# Catalog taxonomy & NZ MPI prohibited keyword list
# ---------------------------------------------------------------------------
# Two-tier catalog (June 2026):
#   1. Indian-heritage categories (kept verbatim — Allsale's anchor story)
#   2. Global Amazon/AliExpress-style categories (added below)
# Both share the same product collection; the `category` string field on
# each product points at one of these `name`s.
TAXONOMY: list[dict] = [
    # ---------- Indian heritage ----------
    {
        "key": "ethnic_fashion",
        "name": "Ethnic Fashion",
        "blurb": "Sarees, lehengas and kurtis hand-picked from across India.",
        "subcategories": ["Sarees", "Lehengas", "Kurtis", "Mens Wear", "Kids Wear"],
    },
    {
        "key": "home_puja",
        "name": "Home & Puja",
        "blurb": "Brassware, decor and pooja essentials made in India.",
        "subcategories": ["Brass Items", "Wall Decor", "Kitchenware", "Idols", "Incense"],
    },
    {
        "key": "books_gifts",
        "name": "Books & Gifts",
        "blurb": "Festive gifts, books and wedding favours ready to ship.",
        "subcategories": ["Books", "Rakhis", "Diwali Gifts", "Wedding Favors"],
    },
    {
        "key": "food_groceries",
        "name": "Food & Groceries",
        "blurb": "Sealed, branded Indian groceries that clear NZ biosecurity.",
        "subcategories": ["Spices", "Snacks", "Sweets", "Tea & Coffee", "Pickles"],
    },
    {
        "key": "wellness",
        "name": "Wellness",
        "blurb": "Authentic ayurveda, herbs and oils from Indian wellness houses.",
        "subcategories": ["Ayurvedic Medicines", "Herbal Supplements", "Essential Oils"],
    },
    # ---------- Global fashion ----------
    {
        "key": "womens_clothing",
        "name": "Women's Clothing",
        "blurb": "Trend-led womenswear from dresses to activewear.",
        "subcategories": [
            "Dresses", "Tops", "Bottoms", "Outerwear", "Swimwear",
            "Sleepwear & Loungewear", "Activewear", "Plus Size",
            "Underwear & Lingerie",
        ],
    },
    {
        "key": "mens_clothing",
        "name": "Men's Clothing",
        "blurb": "Everyday menswear, performance and big & tall fits.",
        "subcategories": [
            "Tops", "Bottoms", "Outerwear", "Underwear & Sleepwear",
            "Activewear", "Swimwear", "Big & Tall",
        ],
    },
    {
        "key": "kids_fashion",
        "name": "Kids' Fashion",
        "blurb": "Girls, boys and baby outfits sized 0-14.",
        "subcategories": [
            "Girls Clothing", "Boys Clothing", "Baby 0-24M",
            "Kids Shoes", "Kids Accessories",
        ],
    },
    # ---------- Footwear & bags ----------
    {
        "key": "shoes",
        "name": "Shoes",
        "blurb": "Sneakers, heels, sandals and sport shoes for the whole family.",
        "subcategories": [
            "Women's Shoes", "Men's Shoes", "Kids' Shoes", "Sports Shoes",
        ],
    },
    {
        "key": "bags_luggage",
        "name": "Bags & Luggage",
        "blurb": "Handbags, backpacks, wallets and travel luggage.",
        "subcategories": [
            "Women's Bags", "Men's Bags", "Luggage & Travel",
            "Wallets & Card Holders", "Kids' Bags",
        ],
    },
    # ---------- Jewelry — merged Indian + global ----------
    {
        "key": "jewelry_accessories",
        "name": "Jewelry & Accessories",
        "blurb": "Imitation, silver, watches and the heritage juttis.",
        "subcategories": [
            "Necklaces & Pendants", "Earrings", "Rings", "Bracelets & Bangles",
            "Body Jewelry", "Hair Accessories", "Watches", "Sunglasses & Eyewear",
            "Hats & Caps", "Belts & Scarves",
            "Imitation Jewelry", "Silver Jewelry", "Juttis",
        ],
    },
    # ---------- Lifestyle ----------
    {
        "key": "home_kitchen",
        "name": "Home & Kitchen",
        "blurb": "Decor, bedding, kitchen and furniture for every room.",
        "subcategories": [
            "Home Decor", "Bedding", "Bath", "Kitchen & Dining", "Furniture",
            "Lighting", "Storage & Organization", "Cleaning Supplies",
        ],
    },
    {
        "key": "beauty_health",
        "name": "Beauty & Health",
        "blurb": "Makeup, skincare, fragrance and wellness essentials.",
        "subcategories": [
            "Makeup", "Skincare", "Hair Care", "Personal Care",
            "Health Care", "Fragrance",
        ],
    },
    # ---------- Tech & toys ----------
    {
        "key": "electronics",
        "name": "Electronics",
        "blurb": "Phones, audio, smart home, cameras and wearables.",
        "subcategories": [
            "Phones & Accessories", "Audio", "Smart Home",
            "Computer & Office", "Camera & Photo", "TV & Home Audio",
            "Wearables", "Mobile Accessories", "Small Gadgets",
        ],
    },
    {
        "key": "toys_games",
        "name": "Toys & Games",
        "blurb": "Figures, dolls, building sets and outdoor play.",
        "subcategories": [
            "Action Figures & Collectibles", "Dolls & Accessories",
            "Building Toys", "Vehicles", "Puzzles & Games",
            "Outdoor Play", "Arts & Crafts", "Baby & Toddler Toys",
        ],
    },
    {
        "key": "sports_outdoors",
        "name": "Sports & Outdoors",
        "blurb": "Fitness, hiking, team sports and water gear.",
        "subcategories": [
            "Exercise & Fitness", "Outdoor Recreation", "Sports",
            "Water Sports", "Winter Sports",
        ],
    },
    {
        "key": "pet_supplies",
        "name": "Pet Supplies",
        "blurb": "Beds, toys, food and accessories for every pet.",
        "subcategories": [
            "Dogs", "Cats", "Fish & Aquatic", "Birds & Small Animals",
        ],
    },
    {
        "key": "automotive",
        "name": "Automotive",
        "blurb": "Interior, exterior and electronic upgrades for your ride.",
        "subcategories": [
            "Interior Accessories", "Exterior Accessories", "Car Electronics",
            "Tools & Equipment", "Motorcycle Accessories",
        ],
    },
    {
        "key": "office_school",
        "name": "Office & School Supplies",
        "blurb": "Stationery, office gadgets and back-to-school essentials.",
        "subcategories": [
            "Stationery", "Office Electronics", "Arts & Crafts Supplies",
            "School Bags & Pencil Cases",
        ],
    },
    {
        "key": "tools_home_improvement",
        "name": "Tools & Home Improvement",
        "blurb": "Hand tools, power tools, hardware and garden gear.",
        "subcategories": [
            "Hand Tools", "Power Tools", "Hardware", "Electrical",
            "Plumbing", "Garden",
        ],
    },
]

# Buyer-facing hidden categories: temporarily suppressed in the public
# catalog while logistics (single-pack couriering for food, special handling
# for ayurveda/herbs) is being validated. Sellers continue to see their own
# listings in these categories via /api/seller/products.
HIDDEN_BUYER_CATEGORIES: set[str] = {"Food & Groceries", "Wellness"}

PROHIBITED_KEYWORDS: list[dict] = [
    {"term": "homemade", "reason": "NZ MPI bans homemade food items."},
    {"term": "home-made", "reason": "NZ MPI bans homemade food items."},
    {"term": "fresh fruit", "reason": "Fresh fruit is banned by NZ MPI."},
    {"term": "fresh vegetable", "reason": "Fresh vegetables are banned by NZ MPI."},
    {"term": "dairy", "reason": "Dairy is restricted by NZ MPI."},
    {"term": "milk powder", "reason": "Dairy (milk powder) is restricted by NZ MPI."},
    {"term": "ghee", "reason": "Dairy (ghee) is restricted by NZ MPI."},
    {"term": "cheese", "reason": "Dairy (cheese) is restricted by NZ MPI."},
    {"term": "butter", "reason": "Dairy (butter) is restricted by NZ MPI."},
    {"term": "meat", "reason": "Meat products are banned by NZ MPI."},
    {"term": "beef", "reason": "Meat products are banned by NZ MPI."},
    {"term": "chicken", "reason": "Meat products are banned by NZ MPI."},
    {"term": "mutton", "reason": "Meat products are banned by NZ MPI."},
    {"term": "fish", "reason": "Fresh fish is banned by NZ MPI."},
    {"term": "seed", "reason": "Seeds are banned by NZ MPI."},
    {"term": "honey", "reason": "Honey is banned by NZ MPI."},
    {"term": "plant", "reason": "Live plants are banned by NZ MPI."},
    {"term": "soil", "reason": "Soil and earth are banned by NZ MPI."},
]

# ---------------------------------------------------------------------------
# Returns policy
# ---------------------------------------------------------------------------
RETURN_REASONS: list[str] = [
    "damaged_on_arrival",
    "wrong_item",
    "not_as_described",
    "defective",
    "changed_my_mind",
]
# Seller-paid return reasons (defective/wrong) — buyer pays for "changed_my_mind".
SELLER_PAID_REASONS = {"damaged_on_arrival", "wrong_item", "not_as_described", "defective"}
RESTOCKING_FEE_PCT = 0.15  # 15% on change-of-mind returns

# Non-returnable product categories (food/wellness due to NZ MPI biosecurity).
NON_RETURNABLE_CATEGORIES = {
    "Food & Groceries",
    "Wellness",
    "Personal Care",
}
