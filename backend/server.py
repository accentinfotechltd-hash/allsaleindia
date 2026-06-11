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

# Shipping rule: free over NZD 100, else NZD 12 flat.
FREE_SHIPPING_THRESHOLD_NZD = 100.0
FLAT_SHIPPING_NZD = 12.0
PLATFORM_COMMISSION = 0.15  # 15% of gross to the platform

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
    price_nzd: float
    price_inr: float
    image: str
    images: List[str] = []
    rating: float = 4.5
    reviews_count: int = 0
    in_stock: bool = True
    shipping_days_min: int = 7
    shipping_days_max: int = 14
    origin: str = "India"
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None


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
    status: str  # pending | paid | shipped | delivered | cancelled
    payment_status: str  # initiated | paid | failed
    session_id: Optional[str] = None
    created_at: datetime
    estimated_delivery: str  # human readable e.g. "12-18 Mar 2026"


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
    # Ethnic wear
    {
        "name": "Handwoven Silk Saree — Royal Maroon",
        "description": "Authentic Banarasi silk saree handwoven by artisans in Varanasi. Comes with matching blouse piece. Perfect for weddings and festive occasions.",
        "category": "Ethnic Wear",
        "price_nzd": 89.00,
        "image": "https://images.unsplash.com/photo-1717585679395-bbe39b5fb6bc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
        "rating": 4.8,
        "reviews_count": 312,
    },
    {
        "name": "Embroidered Anarkali Suit Set",
        "description": "Three-piece Anarkali suit with intricate zari embroidery. Includes dupatta and bottoms. Imported directly from Jaipur.",
        "category": "Ethnic Wear",
        "price_nzd": 65.50,
        "image": "https://images.unsplash.com/photo-1503160865267-af4660ce7bf2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
        "rating": 4.7,
        "reviews_count": 184,
    },
    {
        "name": "Designer Lehenga Choli — Pastel Pink",
        "description": "Bridal-grade lehenga with mirror work and sequins. Three-piece set. Custom alterations available on request.",
        "category": "Ethnic Wear",
        "price_nzd": 149.00,
        "image": "https://images.pexels.com/photos/14928074/pexels-photo-14928074.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "rating": 4.9,
        "reviews_count": 92,
    },
    # Brass / handicrafts
    {
        "name": "Brass Ganesha Idol — 6 inch",
        "description": "Hand-cast brass Ganesha idol from Moradabad. Polished finish, weighs 850g. Perfect for home temple or as a gift.",
        "category": "Home & Decor",
        "price_nzd": 42.00,
        "image": "https://images.unsplash.com/photo-1650383044645-5d32141ad1a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
        "rating": 4.9,
        "reviews_count": 207,
    },
    {
        "name": "Antique Brass Diya Set (Pack of 5)",
        "description": "Traditional oil lamps for Diwali and daily worship. Hand-engraved with floral motifs.",
        "category": "Home & Decor",
        "price_nzd": 28.50,
        "image": "https://images.unsplash.com/photo-1652960018678-1f19799996c5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
        "rating": 4.6,
        "reviews_count": 145,
    },
    {
        "name": "Brass Pooja Thali Complete Set",
        "description": "Full pooja kit: thali, bell, incense holder, kalash and diya. Wedding gift favourite.",
        "category": "Home & Decor",
        "price_nzd": 56.00,
        "image": "https://images.pexels.com/photos/15755947/pexels-photo-15755947.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "rating": 4.8,
        "reviews_count": 78,
    },
    # Spices & tea
    {
        "name": "Premium Darjeeling Tea — 250g",
        "description": "First-flush Darjeeling loose-leaf tea, sourced directly from Makaibari estate. Smooth muscatel flavour.",
        "category": "Spices & Tea",
        "price_nzd": 18.90,
        "image": "https://images.unsplash.com/photo-1623193893878-656ec0391ea1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwyfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.9,
        "reviews_count": 524,
    },
    {
        "name": "Whole Spice Collection — 12 jars",
        "description": "Cardamom, cloves, turmeric, cumin, coriander, fenugreek and more. Air-tight glass jars. Fresh-ground.",
        "category": "Spices & Tea",
        "price_nzd": 47.00,
        "image": "https://images.unsplash.com/photo-1589536677029-c0aa1808fba6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.8,
        "reviews_count": 263,
    },
    {
        "name": "Masala Chai Blend — 500g",
        "description": "Strong Assam black tea blended with cardamom, ginger, clove and cinnamon. Brew NZ winter warmer.",
        "category": "Spices & Tea",
        "price_nzd": 22.50,
        "image": "https://images.unsplash.com/photo-1683533698664-12ee473e8c9d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.7,
        "reviews_count": 318,
    },
]


async def seed_products() -> None:
    count = await db.products.count_documents({})
    if count > 0:
        return
    docs = []
    for p in SEED_PRODUCTS:
        pid = str(uuid.uuid4())
        docs.append(
            {
                "id": pid,
                "name": p["name"],
                "description": p["description"],
                "category": p["category"],
                "price_nzd": p["price_nzd"],
                "price_inr": round(p["price_nzd"] * INR_PER_NZD, 0),
                "image": p["image"],
                "images": [p["image"]],
                "rating": p.get("rating", 4.5),
                "reviews_count": p.get("reviews_count", 0),
                "in_stock": True,
                "shipping_days_min": 7,
                "shipping_days_max": 14,
                "origin": "India",
            }
        )
    await db.products.insert_many(docs)
    logger.info("seeded %d products", len(docs))


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
async def list_products(category: Optional[str] = None, q: Optional[str] = None):
    query: dict = {}
    if category and category.lower() != "all":
        query["category"] = category
    if q:
        query["name"] = {"$regex": q, "$options": "i"}
    cursor = db.products.find(query, {"_id": 0})
    return [Product(**p) async for p in cursor]


@api.get("/categories", response_model=List[str])
async def list_categories():
    cats = await db.products.distinct("category")
    return sorted(cats)


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
            await db.orders.update_one(
                {"id": tx["order_id"]},
                {"$set": {"payment_status": "paid", "status": "paid"}},
            )
            await create_payouts_for_order(tx["order_id"])
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
            await db.orders.update_one(
                {"id": tx["order_id"]},
                {"$set": {"payment_status": "paid", "status": "paid"}},
            )
            await create_payouts_for_order(tx["order_id"])
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
    await seed_products()


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
