"""Wishlist — buyers save products for later.

Stored as one document per (user, product) in `wishlists`. Listing
joins on `products` for fresh price / image / availability.
"""
from __future__ import annotations

import secrets
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import db
from deps import get_current_user
from utils import now_utc

router = APIRouter(prefix="/wishlist", tags=["wishlist"])


class WishlistItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    price_inr: float
    category: str
    rating: float = 0.0
    reviews_count: int = 0
    in_stock: bool = True
    seller_name: str | None = None
    seller_city: str | None = None
    added_at: str


SortKey = Literal["recent", "price_asc", "price_desc", "name"]


@router.get("", response_model=List[WishlistItem])
async def list_wishlist(
    sort: SortKey = Query("recent"),
    collection_id: Optional[str] = Query(None),
    current=Depends(get_current_user),
):
    """List saved products. Sort by `recent` (default), `price_asc`, `price_desc`, `name`.
    Optionally scope to a single ``collection_id`` (omit to see all saved items)."""
    rows: list[WishlistItem] = []
    base_filter: dict = {"user_id": current["id"]}
    if collection_id is not None:
        base_filter["collection_id"] = collection_id
    async for w in db.wishlists.find(base_filter, {"_id": 0}).sort(
        "added_at", -1
    ):
        prod = await db.products.find_one(
            {"id": w["product_id"]},
            {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1, "price_inr": 1, "category": 1, "rating": 1, "reviews_count": 1, "stock_count": 1, "seller_name": 1, "seller_city": 1},
        )
        if not prod:
            continue
        rows.append(
            WishlistItem(
                product_id=prod["id"],
                name=prod["name"],
                image=prod["image"],
                price_nzd=float(prod.get("price_nzd", 0)),
                price_inr=float(prod.get("price_inr", 0)),
                category=prod.get("category", ""),
                rating=float(prod.get("rating", 0) or 0),
                reviews_count=int(prod.get("reviews_count", 0) or 0),
                in_stock=int(prod.get("stock_count", 0) or 0) > 0,
                seller_name=prod.get("seller_name"),
                seller_city=prod.get("seller_city"),
                added_at=w.get("added_at").isoformat() if w.get("added_at") else "",
            )
        )
    # Apply secondary sort in Python (cheap, list is bounded by user's saved
    # items count which is typically <500).
    if sort == "price_asc":
        rows.sort(key=lambda r: r.price_nzd)
    elif sort == "price_desc":
        rows.sort(key=lambda r: r.price_nzd, reverse=True)
    elif sort == "name":
        rows.sort(key=lambda r: r.name.lower())
    # `recent` keeps the existing -added_at order from Mongo
    return rows


@router.get("/ids", response_model=List[str])
async def list_wishlist_ids(current=Depends(get_current_user)):
    """Lightweight — just the product_ids so the client can render heart
    icons across the whole catalog without fetching full hydrated data."""
    return [
        w["product_id"]
        async for w in db.wishlists.find(
            {"user_id": current["id"]}, {"_id": 0, "product_id": 1}
        )
    ]


# ---------------------------------------------------------------------------
# Wishlist 2.0 — bulk operations
# IMPORTANT: These STATIC paths (`/move-to-cart`, `/remove-bulk`) MUST be
# registered BEFORE the dynamic `/{product_id}` routes below; FastAPI/Starlette
# matches routes in registration order and would otherwise treat
# "move-to-cart" as a `product_id` value and 404 on the products lookup.
# ---------------------------------------------------------------------------
class MoveToCartRequest(BaseModel):
    """If `product_ids` is empty or omitted, moves the FULL wishlist (in-stock only)."""
    product_ids: Optional[List[str]] = None
    remove_after: bool = True


@router.post("/move-to-cart")
async def move_to_cart(
    body: MoveToCartRequest, current=Depends(get_current_user)
):
    """Bulk-add wishlist items to the buyer's cart.

    Skips out-of-stock items and reports them back so the UI can keep them
    in the wishlist with a helpful note. Idempotent: if a product is already
    in the cart, its quantity is incremented by 1.
    """
    # Resolve target product ids (default = entire wishlist).
    target_ids: list[str] = body.product_ids or []
    if not target_ids:
        target_ids = [
            w["product_id"]
            async for w in db.wishlists.find(
                {"user_id": current["id"]}, {"_id": 0, "product_id": 1}
            )
        ]

    if not target_ids:
        return {
            "moved": 0,
            "moved_ids": [],
            "skipped": [],
            "cart_count": 0,
            "wishlist_count": 0,
        }

    cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0})
    items: list[dict] = list((cart or {}).get("items") or [])
    by_pid = {it["product_id"]: it for it in items}

    skipped: list[dict] = []
    moved_ids: list[str] = []

    for pid in target_ids:
        prod = await db.products.find_one(
            {"id": pid}, {"_id": 0, "id": 1, "stock_count": 1, "in_stock": 1}
        )
        if not prod:
            skipped.append({"product_id": pid, "reason": "not_found"})
            continue

        stock_count = prod.get("stock_count")
        if stock_count is not None and not prod.get("in_stock", True):
            skipped.append({"product_id": pid, "reason": "out_of_stock"})
            continue
        if isinstance(stock_count, int) and stock_count <= 0:
            skipped.append({"product_id": pid, "reason": "out_of_stock"})
            continue

        existing = by_pid.get(pid)
        if existing:
            new_qty = (existing.get("quantity") or 0) + 1
            if isinstance(stock_count, int) and stock_count > 0 and new_qty > stock_count:
                skipped.append({"product_id": pid, "reason": "stock_limit"})
                continue
            existing["quantity"] = new_qty
        else:
            items.append({"product_id": pid, "quantity": 1})
            by_pid[pid] = items[-1]
        moved_ids.append(pid)

    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"items": items, "updated_at": now_utc()}},
        upsert=True,
    )

    if body.remove_after and moved_ids:
        await db.wishlists.delete_many(
            {"user_id": current["id"], "product_id": {"$in": moved_ids}}
        )

    wishlist_count = await db.wishlists.count_documents(
        {"user_id": current["id"]}
    )
    cart_count = sum(it.get("quantity", 0) for it in items)
    return {
        "moved": len(moved_ids),
        "moved_ids": moved_ids,
        "skipped": skipped,
        "cart_count": cart_count,
        "wishlist_count": wishlist_count,
    }


class WishlistRemoveBulkRequest(BaseModel):
    product_ids: List[str]


@router.post("/remove-bulk")
async def remove_bulk(
    body: WishlistRemoveBulkRequest, current=Depends(get_current_user)
):
    """Remove multiple items from the wishlist in a single round-trip."""
    if not body.product_ids:
        wl_count = await db.wishlists.count_documents({"user_id": current["id"]})
        return {"removed": 0, "wishlist_count": wl_count}
    res = await db.wishlists.delete_many(
        {"user_id": current["id"], "product_id": {"$in": body.product_ids}}
    )
    wl_count = await db.wishlists.count_documents({"user_id": current["id"]})
    return {"removed": res.deleted_count, "wishlist_count": wl_count}


@router.delete("", status_code=200)
async def clear_wishlist(current=Depends(get_current_user)):
    """Empty the buyer's entire wishlist (used by the 'Clear all' UI action)."""
    res = await db.wishlists.delete_many({"user_id": current["id"]})
    return {"removed": res.deleted_count, "wishlist_count": 0}


# ---------------------------------------------------------------------------
# Public shareable wishlist link (June 2026)
# ---------------------------------------------------------------------------
@router.post("/share")
async def create_share_link(current=Depends(get_current_user)):
    """Mint (or reuse) a public token + return the canonical share URL.
    Idempotent — same token re-used across calls so the link never goes stale
    in already-sent invites."""
    user = await db.users.find_one(
        {"id": current["id"]},
        {"_id": 0, "id": 1, "full_name": 1, "wishlist_share_token": 1},
    )
    token = (user or {}).get("wishlist_share_token")
    if not token:
        token = secrets.token_urlsafe(12)
        await db.users.update_one(
            {"id": current["id"]},
            {"$set": {"wishlist_share_token": token, "wishlist_share_enabled": True}},
        )
    else:
        # Re-enable in case the user had revoked previously.
        await db.users.update_one(
            {"id": current["id"]}, {"$set": {"wishlist_share_enabled": True}}
        )
    return {
        "token": token,
        "url": f"https://allsale.co.nz/w/{token}",
        "deep_link": f"allsale://wishlist/share/{token}",
    }


@router.delete("/share")
async def revoke_share_link(current=Depends(get_current_user)):
    """Disable the public link (the token survives so re-enabling reuses it)."""
    await db.users.update_one(
        {"id": current["id"]}, {"$set": {"wishlist_share_enabled": False}}
    )
    return {"revoked": True}


@router.get("/share/{token}", response_model=List[WishlistItem])
async def public_wishlist_view(token: str):
    """Public, no-auth read-only view of a user's wishlist by share token."""
    user = await db.users.find_one(
        {"wishlist_share_token": token, "wishlist_share_enabled": True},
        {"_id": 0, "id": 1, "full_name": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Wishlist not found or private")
    rows: list[WishlistItem] = []
    async for w in db.wishlists.find({"user_id": user["id"]}, {"_id": 0}).sort(
        "added_at", -1
    ):
        prod = await db.products.find_one(
            {"id": w["product_id"]},
            {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1, "price_inr": 1, "category": 1, "rating": 1, "reviews_count": 1, "stock_count": 1, "seller_name": 1, "seller_city": 1},
        )
        if not prod:
            continue
        rows.append(
            WishlistItem(
                product_id=prod["id"],
                name=prod["name"],
                image=prod["image"],
                price_nzd=float(prod.get("price_nzd", 0)),
                price_inr=float(prod.get("price_inr", 0)),
                category=prod.get("category", ""),
                rating=float(prod.get("rating", 0) or 0),
                reviews_count=int(prod.get("reviews_count", 0) or 0),
                in_stock=int(prod.get("stock_count", 0) or 0) > 0,
                seller_name=prod.get("seller_name"),
                seller_city=prod.get("seller_city"),
                added_at=w.get("added_at").isoformat() if w.get("added_at") else "",
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Collections — Amazon-style named wishlists ("Diwali", "Wedding"…).
#
# Storage: a separate `wishlist_collections` collection with documents
# ``{id, user_id, name, created_at}``. Wishlist items are linked via an
# optional ``collection_id`` field on the existing `wishlists` doc;
# legacy/unsorted items keep ``collection_id=None`` and appear in the
# implicit "All saved" view.
#
# REGISTERED BEFORE the dynamic /{product_id} routes so paths like
# "/collections" don't get matched as a product_id.
# ---------------------------------------------------------------------------
import uuid as _wlc_uuid

from db import db as _wlc_db


class CollectionCreate(BaseModel):
    name: str


class CollectionRename(BaseModel):
    name: str


class MoveItemRequest(BaseModel):
    collection_id: Optional[str] = None  # null = move back to "All saved"


@router.get("/collections")
async def list_collections(current=Depends(get_current_user)):
    """List the buyer's collections + the implicit 'All saved' bucket with counts."""
    cols: list[dict] = []
    async for c in _wlc_db.wishlist_collections.find(
        {"user_id": current["id"]}, {"_id": 0}
    ).sort("created_at", -1):
        count = await _wlc_db.wishlists.count_documents(
            {"user_id": current["id"], "collection_id": c["id"]}
        )
        cols.append(
            {
                "id": c["id"],
                "name": c["name"],
                "item_count": count,
                "created_at": c["created_at"].isoformat()
                if hasattr(c.get("created_at"), "isoformat")
                else c.get("created_at"),
            }
        )
    total = await _wlc_db.wishlists.count_documents({"user_id": current["id"]})
    return {"all_saved_count": total, "collections": cols}


@router.post("/collections", status_code=201)
async def create_collection(
    body: CollectionCreate, current=Depends(get_current_user)
):
    name = body.name.strip()
    if not (1 <= len(name) <= 40):
        raise HTTPException(
            status_code=422, detail="Collection name must be 1-40 chars"
        )
    cid = f"wlc_{_wlc_uuid.uuid4().hex[:12]}"
    doc = {
        "id": cid,
        "user_id": current["id"],
        "name": name,
        "created_at": now_utc(),
    }
    await _wlc_db.wishlist_collections.insert_one(doc)
    return {
        "id": cid,
        "name": name,
        "item_count": 0,
        "created_at": doc["created_at"].isoformat(),
    }


@router.patch("/collections/{collection_id}")
async def rename_collection(
    collection_id: str,
    body: CollectionRename,
    current=Depends(get_current_user),
):
    name = body.name.strip()
    if not (1 <= len(name) <= 40):
        raise HTTPException(
            status_code=422, detail="Collection name must be 1-40 chars"
        )
    res = await _wlc_db.wishlist_collections.update_one(
        {"id": collection_id, "user_id": current["id"]},
        {"$set": {"name": name}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"id": collection_id, "name": name}


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: str, current=Depends(get_current_user)
):
    """Deletes a collection. Items in it are NOT removed from the wishlist —
    their ``collection_id`` is reset so they appear under 'All saved'."""
    res = await _wlc_db.wishlist_collections.delete_one(
        {"id": collection_id, "user_id": current["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Collection not found")
    await _wlc_db.wishlists.update_many(
        {"user_id": current["id"], "collection_id": collection_id},
        {"$set": {"collection_id": None}},
    )
    return {"deleted": collection_id}


@router.patch("/items/{product_id}")
async def move_item_to_collection(
    product_id: str,
    body: MoveItemRequest,
    current=Depends(get_current_user),
):
    """Move a saved item into another collection (or back to None=All saved)."""
    if body.collection_id is not None:
        owner = await _wlc_db.wishlist_collections.find_one(
            {"id": body.collection_id, "user_id": current["id"]},
            {"_id": 0, "id": 1},
        )
        if not owner:
            raise HTTPException(status_code=404, detail="Collection not found")

    res = await _wlc_db.wishlists.update_one(
        {"user_id": current["id"], "product_id": product_id},
        {"$set": {"collection_id": body.collection_id}},
    )
    if res.matched_count == 0:
        raise HTTPException(
            status_code=404, detail="Item not in your wishlist"
        )
    return {"product_id": product_id, "collection_id": body.collection_id}


# ---------------------------------------------------------------------------
# Single-item dynamic routes — registered LAST so the static routes above win.
# ---------------------------------------------------------------------------
@router.post("/{product_id}", status_code=201)
async def add_to_wishlist(product_id: str, current=Depends(get_current_user)):
    prod = await db.products.find_one(
        {"id": product_id}, {"_id": 0, "id": 1, "seller_id": 1}
    )
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    # Upsert idempotently
    await db.wishlists.update_one(
        {"user_id": current["id"], "product_id": product_id},
        {
            "$setOnInsert": {
                "user_id": current["id"],
                "product_id": product_id,
                "added_at": now_utc(),
            }
        },
        upsert=True,
    )
    count = await db.wishlists.count_documents({"user_id": current["id"]})
    return {"added": True, "wishlist_count": count}


@router.delete("/{product_id}", status_code=200)
async def remove_from_wishlist(product_id: str, current=Depends(get_current_user)):
    await db.wishlists.delete_one(
        {"user_id": current["id"], "product_id": product_id}
    )
    count = await db.wishlists.count_documents({"user_id": current["id"]})
    return {"removed": True, "wishlist_count": count}

