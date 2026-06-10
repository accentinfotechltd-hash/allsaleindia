"""Allsale backend — cross-border e-commerce (India → New Zealand).

Auth: JWT email/password (bcrypt).
Payments: Stripe Checkout via emergentintegrations (test key).
"""
from __future__ import annotations

import logging
import os
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

# 1 NZD ≈ 51 INR (display only). Hardcoded for MVP.
INR_PER_NZD = 51.0

# Shipping rule: free over NZD 100, else NZD 12 flat.
FREE_SHIPPING_THRESHOLD_NZD = 100.0
FLAT_SHIPPING_NZD = 12.0

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


class AuthResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"


class GoogleSessionRequest(BaseModel):
    session_id: str


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
    return AuthResponse(
        user=UserPublic(id=uid, email=email, full_name=user_doc["full_name"], provider="email"),
        access_token=token,
    )


@api.post("/auth/login", response_model=AuthResponse)
async def login(body: UserLogin):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"])
    return AuthResponse(
        user=UserPublic(
            id=user["id"],
            email=user["email"],
            full_name=user["full_name"],
            picture=user.get("picture"),
            provider=user.get("provider", "email"),
        ),
        access_token=token,
    )


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
    return AuthResponse(
        user=UserPublic(
            id=user["id"],
            email=user["email"],
            full_name=user["full_name"],
            picture=user.get("picture"),
            provider=user.get("provider", "email"),
        ),
        access_token=token,
    )


@api.get("/auth/me", response_model=UserPublic)
async def me(current=Depends(get_current_user)):
    return UserPublic(
        id=current["id"],
        email=current["email"],
        full_name=current["full_name"],
        picture=current.get("picture"),
        provider=current.get("provider", "email"),
    )


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
# Stripe Checkout
# ---------------------------------------------------------------------------
def get_stripe(request_origin: str) -> StripeCheckout:
    webhook_url = f"{request_origin.rstrip('/')}/api/webhooks/stripe"
    return StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)


@api.post("/checkout/session")
async def create_checkout_session(body: CheckoutRequest, current=Depends(get_current_user)):
    cart = await hydrate_cart(current["id"])
    if not cart.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    order_id = f"order_{uuid.uuid4().hex[:12]}"
    order_items = [
        OrderItem(
            product_id=it["product_id"],
            name=it["name"],
            image=it["image"],
            price_nzd=it["price_nzd"],
            quantity=it["quantity"],
        )
        for it in cart.items
    ]

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
    await seed_products()


@app.on_event("shutdown")
async def on_shutdown():
    client.close()
