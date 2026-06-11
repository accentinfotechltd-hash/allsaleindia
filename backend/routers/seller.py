"""Seller-side endpoints: onboarding, listings CRUD, orders & payouts."""
from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

from config import INR_PER_NZD
from db import db
from deps import get_current_user
from models import (
    AuthResponse,
    ListingCreate,
    ListingUpdate,
    Payout,
    Product,
    SellerBusiness,
    SellerOrder,
    SellerOrderItem,
    SellerPayoutSummary,
    SellerProfile,
    SellerRegister,
    SellerUpgrade,
    UserPublic,
)
from utils import (
    clean_string_list,
    create_token,
    hash_password,
    now_utc,
    public_user,
    validate_indian_business,
)

router = APIRouter(tags=["seller"])


async def _require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


async def _verify_business_and_persist(user_id: str, business: SellerBusiness) -> dict:
    cleaned = validate_indian_business(business)
    # Pre-flight uniqueness check on GSTIN (only if a GSTIN is being set).
    if cleaned.get("gstin"):
        existing = await db.sellers.find_one(
            {"gstin": cleaned["gstin"], "user_id": {"$ne": user_id}},
            {"_id": 1},
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail="This GSTIN is already registered with another seller",
            )
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
        raise HTTPException(
            status_code=409,
            detail="This GSTIN is already registered with another seller",
        )
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "is_seller": True,
                "seller_verification_status": verification_status,
                "company_name": cleaned["company_name"],
            }
        },
    )
    return profile


@router.post("/seller/register", response_model=AuthResponse)
async def seller_register(body: SellerRegister):
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


@router.post("/seller/upgrade", response_model=UserPublic)
async def seller_upgrade(body: SellerUpgrade, current=Depends(get_current_user)):
    if current.get("is_seller"):
        raise HTTPException(status_code=400, detail="Already a seller")
    await _verify_business_and_persist(current["id"], body.business)
    fresh = await db.users.find_one({"id": current["id"]}, {"_id": 0, "password_hash": 0})
    return public_user(fresh)


@router.get("/seller/me", response_model=SellerProfile)
async def seller_me(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=404, detail="Not a seller")
    profile = await db.sellers.find_one({"user_id": current["id"]}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=404, detail="Seller profile not found")
    return SellerProfile(**profile)


@router.post("/seller/products", response_model=Product)
async def create_listing(body: ListingCreate, seller=Depends(_require_verified_seller)):
    pid = str(uuid.uuid4())
    profile = await db.sellers.find_one({"user_id": seller["id"]}, {"_id": 0})
    company = (profile or {}).get("company_name", seller.get("full_name"))
    seller_city = (profile or {}).get("city")

    colors = clean_string_list(body.colors, 10)
    sizes = clean_string_list(body.sizes, 12)

    # Photos: accept either `image` (legacy single URL) or `images` (new list).
    raw_images: list[str] = []
    if body.images:
        raw_images.extend(body.images)
    if body.image and body.image not in raw_images:
        raw_images.insert(0, body.image)
    images = [s.strip() for s in raw_images if s and s.strip()][:10]
    if not images:
        raise HTTPException(status_code=400, detail="At least one product photo is required")
    for s in images:
        if s.startswith("data:") and len(s) > 2_400_000:
            raise HTTPException(
                status_code=413,
                detail="One of the photos is too large (please use images under ~1.5 MB).",
            )
    primary = images[0]

    doc = {
        "id": pid,
        "name": body.name.strip(),
        "description": body.description.strip(),
        "category": body.category.strip(),
        "price_nzd": float(body.price_nzd),
        "price_inr": round(body.price_nzd * INR_PER_NZD, 0),
        "image": primary,
        "images": images,
        "rating": 0.0,
        "reviews_count": 0,
        "in_stock": int(body.stock_count) > 0,
        "stock_count": int(body.stock_count),
        "colors": colors,
        "sizes": sizes,
        "shipping_days_min": int(body.shipping_days_min),
        "shipping_days_max": int(body.shipping_days_max),
        "origin": "India",
        "seller_id": seller["id"],
        "seller_name": company,
        "seller_city": seller_city,
        "created_at": now_utc(),
    }
    await db.products.insert_one(doc)
    return Product(**{k: v for k, v in doc.items() if k != "created_at"})


@router.get("/seller/products", response_model=List[Product])
async def list_my_listings(current=Depends(get_current_user)):
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.products.find({"seller_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [
        Product(**{k: v for k, v in p.items() if k != "created_at"}) async for p in cursor
    ]


@router.delete("/seller/products/{product_id}")
async def delete_listing(product_id: str, seller=Depends(_require_verified_seller)):
    res = await db.products.delete_one({"id": product_id, "seller_id": seller["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Listing not found")
    return {"deleted": True}


@router.patch("/seller/products/{product_id}", response_model=Product)
async def update_listing(
    product_id: str,
    body: ListingUpdate,
    seller=Depends(_require_verified_seller),
):
    existing = await db.products.find_one(
        {"id": product_id, "seller_id": seller["id"]}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Listing not found")

    update: dict = {}
    if body.name is not None:
        update["name"] = body.name.strip()
    if body.description is not None:
        update["description"] = body.description.strip()
    if body.category is not None:
        update["category"] = body.category.strip()
    if body.price_nzd is not None:
        update["price_nzd"] = float(body.price_nzd)
        update["price_inr"] = round(body.price_nzd * INR_PER_NZD, 0)
    if body.images is not None:
        imgs = [s.strip() for s in body.images if s and s.strip()][:10]
        if not imgs:
            raise HTTPException(status_code=400, detail="At least one product photo is required")
        for s in imgs:
            if s.startswith("data:") and len(s) > 2_400_000:
                raise HTTPException(
                    status_code=413,
                    detail="One of the photos is too large (please use images under ~1.5 MB).",
                )
        update["images"] = imgs
        update["image"] = imgs[0]
    if body.colors is not None:
        update["colors"] = clean_string_list(body.colors, 10)
    if body.sizes is not None:
        update["sizes"] = clean_string_list(body.sizes, 12)
    if body.stock_count is not None:
        update["stock_count"] = int(body.stock_count)
        update["in_stock"] = int(body.stock_count) > 0

    if not update:
        return Product(**{k: v for k, v in existing.items() if k != "created_at"})

    update["updated_at"] = now_utc()
    await db.products.update_one({"id": product_id}, {"$set": update})
    merged = {**existing, **update}
    return Product(
        **{k: v for k, v in merged.items() if k not in {"created_at", "updated_at"}}
    )


@router.get("/seller/orders", response_model=List[SellerOrder])
async def list_seller_orders(seller=Depends(get_current_user)):
    """Orders containing at least one item this seller owns."""
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.orders.find(
        {"items.seller_id": seller["id"]},
        {"_id": 0},
    ).sort("created_at", -1)
    out: list[SellerOrder] = []
    async for order in cursor:
        my_items = [
            it for it in order.get("items", []) if it.get("seller_id") == seller["id"]
        ]
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
                items=[
                    SellerOrderItem(
                        **{k: it[k] for k in ("product_id", "name", "image", "price_nzd", "quantity")}
                    )
                    for it in my_items
                ],
                seller_subtotal_nzd=subtotal,
                status=order.get("status", "pending"),
                created_at=order.get("created_at"),
                estimated_delivery=order.get("estimated_delivery", ""),
            )
        )
    return out


@router.get("/seller/payouts", response_model=SellerPayoutSummary)
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
