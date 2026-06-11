"""Allsale backend — cross-border e-commerce (India → New Zealand).

Auth: JWT email/password (bcrypt).
Payments: Stripe Checkout via emergentintegrations (test key).
"""
from __future__ import annotations

import logging
import os
import re
import secrets
import uuid
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, List, Optional

import bcrypt
import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

from pymongo.errors import DuplicateKeyError

from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    CheckoutStatusResponse,
    StripeCheckout,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET") or secrets.token_urlsafe(48)
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "allsale-admin-dev-secret")

# Indian business document formats (uppercase, no spaces).
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
CIN_RE = re.compile(r"^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$")
LLPIN_RE = re.compile(r"^[A-Z]{3}-?[0-9]{4}$")

# Indian business entity types we accept on Allsale.
BUSINESS_TYPES_NEEDS_CIN = {"private_limited", "public_limited", "opc", "section_8"}
BUSINESS_TYPES_NEEDS_LLPIN = {"llp"}
BUSINESS_TYPES_NO_MCA = {"sole_proprietorship", "partnership_firm"}
VALID_BUSINESS_TYPES = (
    BUSINESS_TYPES_NEEDS_CIN | BUSINESS_TYPES_NEEDS_LLPIN | BUSINESS_TYPES_NO_MCA
)

# 1 NZD ≈ 51 INR (display only). Hardcoded for MVP.
INR_PER_NZD = 51.0

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

# Categories: 2-level taxonomy. Display name → list of subcategories.
TAXONOMY: list[dict] = [
    {
        "key": "ethnic_fashion",
        "name": "Ethnic Fashion",
        "blurb": "Sarees, lehengas and kurtis hand-picked from across India.",
        "subcategories": ["Sarees", "Lehengas", "Kurtis", "Mens Wear", "Kids Wear"],
    },
    {
        "key": "jewelry_accessories",
        "name": "Jewelry & Accessories",
        "blurb": "Imitation, silver, juttis and bags — heritage craft, modern shipping.",
        "subcategories": ["Imitation Jewelry", "Silver Jewelry", "Juttis", "Bags"],
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
        "key": "electronics",
        "name": "Electronics",
        "blurb": "Small gadgets and accessories that meet NZ import rules.",
        "subcategories": ["Mobile Accessories", "Small Gadgets"],
    },
]

# NZ MPI / Customs prohibited keywords (simplified, case-insensitive matching).
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

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Allsale API", version="1.0.0")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("allsale")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    full_name: str = Field(..., min_length=1)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    picture: Optional[str] = None
    provider: str = "email"
    is_seller: bool = False
    seller_verified: bool = False


class AuthResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"


class GoogleSessionRequest(BaseModel):
    session_id: str


class SellerBusiness(BaseModel):
    business_type: str = Field(..., min_length=2)
    company_name: str = Field(..., min_length=2)
    gstin: str = Field(..., min_length=15, max_length=15)
    pan: str = Field(..., min_length=10, max_length=10)
    cin: Optional[str] = Field(default=None)
    llpin: Optional[str] = Field(default=None)
    address_line1: str = Field(..., min_length=2)
    address_line2: Optional[str] = ""
    city: str = Field(..., min_length=2)
    state: str = Field(..., min_length=2)
    pincode: str = Field(..., min_length=6, max_length=6)
    contact_name: str = Field(..., min_length=2)
    contact_phone: str = Field(..., min_length=6)


class SellerRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    business: SellerBusiness


class SellerUpgrade(BaseModel):
    business: SellerBusiness


class SellerProfile(BaseModel):
    user_id: str
    business_type: str
    company_name: str
    gstin: str
    pan: str
    cin: Optional[str] = None
    llpin: Optional[str] = None
    address_line1: str
    address_line2: Optional[str] = ""
    city: str
    state: str
    pincode: str
    contact_name: str
    contact_phone: str
    verification_status: str  # auto_verified | pending_review | rejected
    verified_at: Optional[datetime] = None
    created_at: datetime


class ListingCreate(BaseModel):
    name: str = Field(..., min_length=2)
    description: str = Field(..., min_length=10)
    category: str = Field(..., min_length=2)
    price_nzd: float = Field(..., gt=0)
    image: str = Field(..., min_length=8)
    shipping_days_min: int = 7
    shipping_days_max: int = 14


class Product(BaseModel):
    id: str
    name: str
    description: str
    category: str
    subcategory: Optional[str] = None
    price_nzd: float
    price_inr: float
    image: str
    images: List[str] = []
    rating: float = 4.5
    reviews_count: int = 0
    in_stock: bool = True
    shipping_days_min: int = 7
    shipping_days_max: int = 12
    origin: str = "India"
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None


class TaxonomyNode(BaseModel):
    key: str
    name: str
    blurb: str
    subcategories: List[str]


class DutyItem(BaseModel):
    price_nzd: float
    quantity: int = 1


class DutyEstimateRequest(BaseModel):
    items: List[DutyItem]
    shipping_nzd: float = 0.0


class DutyEstimateResponse(BaseModel):
    goods_nzd: float
    shipping_nzd: float
    gst_nzd: float
    duty_nzd: float
    customs_total_nzd: float  # gst + duty
    grand_total_nzd: float    # goods + shipping + gst + duty
    threshold_nzd: float
    over_threshold: bool


class ProhibitedCheckRequest(BaseModel):
    text: str


class ProhibitedCheckResponse(BaseModel):
    allowed: bool
    matched_term: Optional[str] = None
    reason: Optional[str] = None
    advice: str


class CartItem(BaseModel):
    product_id: str
    quantity: int


class CartAddRequest(BaseModel):
    product_id: str
    quantity: int = 1


class CartUpdateRequest(BaseModel):
    quantity: int


class CartView(BaseModel):
    items: List[dict]  # product details + quantity
    subtotal_nzd: float
    shipping_nzd: float
    total_nzd: float
    subtotal_inr: float


class Address(BaseModel):
    full_name: str
    phone: str
    line1: str
    line2: Optional[str] = ""
    city: str
    region: str
    postcode: str
    country: str = "New Zealand"


class CheckoutRequest(BaseModel):
    address: Address
    origin_url: str  # e.g. https://allsale-shop.preview.emergentagent.com


class OrderItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    quantity: int
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None


class Payout(BaseModel):
    id: str
    order_id: str
    seller_id: str
    company_name: str
    items_count: int
    gross_nzd: float
    commission_nzd: float
    net_payable_nzd: float
    status: str  # pending | paid_out
    created_at: datetime
    paid_out_at: Optional[datetime] = None


class SellerOrderItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    quantity: int


class SellerOrder(BaseModel):
    order_id: str
    buyer_name: str
    buyer_city: str
    buyer_region: str
    items: List[SellerOrderItem]
    seller_subtotal_nzd: float
    status: str
    created_at: datetime
    estimated_delivery: str


class SellerPayoutSummary(BaseModel):
    payouts: List[Payout]
    lifetime_earnings_nzd: float
    pending_nzd: float
    paid_out_nzd: float


class Order(BaseModel):
    id: str
    user_id: str
    items: List[OrderItem]
    subtotal_nzd: float
    shipping_nzd: float
    total_nzd: float
    address: Address
    status: str  # pending | paid | shipped | out_for_delivery | delivered | cancelled | refunded
    payment_status: str  # initiated | paid | failed | refunded
    session_id: Optional[str] = None
    created_at: datetime
    estimated_delivery: str  # human readable e.g. "12-18 Mar 2026"
    cancellable_until: Optional[datetime] = None  # 12h window from paid time
    cancelled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    refund_id: Optional[str] = None
    refund_amount_nzd: Optional[float] = None


class Notification(BaseModel):
    id: str
    user_id: str  # recipient user id, or "admin" for admin notifications
    role: str  # buyer | seller | admin
    type: str  # order_cancelled | order_placed | refund_issued | ...
    title: str
    body: str
    order_id: Optional[str] = None
    read: bool = False
    created_at: datetime


class CancelOrderRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=300)


# Allowed buyer-visible return reasons (drives the picker on the app).
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


class ReturnRequestItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    quantity: int


class ReturnRequestCreate(BaseModel):
    order_id: str
    reason: str = Field(..., description="One of RETURN_REASONS")
    product_ids: List[str] = Field(default_factory=list)
    note: Optional[str] = Field(None, max_length=600)
    photos: List[str] = Field(default_factory=list, description="base64-encoded images, optional, max 4")


class ReturnRequest(BaseModel):
    id: str
    order_id: str
    user_id: str  # buyer
    seller_id: str  # we group returns by seller — multi-seller orders create multiple
    items: List[ReturnRequestItem]
    reason: str
    note: Optional[str] = None
    photos: List[str] = Field(default_factory=list)
    status: str  # pending_seller | approved | rejected | refunded | cancelled
    buyer_pays_shipping: bool
    restocking_fee_nzd: float
    refund_amount_nzd: float
    created_at: datetime
    decided_at: Optional[datetime] = None
    decision_note: Optional[str] = None
    refund_id: Optional[str] = None


class ReturnDecision(BaseModel):
    note: Optional[str] = Field(None, max_length=300)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(days=JWT_EXPIRE_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def estimate_delivery_window(days_min: int = 7, days_max: int = 14) -> str:
    start = now_utc() + timedelta(days=days_min)
    end = now_utc() + timedelta(days=days_max)
    return f"{start.strftime('%d %b')} – {end.strftime('%d %b %Y')}"


async def create_notification(
    user_id: str,
    role: str,
    n_type: str,
    title: str,
    body: str,
    order_id: Optional[str] = None,
) -> dict:
    """Create an in-app notification doc.

    `user_id` should be a real user id; for admin recipients pass the literal
    string ``"admin"``.
    """
    doc = {
        "id": f"ntf_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "role": role,
        "type": n_type,
        "title": title,
        "body": body,
        "order_id": order_id,
        "read": False,
        "created_at": now_utc(),
    }
    await db.notifications.insert_one(doc)
    return doc


async def notify_admins(n_type: str, title: str, body: str, order_id: Optional[str] = None) -> None:
    await create_notification(
        user_id="admin", role="admin", n_type=n_type, title=title, body=body, order_id=order_id
    )


def cancellable_until_from(paid_at: datetime) -> datetime:
    return paid_at + timedelta(hours=CANCELLATION_WINDOW_HOURS)


def public_user(doc: dict) -> "UserPublic":
    return UserPublic(
        id=doc["id"],
        email=doc["email"],
        full_name=doc["full_name"],
        picture=doc.get("picture"),
        provider=doc.get("provider", "email"),
        is_seller=bool(doc.get("is_seller")),
        seller_verified=doc.get("seller_verification_status") == "auto_verified",
    )


def validate_indian_business(b: SellerBusiness) -> dict:
    """Return cleaned/uppercased dict; raise HTTPException on invalid formats."""
    btype = b.business_type.strip().lower()
    if btype not in VALID_BUSINESS_TYPES:
        raise HTTPException(status_code=400, detail="Invalid business type")
    gstin = b.gstin.strip().upper()
    pan = b.pan.strip().upper()
    cin = b.cin.strip().upper() if b.cin else None
    llpin = b.llpin.strip().upper() if b.llpin else None
    pincode = b.pincode.strip()
    if not GSTIN_RE.match(gstin):
        raise HTTPException(status_code=400, detail="Invalid GSTIN format (15 chars)")
    if not PAN_RE.match(pan):
        raise HTTPException(status_code=400, detail="Invalid PAN format (10 chars)")
    if not pincode.isdigit() or len(pincode) != 6:
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")
    # Light cross-check: GSTIN positions 3..7 are the company PAN.
    if pan != gstin[2:12]:
        raise HTTPException(status_code=400, detail="PAN must match the PAN inside the GSTIN")

    # Branch by business type to enforce the right MCA identifier.
    if btype in BUSINESS_TYPES_NEEDS_CIN:
        if not cin or not CIN_RE.match(cin):
            raise HTTPException(status_code=400, detail="Valid CIN (21 chars) is required for this business type")
        if llpin:
            raise HTTPException(status_code=400, detail="LLPIN does not apply to this business type")
    elif btype in BUSINESS_TYPES_NEEDS_LLPIN:
        if not llpin or not LLPIN_RE.match(llpin):
            raise HTTPException(status_code=400, detail="Valid LLPIN (7 chars: AAA-1234) is required for an LLP")
        if cin:
            raise HTTPException(status_code=400, detail="CIN does not apply to an LLP — use LLPIN")
    else:
        # Sole proprietorship / partnership firm — neither MCA id is applicable.
        if cin or llpin:
            raise HTTPException(status_code=400, detail="CIN/LLPIN do not apply to this business type")
    return {
        "business_type": btype,
        "company_name": b.company_name.strip(),
        "gstin": gstin,
        "pan": pan,
        "cin": cin,
        "llpin": llpin,
        "address_line1": b.address_line1.strip(),
        "address_line2": (b.address_line2 or "").strip(),
        "city": b.city.strip(),
        "state": b.state.strip(),
        "pincode": pincode,
        "contact_name": b.contact_name.strip(),
        "contact_phone": b.contact_phone.strip(),
    }


async def get_current_user(authorization: Annotated[Optional[str], Header()] = None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def compute_cart_totals(items_with_products: List[dict]) -> CartView:
    subtotal_nzd = sum(it["price_nzd"] * it["quantity"] for it in items_with_products)
    shipping = 0.0 if subtotal_nzd >= FREE_SHIPPING_THRESHOLD_NZD or subtotal_nzd == 0 else FLAT_SHIPPING_NZD
    total = subtotal_nzd + shipping
    return CartView(
        items=items_with_products,
        subtotal_nzd=round(subtotal_nzd, 2),
        shipping_nzd=round(shipping, 2),
        total_nzd=round(total, 2),
        subtotal_inr=round(subtotal_nzd * INR_PER_NZD, 0),
    )


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------
SEED_PRODUCTS: list[dict] = [
    # Ethnic Fashion → Sarees
    {
        "name": "Handwoven Silk Saree — Royal Maroon",
        "description": "Authentic Banarasi silk saree handwoven by artisans in Varanasi. Comes with matching blouse piece. Perfect for weddings and festive occasions.",
        "category": "Ethnic Fashion", "subcategory": "Sarees",
        "price_nzd": 89.00,
        "image": "https://images.unsplash.com/photo-1717585679395-bbe39b5fb6bc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
        "rating": 4.8, "reviews_count": 312,
    },
    # Ethnic Fashion → Kurtis
    {
        "name": "Embroidered Anarkali Suit Set",
        "description": "Three-piece Anarkali suit with intricate zari embroidery. Includes dupatta and bottoms. Imported directly from Jaipur.",
        "category": "Ethnic Fashion", "subcategory": "Kurtis",
        "price_nzd": 65.50,
        "image": "https://images.unsplash.com/photo-1503160865267-af4660ce7bf2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
        "rating": 4.7, "reviews_count": 184,
    },
    # Ethnic Fashion → Lehengas
    {
        "name": "Designer Lehenga Choli — Pastel Pink",
        "description": "Bridal-grade lehenga with mirror work and sequins. Three-piece set. Custom alterations available on request.",
        "category": "Ethnic Fashion", "subcategory": "Lehengas",
        "price_nzd": 149.00,
        "image": "https://images.pexels.com/photos/14928074/pexels-photo-14928074.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "rating": 4.9, "reviews_count": 92,
    },
    # Home & Puja → Idols
    {
        "name": "Brass Ganesha Idol — 6 inch",
        "description": "Hand-cast brass Ganesha idol from Moradabad. Polished finish, weighs 850g. Perfect for home temple or as a gift.",
        "category": "Home & Puja", "subcategory": "Idols",
        "price_nzd": 42.00,
        "image": "https://images.unsplash.com/photo-1650383044645-5d32141ad1a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
        "rating": 4.9, "reviews_count": 207,
    },
    # Home & Puja → Brass Items
    {
        "name": "Antique Brass Diya Set (Pack of 5)",
        "description": "Traditional oil lamps for Diwali and daily worship. Hand-engraved with floral motifs.",
        "category": "Home & Puja", "subcategory": "Brass Items",
        "price_nzd": 28.50,
        "image": "https://images.unsplash.com/photo-1652960018678-1f19799996c5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
        "rating": 4.6, "reviews_count": 145,
    },
    # Home & Puja → Kitchenware (pooja set)
    {
        "name": "Brass Pooja Thali Complete Set",
        "description": "Full pooja kit: thali, bell, incense holder, kalash and diya. Wedding gift favourite.",
        "category": "Home & Puja", "subcategory": "Kitchenware",
        "price_nzd": 56.00,
        "image": "https://images.pexels.com/photos/15755947/pexels-photo-15755947.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "rating": 4.8, "reviews_count": 78,
    },
    # Food & Groceries → Tea & Coffee
    {
        "name": "Premium Darjeeling Tea — 250g",
        "description": "First-flush Darjeeling loose-leaf tea, sourced directly from Makaibari estate. Sealed, branded — MPI-compliant.",
        "category": "Food & Groceries", "subcategory": "Tea & Coffee",
        "price_nzd": 18.90,
        "image": "https://images.unsplash.com/photo-1623193893878-656ec0391ea1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwyfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.9, "reviews_count": 524,
    },
    # Food & Groceries → Spices
    {
        "name": "Whole Spice Collection — 12 jars",
        "description": "Cardamom, cloves, turmeric, cumin, coriander, fenugreek and more. Air-tight commercial packs — MPI-compliant.",
        "category": "Food & Groceries", "subcategory": "Spices",
        "price_nzd": 47.00,
        "image": "https://images.unsplash.com/photo-1589536677029-c0aa1808fba6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.8, "reviews_count": 263,
    },
    # Food & Groceries → Tea & Coffee
    {
        "name": "Masala Chai Blend — 500g",
        "description": "Strong Assam black tea blended with cardamom, ginger, clove and cinnamon. Sealed, branded.",
        "category": "Food & Groceries", "subcategory": "Tea & Coffee",
        "price_nzd": 22.50,
        "image": "https://images.unsplash.com/photo-1683533698664-12ee473e8c9d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.7, "reviews_count": 318,
    },
]


async def seed_products() -> None:
    """Idempotent reseed of platform-owned (no seller) products."""
    expected = len(SEED_PRODUCTS)
    existing = await db.products.count_documents({"seller_id": None})
    # Always sync platform catalog to the latest taxonomy. Seller-created
    # listings are never touched.
    if existing == expected:
        # Make sure category/subcategory match the latest mapping in case the
        # seed shape changed.
        for p in SEED_PRODUCTS:
            await db.products.update_many(
                {"seller_id": None, "name": p["name"]},
                {"$set": {"category": p["category"], "subcategory": p["subcategory"]}},
            )
        return
    await db.products.delete_many({"seller_id": None})
    docs = []
    for p in SEED_PRODUCTS:
        pid = str(uuid.uuid4())
        docs.append(
            {
                "id": pid,
                "name": p["name"],
                "description": p["description"],
                "category": p["category"],
                "subcategory": p["subcategory"],
                "price_nzd": p["price_nzd"],
                "price_inr": round(p["price_nzd"] * INR_PER_NZD, 0),
                "image": p["image"],
                "images": [p["image"]],
                "rating": p.get("rating", 4.5),
                "reviews_count": p.get("reviews_count", 0),
                "in_stock": True,
                "shipping_days_min": 7,
                "shipping_days_max": 12,
                "origin": "India",
                "seller_id": None,
                "seller_name": None,
            }
        )
    await db.products.insert_many(docs)
    logger.info("seeded %d products across new taxonomy", len(docs))


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api.post("/auth/register", response_model=AuthResponse)
async def register(body: UserCreate):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "id": uid,
        "email": email,
        "full_name": body.full_name.strip(),
        "password_hash": hash_password(body.password),
        "provider": "email",
        "picture": None,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    token = create_token(uid)
    return AuthResponse(user=public_user(user_doc), access_token=token)


@api.post("/auth/login", response_model=AuthResponse)
async def login(body: UserLogin):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"])
    return AuthResponse(user=public_user(user), access_token=token)


@api.post("/auth/google-session", response_model=AuthResponse)
async def google_session(body: GoogleSessionRequest):
    """Exchange an Emergent `session_id` for our own JWT.

    Calls Emergent's session-data endpoint to fetch the verified profile,
    upserts the user by email and issues our regular JWT so the rest of the
    API (cart, orders, /auth/me) keeps working unchanged.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Auth provider unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired Google session")
    data = r.json()
    email = (data.get("email") or "").lower()
    name = data.get("name") or email.split("@")[0]
    picture = data.get("picture")
    if not email:
        raise HTTPException(status_code=400, detail="Google profile missing email")

    existing = await db.users.find_one({"email": email})
    if existing:
        uid = existing["id"]
        await db.users.update_one(
            {"id": uid},
            {
                "$set": {
                    "full_name": existing.get("full_name") or name,
                    "picture": picture,
                    "last_login_at": now_utc(),
                }
            },
        )
    else:
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "id": uid,
                "email": email,
                "full_name": name,
                "password_hash": None,
                "provider": "google",
                "picture": picture,
                "created_at": now_utc(),
            }
        )
    token = create_token(uid)
    user = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return AuthResponse(user=public_user(user), access_token=token)


@api.get("/auth/me", response_model=UserPublic)
async def me(current=Depends(get_current_user)):
    return public_user(current)


# ---------------------------------------------------------------------------
# Product routes
# ---------------------------------------------------------------------------
@api.get("/products", response_model=List[Product])
async def list_products(
    category: Optional[str] = None,
    subcategory: Optional[str] = None,
    q: Optional[str] = None,
):
    query: dict = {}
    if category and category.lower() != "all":
        query["category"] = category
    if subcategory and subcategory.lower() != "all":
        query["subcategory"] = subcategory
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    cursor = db.products.find(query, {"_id": 0})
    return [Product(**p) async for p in cursor]


@api.get("/categories", response_model=List[str])
async def list_categories():
    cats = await db.products.distinct("category")
    return sorted(cats)


@api.get("/taxonomy", response_model=List[TaxonomyNode])
async def get_taxonomy():
    """The 2-level Allsale catalog (7 mains × subcategories)."""
    return [TaxonomyNode(**node) for node in TAXONOMY]


@api.post("/duty/estimate", response_model=DutyEstimateResponse)
async def duty_estimate(body: DutyEstimateRequest):
    """NZ GST + duty estimate. Simplified rule used at checkout."""
    goods = round(sum(it.price_nzd * it.quantity for it in body.items), 2)
    shipping = round(max(0.0, body.shipping_nzd), 2)
    over = goods > NZ_DUTY_THRESHOLD_NZD
    gst = round((goods + shipping) * NZ_GST_RATE, 2)
    duty = round(goods * NZ_DUTY_RATE, 2) if over else 0.0
    customs = round(gst + duty, 2)
    grand = round(goods + shipping + gst + duty, 2)
    return DutyEstimateResponse(
        goods_nzd=goods,
        shipping_nzd=shipping,
        gst_nzd=gst,
        duty_nzd=duty,
        customs_total_nzd=customs,
        grand_total_nzd=grand,
        threshold_nzd=NZ_DUTY_THRESHOLD_NZD,
        over_threshold=over,
    )


@api.post("/prohibited/check", response_model=ProhibitedCheckResponse)
async def check_prohibited(body: ProhibitedCheckRequest):
    """Case-insensitive substring match against the NZ MPI keyword ban list."""
    text = (body.text or "").lower()
    if not text.strip():
        return ProhibitedCheckResponse(
            allowed=True,
            advice="Type a product name above to check if NZ MPI will allow it.",
        )
    for entry in PROHIBITED_KEYWORDS:
        if entry["term"] in text:
            return ProhibitedCheckResponse(
                allowed=False,
                matched_term=entry["term"],
                reason=entry["reason"],
                advice="This item cannot be shipped to NZ via Allsale. Please choose a sealed, branded alternative.",
            )
    return ProhibitedCheckResponse(
        allowed=True,
        advice="Looks fine for NZ import. Make sure your packaging is sealed & branded.",
    )


@api.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return Product(**p)


# ---------------------------------------------------------------------------
# Cart routes (per-user persistent)
# ---------------------------------------------------------------------------
async def hydrate_cart(user_id: str) -> CartView:
    cart_doc = await db.carts.find_one({"user_id": user_id}, {"_id": 0})
    items: list[CartItem] = []
    if cart_doc:
        items = [CartItem(**i) for i in cart_doc.get("items", [])]
    hydrated = []
    for it in items:
        prod = await db.products.find_one({"id": it.product_id}, {"_id": 0})
        if not prod:
            continue
        hydrated.append(
            {
                "product_id": prod["id"],
                "name": prod["name"],
                "image": prod["image"],
                "price_nzd": prod["price_nzd"],
                "price_inr": prod["price_inr"],
                "quantity": it.quantity,
                "category": prod["category"],
            }
        )
    return compute_cart_totals(hydrated)


@api.get("/cart", response_model=CartView)
async def get_cart(current=Depends(get_current_user)):
    return await hydrate_cart(current["id"])


@api.post("/cart", response_model=CartView)
async def add_to_cart(body: CartAddRequest, current=Depends(get_current_user)):
    prod = await db.products.find_one({"id": body.product_id}, {"_id": 0})
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    qty = max(1, body.quantity)
    cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0})
    items: list[dict] = cart.get("items", []) if cart else []
    found = False
    for it in items:
        if it["product_id"] == body.product_id:
            it["quantity"] += qty
            found = True
            break
    if not found:
        items.append({"product_id": body.product_id, "quantity": qty})
    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"items": items, "updated_at": now_utc()}},
        upsert=True,
    )
    return await hydrate_cart(current["id"])


@api.put("/cart/{product_id}", response_model=CartView)
async def update_cart_item(product_id: str, body: CartUpdateRequest, current=Depends(get_current_user)):
    cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0})
    items: list[dict] = cart.get("items", []) if cart else []
    if body.quantity <= 0:
        items = [it for it in items if it["product_id"] != product_id]
    else:
        found = False
        for it in items:
            if it["product_id"] == product_id:
                it["quantity"] = body.quantity
                found = True
                break
        if not found:
            raise HTTPException(status_code=404, detail="Item not in cart")
    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"items": items, "updated_at": now_utc()}},
        upsert=True,
    )
    return await hydrate_cart(current["id"])


@api.delete("/cart/{product_id}", response_model=CartView)
async def remove_cart_item(product_id: str, current=Depends(get_current_user)):
    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$pull": {"items": {"product_id": product_id}}},
    )
    return await hydrate_cart(current["id"])


# ---------------------------------------------------------------------------
# Seller (business onboarding + listings)
# ---------------------------------------------------------------------------
async def _verify_business_and_persist(user_id: str, business: SellerBusiness) -> dict:
    cleaned = validate_indian_business(business)
    # Auto-verify on valid Indian formats; otherwise pending_review (admin can flip).
    verification_status = "auto_verified"
    profile = {
        "user_id": user_id,
        **cleaned,
        "verification_status": verification_status,
        "verified_at": now_utc(),
        "created_at": now_utc(),
    }
    try:
        await db.sellers.update_one({"user_id": user_id}, {"$set": profile}, upsert=True)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="This GSTIN is already registered with another seller")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"is_seller": True, "seller_verification_status": verification_status, "company_name": cleaned["company_name"]}},
    )
    return profile


@api.post("/seller/register", response_model=AuthResponse)
async def seller_register(body: SellerRegister):
    """Full seller signup: creates account + business profile + auto-verifies."""
    email = body.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "id": uid,
        "email": email,
        "full_name": body.business.contact_name.strip(),
        "password_hash": hash_password(body.password),
        "provider": "email",
        "picture": None,
        "is_seller": True,
        "created_at": now_utc(),
    }
    await db.users.insert_one(user_doc)
    await _verify_business_and_persist(uid, body.business)
    fresh = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    token = create_token(uid)
    return AuthResponse(user=public_user(fresh), access_token=token)


@api.post("/seller/upgrade", response_model=UserPublic)
async def seller_upgrade(body: SellerUpgrade, current=Depends(get_current_user)):
    """Upgrade an existing user account to a seller account."""
    if current.get("is_seller"):
        raise HTTPException(status_code=400, detail="Already a seller")
    await _verify_business_and_persist(current["id"], body.business)
    fresh = await db.users.find_one({"id": current["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(fresh)


@api.get("/seller/me", response_model=SellerProfile)
async def seller_me(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=404, detail="Not a seller")
    profile = await db.sellers.find_one({"user_id": current["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    return SellerProfile(**profile)


async def require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


@api.post("/seller/products", response_model=Product)
async def create_listing(body: ListingCreate, seller=Depends(require_verified_seller)):
    pid = str(uuid.uuid4())
    profile = await db.sellers.find_one({"user_id": seller["id"]}, {"_id": 0})
    company = (profile or {}).get("company_name", seller.get("full_name"))
    doc = {
        "id": pid,
        "name": body.name.strip(),
        "description": body.description.strip(),
        "category": body.category.strip(),
        "price_nzd": float(body.price_nzd),
        "price_inr": round(body.price_nzd * INR_PER_NZD, 0),
        "image": body.image.strip(),
        "images": [body.image.strip()],
        "rating": 0.0,
        "reviews_count": 0,
        "in_stock": True,
        "shipping_days_min": int(body.shipping_days_min),
        "shipping_days_max": int(body.shipping_days_max),
        "origin": "India",
        "seller_id": seller["id"],
        "seller_name": company,
        "created_at": now_utc(),
    }
    await db.products.insert_one(doc)
    return Product(**{k: v for k, v in doc.items() if k != "created_at"})


@api.get("/seller/products", response_model=List[Product])
async def list_my_listings(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.products.find({"seller_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [Product(**{k: v for k, v in p.items() if k != "created_at"}) async for p in cursor]


@api.delete("/seller/products/{product_id}")
async def delete_listing(product_id: str, seller=Depends(require_verified_seller)):
    res = await db.products.delete_one({"id": product_id, "seller_id": seller["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Listing not found")
    return {"deleted": True}


@api.get("/seller/orders", response_model=List[SellerOrder])
async def list_seller_orders(seller=Depends(get_current_user)):
    """Orders containing at least one item this seller owns.

    Each order is filtered to only the seller's items so other sellers in the
    same order are not exposed (privacy + simplicity).
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.orders.find(
        {"items.seller_id": seller["id"]},
        {"_id": 0},
    ).sort("created_at", -1)
    out: list[SellerOrder] = []
    async for order in cursor:
        my_items = [it for it in order.get("items", []) if it.get("seller_id") == seller["id"]]
        if not my_items:
            continue
        subtotal = round(sum(it["price_nzd"] * it["quantity"] for it in my_items), 2)
        addr = order.get("address") or {}
        out.append(
            SellerOrder(
                order_id=order["id"],
                buyer_name=addr.get("full_name", "Customer"),
                buyer_city=addr.get("city", ""),
                buyer_region=addr.get("region", ""),
                items=[SellerOrderItem(**{k: it[k] for k in ("product_id", "name", "image", "price_nzd", "quantity")}) for it in my_items],
                seller_subtotal_nzd=subtotal,
                status=order.get("status", "pending"),
                created_at=order.get("created_at"),
                estimated_delivery=order.get("estimated_delivery", ""),
            )
        )
    return out


@api.get("/seller/payouts", response_model=SellerPayoutSummary)
async def list_seller_payouts(seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.payouts.find({"seller_id": seller["id"]}, {"_id": 0}).sort("created_at", -1)
    payouts = [Payout(**p) async for p in cursor]
    pending = round(sum(p.net_payable_nzd for p in payouts if p.status == "pending"), 2)
    paid_out = round(sum(p.net_payable_nzd for p in payouts if p.status == "paid_out"), 2)
    return SellerPayoutSummary(
        payouts=payouts,
        lifetime_earnings_nzd=round(pending + paid_out, 2),
        pending_nzd=pending,
        paid_out_nzd=paid_out,
    )


@api.post("/admin/payouts/{payout_id}/mark-paid", response_model=Payout)
async def admin_mark_payout_paid(
    payout_id: str,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    po = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Payout not found")
    if po.get("status") == "paid_out":
        return Payout(**po)
    await db.payouts.update_one(
        {"id": payout_id},
        {"$set": {"status": "paid_out", "paid_out_at": now_utc()}},
    )
    fresh = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    return Payout(**fresh)





@api.post("/admin/sellers/{user_id}/approve")
async def admin_approve_seller(
    user_id: str,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    res1 = await db.users.update_one(
        {"id": user_id, "is_seller": True},
        {"$set": {"seller_verification_status": "auto_verified"}},
    )
    if res1.matched_count == 0:
        raise HTTPException(status_code=404, detail="Seller not found")
    await db.sellers.update_one(
        {"user_id": user_id},
        {"$set": {"verification_status": "auto_verified", "verified_at": now_utc()}},
    )
    return {"approved": True}




# ---------------------------------------------------------------------------
# Stripe Checkout
# ---------------------------------------------------------------------------
def get_stripe(request_origin: str) -> StripeCheckout:
    webhook_url = f"{request_origin.rstrip('/')}/api/webhooks/stripe"
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


async def create_payouts_for_order(order_id: str) -> None:
    """Idempotently materialize one Payout per seller present in the order.

    Items without a `seller_id` are platform-owned (seeded catalog) and
    generate no payout. Safe to call multiple times — duplicate (order_id,
    seller_id) inserts are absorbed.
    """
    existing = await db.payouts.find_one({"order_id": order_id}, {"_id": 0})
    if existing:
        return
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    by_seller: dict[str, dict] = {}
    for it in order.get("items", []):
        sid = it.get("seller_id")
        if not sid:
            continue
        bucket = by_seller.setdefault(
            sid,
            {
                "seller_name": it.get("seller_name") or "Seller",
                "items_count": 0,
                "gross": 0.0,
            },
        )
        bucket["items_count"] += int(it["quantity"])
        bucket["gross"] += float(it["price_nzd"]) * int(it["quantity"])
    docs = []
    for sid, agg in by_seller.items():
        gross = round(agg["gross"], 2)
        commission = round(gross * PLATFORM_COMMISSION, 2)
        net = round(gross - commission, 2)
        docs.append(
            {
                "id": f"po_{uuid.uuid4().hex[:12]}",
                "order_id": order_id,
                "seller_id": sid,
                "company_name": agg["seller_name"],
                "items_count": agg["items_count"],
                "gross_nzd": gross,
                "commission_nzd": commission,
                "net_payable_nzd": net,
                "status": "pending",
                "created_at": now_utc(),
                "paid_out_at": None,
            }
        )
    if docs:
        await db.payouts.insert_many(docs)


# ---------------------------------------------------------------------------
# Shiprocket X (cross-border courier) — MOCKED until real credentials wired.
#
# To go live, set in /app/backend/.env:
#   SHIPROCKET_EMAIL=...
#   SHIPROCKET_PASSWORD=...
# and replace the stub in `book_shiprocket_shipment` with a real call to
# https://apiv2.shiprocket.in/v1/external/shipments/create/forward-shipment
# ---------------------------------------------------------------------------
SHIPROCKET_LIVE = bool(os.environ.get("SHIPROCKET_EMAIL") and os.environ.get("SHIPROCKET_PASSWORD"))


async def book_shiprocket_shipment(order_id: str) -> Optional[dict]:
    """Idempotent: one shipment per order. Currently returns a MOCKED AWB."""
    existing = await db.shipments.find_one({"order_id": order_id}, {"_id": 0})
    if existing:
        return existing
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return None
    # MOCK — generate fake AWB + tracking URL.
    awb = f"SR{uuid.uuid4().hex[:10].upper()}"
    shipment = {
        "id": f"shp_{uuid.uuid4().hex[:12]}",
        "order_id": order_id,
        "user_id": order.get("user_id"),
        "carrier": "Shiprocket X (mock)" if not SHIPROCKET_LIVE else "Shiprocket X",
        "awb_code": awb,
        "tracking_url": f"https://shiprocket.co/tracking/{awb}",
        "status": "label_created",
        "pickup_scheduled_at": now_utc(),
        "estimated_delivery": order.get("estimated_delivery", ""),
        "is_mocked": not SHIPROCKET_LIVE,
        "created_at": now_utc(),
    }
    await db.shipments.insert_one(shipment)
    # Just store the AWB on the order — DO NOT flip status to "shipped" yet.
    # Real "shipped" status only when courier picks up (Shiprocket webhook),
    # which lets the 12-hour cancellation window still apply.
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"shipment_id": shipment["id"], "awb_code": awb}},
    )
    logger.info("shipment label created %s for %s (mocked=%s)", awb, order_id, not SHIPROCKET_LIVE)
    return shipment


class Shipment(BaseModel):
    id: str
    order_id: str
    carrier: str
    awb_code: str
    tracking_url: str
    status: str
    estimated_delivery: str
    is_mocked: bool


# Shiprocket → Allsale order-status mapping.
# Reference: Shiprocket webhook docs `current_status` field. We accept either
# `current_status` (string) or `current_status_id` (numeric) and normalise.
_SHIPROCKET_STATUS_MAP: dict[str, str] = {
    # pre-dispatch
    "new": "paid",
    "awb assigned": "paid",
    "label generated": "paid",
    "pickup scheduled": "paid",
    "pickup generated": "paid",
    "pickup queued": "paid",
    "pickup error": "paid",
    # dispatched
    "pickup completed": "shipped",
    "shipped": "shipped",
    "in transit": "shipped",
    "reached destination hub": "shipped",
    # last-mile
    "out for delivery": "out_for_delivery",
    # final
    "delivered": "delivered",
    # exceptions → keep status but notify
    "undelivered": "shipped",
    "rto initiated": "rto_initiated",
    "rto delivered": "rto_delivered",
    "cancelled": "cancelled",
}

_SHIPROCKET_STATUS_ID_MAP: dict[int, str] = {
    # subset of Shiprocket status_id codes (publicly documented)
    1: "paid",          # New
    2: "paid",          # Invoiced
    3: "paid",          # Manifest Generated
    4: "paid",          # AWB Assigned
    5: "paid",          # Label Generated
    6: "shipped",       # Shipped (Pickup Completed)
    7: "delivered",
    8: "cancelled",
    9: "shipped",       # In Transit
    10: "out_for_delivery",
    11: "rto_initiated",
    12: "rto_delivered",
    13: "shipped",      # Reached Destination Hub
    17: "delivered",
    18: "out_for_delivery",
    19: "out_for_delivery",
    21: "shipped",      # Picked Up
}


def _map_shiprocket_status(raw: dict) -> Optional[str]:
    sid = raw.get("current_status_id") or raw.get("status_id")
    if isinstance(sid, (int, str)):
        try:
            mapped = _SHIPROCKET_STATUS_ID_MAP.get(int(sid))
            if mapped:
                return mapped
        except (TypeError, ValueError):
            pass
    txt = (raw.get("current_status") or raw.get("shipment_status") or raw.get("status") or "")
    return _SHIPROCKET_STATUS_MAP.get(str(txt).strip().lower())


def _shiprocket_signature_ok(raw_body: bytes, sent_token: Optional[str]) -> bool:
    """Optional shared-secret verification.

    If ``SHIPROCKET_WEBHOOK_TOKEN`` is configured in env, the webhook MUST send
    it back as the ``X-Api-Key`` header. When unset (e.g. local dev) we accept
    everything so mocked payloads still work.
    """
    secret = os.environ.get("SHIPROCKET_WEBHOOK_TOKEN")
    if not secret:
        return True
    return bool(sent_token) and sent_token == secret


@api.post("/shiprocket/webhook")
async def shiprocket_webhook(
    request: Request,
    x_api_key: Annotated[Optional[str], Header()] = None,
):
    """Receive shipment status updates from Shiprocket.

    Idempotent — replays of the same payload are safe. We resolve the order
    via the AWB number, map the carrier status onto our internal status, and
    fan-out an in-app notification to the buyer for the major milestones
    (``shipped``, ``out_for_delivery``, ``delivered``).
    """
    raw = await request.body()
    if not _shiprocket_signature_ok(raw, x_api_key):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    awb = (
        payload.get("awb")
        or payload.get("awb_code")
        or payload.get("awb_no")
        or payload.get("awb_number")
    )
    if not awb:
        raise HTTPException(status_code=400, detail="awb is required")

    mapped = _map_shiprocket_status(payload)
    if not mapped:
        # Acknowledge but do not change state — keeps the webhook idempotent
        # against unknown status codes Shiprocket may add later.
        logger.info("shiprocket webhook unknown status: %s", payload.get("current_status"))
        return {"received": True, "awb": awb, "ignored": True}

    shipment = await db.shipments.find_one({"awb_code": awb}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found for awb")

    order = await db.orders.find_one({"id": shipment["order_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Compute new order status — never regress past a terminal state.
    current = order.get("status")
    if current in {"cancelled", "refunded", "delivered"}:
        return {"received": True, "awb": awb, "noop": True, "status": current}

    # Don't ever flip a cancelled / refunded shipment's order forward.
    new_order_status = mapped
    # If the buyer can still cancel (within 12h) AND the carrier hasn't actually
    # picked up yet, keep status at 'paid'. Picked-up onwards → shipped.
    if mapped == "paid" and current == "paid":
        new_order_status = "paid"

    # Persist
    update_ts: dict = {
        "status": new_order_status,
        "tracking_status": payload.get("current_status") or payload.get("shipment_status"),
        "last_tracking_update": now_utc(),
    }
    if mapped == "delivered":
        update_ts["delivered_at"] = now_utc()
        update_ts["return_window_until"] = now_utc() + timedelta(days=RETURN_WINDOW_DAYS)
        update_ts["payout_release_at"] = now_utc() + timedelta(days=PAYOUT_HOLD_DAYS_AFTER_DELIVERY)
    await db.orders.update_one({"id": order["id"]}, {"$set": update_ts})

    await db.shipments.update_one(
        {"awb_code": awb},
        {
            "$set": {
                "status": mapped,
                "carrier_status_raw": payload.get("current_status") or payload.get("shipment_status"),
                "last_update_at": now_utc(),
            },
            "$push": {
                "events": {
                    "at": now_utc(),
                    "status": payload.get("current_status") or payload.get("shipment_status"),
                    "location": payload.get("current_location") or payload.get("location"),
                    "remark": payload.get("scan_remark") or payload.get("activity"),
                }
            },
        },
    )

    # Buyer notifications — only on transitions (skip if same status).
    if current != new_order_status:
        short = order["id"].replace("order_", "")[:8].upper()
        title_body = {
            "shipped": (
                f"Order #{short} shipped",
                f"Your parcel is on its way from India. AWB {awb}.",
            ),
            "out_for_delivery": (
                f"Order #{short} is out for delivery",
                "Your courier is heading your way today — please be available.",
            ),
            "delivered": (
                f"Order #{short} delivered",
                "Hope you love it! You have 7 days to request a return if needed.",
            ),
            "rto_initiated": (
                f"Order #{short} being returned",
                "The courier is returning your parcel to the seller. We'll refund you once it's confirmed.",
            ),
            "rto_delivered": (
                f"Order #{short} return completed",
                "The seller has received the parcel. Your refund is being processed.",
            ),
        }.get(new_order_status)
        if title_body:
            await create_notification(
                user_id=order["user_id"],
                role="buyer",
                n_type=f"order_{new_order_status}",
                title=title_body[0],
                body=title_body[1],
                order_id=order["id"],
            )

    return {
        "received": True,
        "awb": awb,
        "order_id": order["id"],
        "order_status": new_order_status,
    }


@api.get("/orders/{order_id}/shipment", response_model=Optional[Shipment])
async def get_order_shipment(order_id: str, current=Depends(get_current_user)):
    """Return shipment info for an order owned by the current user."""
    order = await db.orders.find_one({"id": order_id, "user_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    shp = await db.shipments.find_one({"order_id": order_id}, {"_id": 0})
    if not shp:
        return None
    # Pydantic Shipment only requires the documented subset of fields.
    return Shipment(
        id=shp["id"],
        order_id=shp["order_id"],
        carrier=shp.get("carrier", "Shiprocket X"),
        awb_code=shp["awb_code"],
        tracking_url=shp.get("tracking_url", f"https://shiprocket.co/tracking/{shp['awb_code']}"),
        status=shp.get("status", "label_created"),
        estimated_delivery=shp.get("estimated_delivery", order.get("estimated_delivery", "")),
        is_mocked=bool(shp.get("is_mocked", False)),
    )


# ---------------------------------------------------------------------------
# Notifications & Order cancellation
# ---------------------------------------------------------------------------
async def notify_order_placed(order_id: str) -> None:
    """Fan-out: notify the buyer, each unique seller, and the admin."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    short = order_id.replace("order_", "")[:8].upper()
    total = order.get("total_nzd", 0)

    # Buyer confirmation
    await create_notification(
        user_id=order["user_id"],
        role="buyer",
        n_type="order_placed",
        title=f"Order #{short} confirmed",
        body=f"Thanks! Your order of ${total:.2f} NZD is being prepared. You can cancel within 12 hours.",
        order_id=order_id,
    )

    # Seller notifications (one per unique seller)
    seen_sellers: set[str] = set()
    for it in order.get("items", []):
        sid = it.get("seller_id")
        if not sid or sid in seen_sellers:
            continue
        seen_sellers.add(sid)
        await create_notification(
            user_id=sid,
            role="seller",
            n_type="new_order",
            title=f"New order #{short}",
            body="You have a new order. Please prepare items for dispatch.",
            order_id=order_id,
        )

    # Admin
    await notify_admins(
        n_type="order_placed",
        title=f"New order #{short}",
        body=f"Order placed for ${total:.2f} NZD by user {order['user_id']}.",
        order_id=order_id,
    )


async def issue_stripe_refund(order: dict) -> tuple[Optional[str], float]:
    """Issue a Stripe refund for a paid order. Returns (refund_id, amount).

    Falls back gracefully if no payment_intent / session exists (e.g. test
    fixtures) — returns (None, total_nzd) so the cancellation still proceeds.
    """
    import stripe as stripe_sdk

    stripe_sdk.api_key = STRIPE_API_KEY
    session_id = order.get("session_id")
    amount = float(order.get("total_nzd", 0))
    if not session_id:
        return None, amount
    try:
        session = stripe_sdk.checkout.Session.retrieve(session_id)
        payment_intent_id = session.get("payment_intent") if isinstance(session, dict) else getattr(session, "payment_intent", None)
        if not payment_intent_id:
            return None, amount
        refund = stripe_sdk.Refund.create(payment_intent=payment_intent_id)
        return (refund.get("id") if isinstance(refund, dict) else getattr(refund, "id", None)), amount
    except Exception as e:
        logger.warning("Stripe refund failed for %s: %s", order.get("id"), e)
        return None, amount


@api.post("/orders/{order_id}/cancel", response_model=Order)
async def cancel_order(
    order_id: str,
    body: CancelOrderRequest,
    current=Depends(get_current_user),
):
    """Buyer cancels an order within the 12-hour window.

    Issues a Stripe refund, voids any pending payouts, marks the order
    `cancelled`, and fans out notifications to buyer, sellers and admin.
    """
    order = await db.orders.find_one({"id": order_id, "user_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    status_val = order.get("status")
    if status_val in {"cancelled", "refunded"}:
        raise HTTPException(status_code=400, detail="Order already cancelled")
    if status_val in {"delivered", "out_for_delivery", "shipped"}:
        raise HTTPException(
            status_code=400,
            detail="Order has already been dispatched and cannot be cancelled. Please request a return after delivery.",
        )

    cancellable_until = order.get("cancellable_until")
    if not cancellable_until:
        raise HTTPException(status_code=400, detail="This order cannot be cancelled yet (payment not confirmed).")
    # Mongo returns datetime; ensure tz-aware
    if isinstance(cancellable_until, datetime) and cancellable_until.tzinfo is None:
        cancellable_until = cancellable_until.replace(tzinfo=timezone.utc)
    if now_utc() > cancellable_until:
        raise HTTPException(
            status_code=400,
            detail="The 12-hour cancellation window has passed. Please request a return after delivery.",
        )

    # Stripe refund (best-effort)
    refund_id, refund_amount = await issue_stripe_refund(order)

    # Void pending payouts for this order
    await db.payouts.update_many(
        {"order_id": order_id, "status": "pending"},
        {"$set": {"status": "void", "voided_at": now_utc()}},
    )

    new_status = "cancelled"
    await db.orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "status": new_status,
                "payment_status": "refunded" if refund_id else "refund_pending",
                "cancelled_at": now_utc(),
                "cancel_reason": (body.reason or "").strip()[:300] or None,
                "refund_id": refund_id,
                "refund_amount_nzd": refund_amount,
            }
        },
    )

    short = order_id.replace("order_", "")[:8].upper()
    reason_txt = (body.reason or "").strip()

    # Notify buyer
    await create_notification(
        user_id=order["user_id"],
        role="buyer",
        n_type="order_cancelled",
        title=f"Order #{short} cancelled",
        body=(
            f"Your refund of ${refund_amount:.2f} NZD is on the way. "
            "It typically appears on your statement within 5–10 business days."
            if refund_id
            else "Your cancellation has been received. The refund will be processed shortly."
        ),
        order_id=order_id,
    )

    # Notify sellers
    seen_sellers: set[str] = set()
    for it in order.get("items", []):
        sid = it.get("seller_id")
        if not sid or sid in seen_sellers:
            continue
        seen_sellers.add(sid)
        await create_notification(
            user_id=sid,
            role="seller",
            n_type="order_cancelled",
            title=f"Order #{short} was cancelled",
            body=(
                "The buyer has cancelled this order within the 12-hour window."
                + (f" Reason: {reason_txt}" if reason_txt else "")
                + " Please halt dispatch."
            ),
            order_id=order_id,
        )

    # Notify admin
    await notify_admins(
        n_type="order_cancelled",
        title=f"Order #{short} cancelled by buyer",
        body=(
            f"Refund: ${refund_amount:.2f} NZD ({'issued' if refund_id else 'pending'})."
            + (f" Reason: {reason_txt}" if reason_txt else "")
        ),
        order_id=order_id,
    )

    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return Order(**updated)


# ---- Notifications API --------------------------------------------------
@api.get("/notifications", response_model=List[Notification])
async def list_my_notifications(current=Depends(get_current_user)):
    cursor = db.notifications.find(
        {"user_id": current["id"]}, {"_id": 0}
    ).sort("created_at", -1).limit(100)
    return [Notification(**n) async for n in cursor]


@api.get("/notifications/unread-count")
async def my_unread_count(current=Depends(get_current_user)):
    count = await db.notifications.count_documents({"user_id": current["id"], "read": False})
    return {"unread": int(count)}


@api.post("/notifications/{notification_id}/read", response_model=Notification)
async def mark_notification_read(notification_id: str, current=Depends(get_current_user)):
    res = await db.notifications.find_one_and_update(
        {"id": notification_id, "user_id": current["id"]},
        {"$set": {"read": True}},
        return_document=True,
    )
    if not res:
        raise HTTPException(status_code=404, detail="Notification not found")
    res.pop("_id", None)
    return Notification(**res)


@api.post("/notifications/read-all")
async def mark_all_read(current=Depends(get_current_user)):
    res = await db.notifications.update_many(
        {"user_id": current["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"updated": res.modified_count}


@api.get("/admin/notifications", response_model=List[Notification])
async def admin_list_notifications(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    cursor = db.notifications.find({"user_id": "admin"}, {"_id": 0}).sort("created_at", -1).limit(200)
    return [Notification(**n) async for n in cursor]


# ---------------------------------------------------------------------------
# Returns
# ---------------------------------------------------------------------------
def _is_within_return_window(order: dict) -> bool:
    """Return True if the order is delivered and still within the 7-day window."""
    if order.get("status") != "delivered":
        return False
    deadline = order.get("return_window_until") or (
        (order.get("delivered_at") or now_utc()) + timedelta(days=RETURN_WINDOW_DAYS)
    )
    if isinstance(deadline, datetime) and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return now_utc() <= deadline


def _compute_refund(items: List[dict], reason: str) -> tuple[float, float, bool]:
    """Return (refund_amount_nzd, restocking_fee_nzd, buyer_pays_shipping)."""
    gross = round(sum(it["price_nzd"] * it["quantity"] for it in items), 2)
    if reason in SELLER_PAID_REASONS:
        return gross, 0.0, False
    # change_my_mind → 15% restocking fee, buyer pays return shipping
    fee = round(gross * RESTOCKING_FEE_PCT, 2)
    return max(0.0, round(gross - fee, 2)), fee, True


@api.post("/returns/request", response_model=List[ReturnRequest])
async def create_return_requests(body: ReturnRequestCreate, current=Depends(get_current_user)):
    """Buyer creates one or more return requests for their order.

    Multi-seller orders generate one ReturnRequest per seller so each seller
    can independently approve/reject their portion.
    """
    if body.reason not in RETURN_REASONS:
        raise HTTPException(status_code=400, detail=f"reason must be one of {RETURN_REASONS}")
    if len(body.photos) > 4:
        raise HTTPException(status_code=400, detail="Maximum 4 photos")

    order = await db.orders.find_one({"id": body.order_id, "user_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if not _is_within_return_window(order):
        raise HTTPException(
            status_code=400,
            detail="This order is not eligible for return (must be delivered within the last 7 days).",
        )

    # Filter to selected items (or all items if not specified)
    all_items = order.get("items", [])
    chosen_ids = set(body.product_ids) if body.product_ids else {it["product_id"] for it in all_items}
    chosen_items = [it for it in all_items if it["product_id"] in chosen_ids]
    if not chosen_items:
        raise HTTPException(status_code=400, detail="No matching items in this order")

    # Reject if any item is in a non-returnable category — categories are denormalised
    # onto products; we look them up.
    product_ids = [it["product_id"] for it in chosen_items]
    products_cur = db.products.find({"id": {"$in": product_ids}}, {"_id": 0})
    NON_RETURNABLE = {
        "Food & Groceries",
        "Wellness",
        "Personal Care",
    }
    async for p in products_cur:
        if p.get("category") in NON_RETURNABLE:
            raise HTTPException(
                status_code=400,
                detail=f"\"{p['name']}\" is in a non-returnable category ({p['category']}).",
            )

    # One request per unique seller in the chosen items
    by_seller: dict[str, list[dict]] = {}
    for it in chosen_items:
        sid = it.get("seller_id") or "unknown"
        by_seller.setdefault(sid, []).append(it)

    short_order = body.order_id.replace("order_", "")[:8].upper()
    created: list[ReturnRequest] = []
    for sid, sitems in by_seller.items():
        refund_amount, fee, buyer_pays = _compute_refund(sitems, body.reason)
        doc = {
            "id": f"rtn_{uuid.uuid4().hex[:12]}",
            "order_id": body.order_id,
            "user_id": current["id"],
            "seller_id": sid,
            "items": [
                {
                    "product_id": it["product_id"],
                    "name": it["name"],
                    "image": it["image"],
                    "price_nzd": it["price_nzd"],
                    "quantity": it["quantity"],
                }
                for it in sitems
            ],
            "reason": body.reason,
            "note": (body.note or "").strip()[:600] or None,
            "photos": body.photos[:4],
            "status": "pending_seller",
            "buyer_pays_shipping": buyer_pays,
            "restocking_fee_nzd": fee,
            "refund_amount_nzd": refund_amount,
            "created_at": now_utc(),
        }
        await db.returns.insert_one(doc)
        created.append(ReturnRequest(**doc))

        # Notify seller + admin + buyer
        await create_notification(
            user_id=sid,
            role="seller",
            n_type="return_requested",
            title=f"Return request for #{short_order}",
            body=f"Buyer requested a return ({body.reason.replace('_', ' ')}). Please review within 48h.",
            order_id=body.order_id,
        )
        await notify_admins(
            n_type="return_requested",
            title=f"Return request #{doc['id']}",
            body=f"Order #{short_order} · ${refund_amount:.2f} NZD · {body.reason}",
            order_id=body.order_id,
        )

    await create_notification(
        user_id=current["id"],
        role="buyer",
        n_type="return_requested",
        title=f"Return submitted for #{short_order}",
        body="The seller has been notified and will review within 48 hours.",
        order_id=body.order_id,
    )

    # Mark on the order doc so the UI can disable the button.
    await db.orders.update_one(
        {"id": body.order_id}, {"$set": {"return_requested_at": now_utc()}}
    )
    return created


@api.get("/returns/me", response_model=List[ReturnRequest])
async def my_returns(current=Depends(get_current_user)):
    cursor = db.returns.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [ReturnRequest(**r) async for r in cursor]


@api.get("/returns/order/{order_id}", response_model=List[ReturnRequest])
async def returns_for_order(order_id: str, current=Depends(get_current_user)):
    # User must own the order, OR be the seller of items in it.
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    is_buyer = order.get("user_id") == current["id"]
    is_seller_on_order = any(it.get("seller_id") == current["id"] for it in order.get("items", []))
    if not (is_buyer or is_seller_on_order):
        raise HTTPException(status_code=403, detail="Forbidden")
    query: dict = {"order_id": order_id}
    if is_seller_on_order and not is_buyer:
        query["seller_id"] = current["id"]
    cursor = db.returns.find(query, {"_id": 0}).sort("created_at", -1)
    return [ReturnRequest(**r) async for r in cursor]


@api.get("/seller/returns", response_model=List[ReturnRequest])
async def list_seller_returns(seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.returns.find({"seller_id": seller["id"]}, {"_id": 0}).sort("created_at", -1)
    return [ReturnRequest(**r) async for r in cursor]


async def _decide_return(return_id: str, seller_id: str, approve: bool, note: Optional[str]) -> ReturnRequest:
    rtn = await db.returns.find_one({"id": return_id, "seller_id": seller_id}, {"_id": 0})
    if not rtn:
        raise HTTPException(status_code=404, detail="Return not found")
    if rtn["status"] != "pending_seller":
        raise HTTPException(status_code=400, detail=f"Return is already {rtn['status']}")

    order = await db.orders.find_one({"id": rtn["order_id"]}, {"_id": 0})
    refund_id: Optional[str] = None
    new_status = "approved" if approve else "rejected"

    if approve and order:
        # Issue a partial Stripe refund matching this seller's portion.
        # Stripe refund amount is in cents.
        import stripe as stripe_sdk

        stripe_sdk.api_key = STRIPE_API_KEY
        session_id = order.get("session_id")
        amount_cents = int(round(float(rtn["refund_amount_nzd"]) * 100))
        if session_id and amount_cents > 0:
            try:
                session = stripe_sdk.checkout.Session.retrieve(session_id)
                pi = session.get("payment_intent") if isinstance(session, dict) else getattr(session, "payment_intent", None)
                if pi:
                    refund = stripe_sdk.Refund.create(payment_intent=pi, amount=amount_cents)
                    refund_id = refund.get("id") if isinstance(refund, dict) else getattr(refund, "id", None)
            except Exception as e:
                logger.warning("partial refund failed for return %s: %s", return_id, e)
        new_status = "refunded" if refund_id else "approved"

    updated = await db.returns.find_one_and_update(
        {"id": return_id},
        {
            "$set": {
                "status": new_status,
                "decided_at": now_utc(),
                "decision_note": (note or "").strip()[:300] or None,
                "refund_id": refund_id,
            }
        },
        return_document=True,
    )
    updated.pop("_id", None)

    short = rtn["order_id"].replace("order_", "")[:8].upper()
    if approve:
        await create_notification(
            user_id=rtn["user_id"],
            role="buyer",
            n_type="return_approved",
            title=f"Return for #{short} approved",
            body=(
                f"Your refund of ${rtn['refund_amount_nzd']:.2f} NZD is on the way "
                "and will appear within 5–10 business days."
            ),
            order_id=rtn["order_id"],
        )
    else:
        await create_notification(
            user_id=rtn["user_id"],
            role="buyer",
            n_type="return_rejected",
            title=f"Return for #{short} declined",
            body=(note or "The seller couldn't accept this return.")[:200],
            order_id=rtn["order_id"],
        )

    await notify_admins(
        n_type=f"return_{new_status}",
        title=f"Return {new_status} #{return_id}",
        body=f"Order #{short} · ${rtn['refund_amount_nzd']:.2f} NZD",
        order_id=rtn["order_id"],
    )
    return ReturnRequest(**updated)


@api.post("/returns/{return_id}/approve", response_model=ReturnRequest)
async def approve_return(return_id: str, body: ReturnDecision, seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    return await _decide_return(return_id, seller["id"], approve=True, note=body.note)


@api.post("/returns/{return_id}/reject", response_model=ReturnRequest)
async def reject_return(return_id: str, body: ReturnDecision, seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    return await _decide_return(return_id, seller["id"], approve=False, note=body.note)


def _orig_create_payouts_for_order_marker():
    pass


@api.post("/checkout/session")
async def create_checkout_session(body: CheckoutRequest, current=Depends(get_current_user)):
    cart = await hydrate_cart(current["id"])
    if not cart.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    order_id = f"order_{uuid.uuid4().hex[:12]}"
    # Enrich each item with seller_id/seller_name from the product doc so we can
    # later route orders to sellers and create payouts even if the product is
    # later edited or deleted.
    order_items: list[OrderItem] = []
    for it in cart.items:
        prod = await db.products.find_one({"id": it["product_id"]}, {"_id": 0})
        order_items.append(
            OrderItem(
                product_id=it["product_id"],
                name=it["name"],
                image=it["image"],
                price_nzd=it["price_nzd"],
                quantity=it["quantity"],
                seller_id=(prod or {}).get("seller_id"),
                seller_name=(prod or {}).get("seller_name"),
            )
        )

    success_url = f"{body.origin_url.rstrip('/')}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{body.origin_url.rstrip('/')}/checkout/cancel"

    stripe = get_stripe(body.origin_url)
    session_req = CheckoutSessionRequest(
        amount=float(cart.total_nzd),
        currency="nzd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "order_id": order_id,
            "user_id": current["id"],
            "items_count": str(sum(it["quantity"] for it in cart.items)),
        },
    )
    session = await stripe.create_checkout_session(session_req)

    order_doc = {
        "id": order_id,
        "user_id": current["id"],
        "items": [oi.model_dump() for oi in order_items],
        "subtotal_nzd": cart.subtotal_nzd,
        "shipping_nzd": cart.shipping_nzd,
        "total_nzd": cart.total_nzd,
        "address": body.address.model_dump(),
        "status": "pending",
        "payment_status": "initiated",
        "session_id": session.session_id,
        "created_at": now_utc(),
        "estimated_delivery": estimate_delivery_window(),
    }
    await db.orders.insert_one(order_doc)
    await db.payment_transactions.insert_one(
        {
            "session_id": session.session_id,
            "order_id": order_id,
            "user_id": current["id"],
            "amount": cart.total_nzd,
            "currency": "nzd",
            "payment_status": "initiated",
            "metadata": session_req.metadata,
            "created_at": now_utc(),
        }
    )
    return {"url": session.url, "session_id": session.session_id, "order_id": order_id}


@api.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, request: Request, current=Depends(get_current_user)):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx or tx.get("user_id") != current["id"]:
        raise HTTPException(status_code=404, detail="Session not found")

    origin = str(request.base_url).rstrip("/")
    stripe = get_stripe(origin)
    status_resp: CheckoutStatusResponse = await stripe.get_checkout_status(session_id)

    # Update if changed (idempotent).
    if tx.get("payment_status") != status_resp.payment_status:
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": status_resp.payment_status, "updated_at": now_utc()}},
        )
        if status_resp.payment_status == "paid":
            paid_at = now_utc()
            await db.orders.update_one(
                {"id": tx["order_id"]},
                {
                    "$set": {
                        "payment_status": "paid",
                        "status": "paid",
                        "paid_at": paid_at,
                        "cancellable_until": cancellable_until_from(paid_at),
                    }
                },
            )
            await create_payouts_for_order(tx["order_id"])
            await book_shiprocket_shipment(tx["order_id"])
            await notify_order_placed(tx["order_id"])
            # Clear cart on successful payment.
            await db.carts.update_one(
                {"user_id": current["id"]},
                {"$set": {"items": [], "updated_at": now_utc()}},
                upsert=True,
            )
    return {
        "session_id": session_id,
        "order_id": tx["order_id"],
        "payment_status": status_resp.payment_status,
        "status": status_resp.status,
        "amount_total": status_resp.amount_total,
        "currency": status_resp.currency,
    }


@api.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("Stripe-Signature", "")
    origin = str(request.base_url).rstrip("/")
    stripe = get_stripe(origin)
    try:
        response = await stripe.handle_webhook(body, signature)
    except Exception as e:
        logger.warning("webhook error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    if response.payment_status == "paid" and response.session_id:
        tx = await db.payment_transactions.find_one({"session_id": response.session_id}, {"_id": 0})
        if tx:
            await db.payment_transactions.update_one(
                {"session_id": response.session_id},
                {"$set": {"payment_status": "paid", "updated_at": now_utc()}},
            )
            paid_at = now_utc()
            await db.orders.update_one(
                {"id": tx["order_id"]},
                {
                    "$set": {
                        "payment_status": "paid",
                        "status": "paid",
                        "paid_at": paid_at,
                        "cancellable_until": cancellable_until_from(paid_at),
                    }
                },
            )
            await create_payouts_for_order(tx["order_id"])
            await book_shiprocket_shipment(tx["order_id"])
            await notify_order_placed(tx["order_id"])
            await db.carts.update_one(
                {"user_id": tx["user_id"]},
                {"$set": {"items": [], "updated_at": now_utc()}},
                upsert=True,
            )
    return {"received": True}


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------
@api.get("/orders", response_model=List[Order])
async def list_orders(current=Depends(get_current_user)):
    cursor = db.orders.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [Order(**o) async for o in cursor]


@api.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str, current=Depends(get_current_user)):
    o = await db.orders.find_one({"id": order_id, "user_id": current["id"]}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return Order(**o)


@api.get("/shipments/{order_id}", response_model=Shipment)
async def get_shipment(order_id: str, current=Depends(get_current_user)):
    o = await db.orders.find_one({"id": order_id, "user_id": current["id"]}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    s = await db.shipments.find_one({"order_id": order_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Shipment not yet created")
    return Shipment(**{k: s[k] for k in Shipment.model_fields.keys() if k in s})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api.get("/")
async def root():
    return {"app": "Allsale", "status": "ok", "currency": "NZD", "origin": "India"}


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.products.create_index("id", unique=True)
    await db.products.create_index("category")
    await db.products.create_index("subcategory")
    await db.carts.create_index("user_id", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("user_id")
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.sellers.create_index("user_id", unique=True)
    await db.sellers.create_index("gstin", unique=True)
    await db.products.create_index("seller_id")
    await db.payouts.create_index("id", unique=True)
    await db.payouts.create_index([("seller_id", 1), ("status", 1)])
    await db.payouts.create_index([("order_id", 1), ("seller_id", 1)], unique=True)
    await db.orders.create_index("items.seller_id")
    await db.shipments.create_index("order_id", unique=True)
    await db.shipments.create_index("awb_code", unique=True)
    await db.notifications.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read", 1)])
    await db.returns.create_index("id", unique=True)
    await db.returns.create_index([("user_id", 1), ("created_at", -1)])
    await db.returns.create_index([("seller_id", 1), ("status", 1)])
    await db.returns.create_index("order_id")
    await seed_products()


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
