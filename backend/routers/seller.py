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
    BulkListingOp,
    BulkListingResult,
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


# ---------------------------------------------------------------------------
# Bulk edit listings
# ---------------------------------------------------------------------------
VALID_BULK_ACTIONS = {
    "set_price",
    "adjust_price_pct",
    "set_stock",
    "adjust_stock",
    "set_category",
    "set_in_stock",
    "delete",
}


@router.post("/seller/products/bulk", response_model=BulkListingResult)
async def bulk_listings_op(
    body: BulkListingOp, seller=Depends(_require_verified_seller)
):
    """Apply a single bulk operation to many of the seller's listings.

    Operations:
      * `set_price` (requires `price_nzd`)
      * `adjust_price_pct` (requires `pct`; e.g. `-10` for a 10% discount)
      * `set_stock` (requires `stock_count`)
      * `adjust_stock` (requires `stock_delta`; e.g. `+5`)
      * `set_category` (requires `category`)
      * `set_in_stock` (requires `in_stock` boolean)
      * `delete`
    """
    if body.action not in VALID_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")

    # Always scope to the seller's own products to prevent cross-seller damage.
    base_filter: dict = {
        "id": {"$in": body.product_ids},
        "seller_id": seller["id"],
    }

    if body.action == "delete":
        res = await db.products.delete_many(base_filter)
        return BulkListingResult(
            matched=res.deleted_count,
            modified=0,
            deleted=res.deleted_count,
            action=body.action,
        )

    if body.action == "set_price":
        if body.price_nzd is None:
            raise HTTPException(status_code=400, detail="price_nzd required")
        new_price = round(float(body.price_nzd), 2)
        res = await db.products.update_many(
            base_filter,
            {
                "$set": {
                    "price_nzd": new_price,
                    "price_inr": round(new_price * INR_PER_NZD, 0),
                    "updated_at": now_utc(),
                }
            },
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "adjust_price_pct":
        if body.pct is None:
            raise HTTPException(status_code=400, detail="pct required")
        factor = 1.0 + float(body.pct) / 100.0
        if factor <= 0:
            raise HTTPException(status_code=400, detail="pct would zero/negate price")
        res = await db.products.update_many(
            base_filter,
            [
                {
                    "$set": {
                        "price_nzd": {
                            "$round": [{"$multiply": ["$price_nzd", factor]}, 2]
                        }
                    }
                },
                {
                    "$set": {
                        "price_inr": {
                            "$round": [
                                {"$multiply": ["$price_nzd", INR_PER_NZD]},
                                0,
                            ]
                        },
                        "updated_at": now_utc(),
                    }
                },
            ],
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "set_stock":
        if body.stock_count is None:
            raise HTTPException(status_code=400, detail="stock_count required")
        sc = int(body.stock_count)
        res = await db.products.update_many(
            base_filter,
            {"$set": {"stock_count": sc, "in_stock": sc > 0, "updated_at": now_utc()}},
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "adjust_stock":
        if body.stock_delta is None:
            raise HTTPException(status_code=400, detail="stock_delta required")
        delta = int(body.stock_delta)
        res = await db.products.update_many(
            base_filter,
            [
                {
                    "$set": {
                        "stock_count": {
                            "$max": [
                                0,
                                {
                                    "$add": [
                                        {"$ifNull": ["$stock_count", 0]},
                                        delta,
                                    ]
                                },
                            ]
                        }
                    }
                },
                {
                    "$set": {
                        "in_stock": {"$gt": ["$stock_count", 0]},
                        "updated_at": now_utc(),
                    }
                },
            ],
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    if body.action == "set_category":
        if not body.category:
            raise HTTPException(status_code=400, detail="category required")
        res = await db.products.update_many(
            base_filter,
            {"$set": {"category": body.category.strip(), "updated_at": now_utc()}},
        )
        return BulkListingResult(
            matched=res.matched_count,
            modified=res.modified_count,
            deleted=0,
            action=body.action,
        )

    # set_in_stock
    if body.in_stock is None:
        raise HTTPException(status_code=400, detail="in_stock required")
    res = await db.products.update_many(
        base_filter,
        {"$set": {"in_stock": bool(body.in_stock), "updated_at": now_utc()}},
    )
    return BulkListingResult(
        matched=res.matched_count,
        modified=res.modified_count,
        deleted=0,
        action=body.action,
    )


# ---------------------------------------------------------------------------
# Seller analytics dashboard
# ---------------------------------------------------------------------------
@router.post("/products/{product_id}/track-view")
async def track_product_view(product_id: str):
    """Anonymous product-view counter. Fire-and-forget from the buyer client."""
    await db.products.update_one(
        {"id": product_id}, {"$inc": {"view_count": 1}}
    )
    return {"ok": True}


@router.post("/products/{product_id}/track-cart-add")
async def track_cart_add(product_id: str):
    """Anonymous add-to-cart counter."""
    await db.products.update_one(
        {"id": product_id}, {"$inc": {"cart_add_count": 1}}
    )
    return {"ok": True}


@router.get("/seller/analytics")
async def seller_analytics(seller=Depends(get_current_user)):
    """Aggregate per-listing analytics for the current seller.

    Returns view/cart-add/purchase counters per product plus a sellerwide
    summary (top 5 by views and by sold quantity).
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    # Per-product counters live on the product doc itself.
    cursor = db.products.find(
        {"seller_id": seller["id"]},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "image": 1,
            "price_nzd": 1,
            "stock_count": 1,
            "in_stock": 1,
            "view_count": 1,
            "cart_add_count": 1,
        },
    )
    products = [p async for p in cursor]

    # Sold quantity per product is derived from orders containing this seller's items.
    sold_map: dict[str, dict] = {}
    orders_cursor = db.orders.find(
        {
            "items.seller_id": seller["id"],
            "payment_status": "paid",
            "status": {"$nin": ["cancelled", "refunded"]},
        },
        {"_id": 0, "items": 1, "created_at": 1},
    )
    async for o in orders_cursor:
        for it in o.get("items", []):
            if it.get("seller_id") != seller["id"]:
                continue
            pid = it.get("product_id")
            if not pid:
                continue
            bucket = sold_map.setdefault(
                pid, {"sold": 0, "revenue_nzd": 0.0}
            )
            bucket["sold"] += int(it.get("quantity", 0))
            bucket["revenue_nzd"] += float(it.get("price_nzd", 0)) * int(
                it.get("quantity", 0)
            )

    listings = []
    for p in products:
        pid = p["id"]
        views = int(p.get("view_count") or 0)
        cart_adds = int(p.get("cart_add_count") or 0)
        sold = int(sold_map.get(pid, {}).get("sold", 0))
        revenue = round(float(sold_map.get(pid, {}).get("revenue_nzd", 0.0)), 2)
        conversion_pct = round((sold / views) * 100, 1) if views > 0 else 0.0
        listings.append(
            {
                "product_id": pid,
                "name": p.get("name"),
                "image": p.get("image"),
                "price_nzd": float(p.get("price_nzd", 0)),
                "stock_count": int(p.get("stock_count") or 0),
                "in_stock": bool(p.get("in_stock", True)),
                "views": views,
                "cart_adds": cart_adds,
                "sold": sold,
                "revenue_nzd": revenue,
                "conversion_pct": conversion_pct,
            }
        )

    total_views = sum(int(p.get("view_count") or 0) for p in products)
    total_cart_adds = sum(int(p.get("cart_add_count") or 0) for p in products)
    total_sold = sum(b["sold"] for b in sold_map.values())
    total_revenue = round(sum(b["revenue_nzd"] for b in sold_map.values()), 2)

    top_by_views = sorted(listings, key=lambda x: x["views"], reverse=True)[:5]
    top_by_sold = sorted(listings, key=lambda x: x["sold"], reverse=True)[:5]

    return {
        "listings": listings,
        "summary": {
            "total_listings": len(listings),
            "total_views": total_views,
            "total_cart_adds": total_cart_adds,
            "total_sold": total_sold,
            "total_revenue_nzd": total_revenue,
            "overall_conversion_pct": (
                round((total_sold / total_views) * 100, 1) if total_views > 0 else 0.0
            ),
        },
        "top_by_views": top_by_views,
        "top_by_sold": top_by_sold,
    }


# ---------------------------------------------------------------------------
# CSV export of seller orders
# ---------------------------------------------------------------------------
@router.get("/seller/orders.csv")
async def export_seller_orders_csv(seller=Depends(get_current_user)):
    """Stream a CSV of this seller's orders (one row per item).

    Columns: order_id, created_at, buyer_name, buyer_city, buyer_region,
    product_id, product_name, quantity, unit_price_nzd, item_subtotal_nzd,
    order_status, awb_code.
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

    import csv
    import io

    from fastapi.responses import StreamingResponse

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "order_id",
            "created_at",
            "buyer_name",
            "buyer_city",
            "buyer_region",
            "product_id",
            "product_name",
            "quantity",
            "unit_price_nzd",
            "item_subtotal_nzd",
            "order_status",
            "awb_code",
        ]
    )

    cursor = db.orders.find(
        {"items.seller_id": seller["id"]}, {"_id": 0}
    ).sort("created_at", -1)
    async for order in cursor:
        addr = order.get("address") or {}
        created = order.get("created_at")
        created_str = (
            created.isoformat() if hasattr(created, "isoformat") else str(created or "")
        )
        for it in order.get("items", []):
            if it.get("seller_id") != seller["id"]:
                continue
            qty = int(it.get("quantity", 0))
            unit = float(it.get("price_nzd", 0))
            writer.writerow(
                [
                    order.get("id", ""),
                    created_str,
                    addr.get("full_name", ""),
                    addr.get("city", ""),
                    addr.get("region", ""),
                    it.get("product_id", ""),
                    it.get("name", ""),
                    qty,
                    f"{unit:.2f}",
                    f"{unit * qty:.2f}",
                    order.get("status", ""),
                    order.get("awb_code", ""),
                ]
            )

    buf.seek(0)
    filename = f"allsale-orders-{seller['id']}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
