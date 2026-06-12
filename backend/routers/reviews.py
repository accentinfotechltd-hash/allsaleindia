"""Reviews & Ratings — verified-purchase only.

Buyers can leave a star rating + comment + photos on a product **only** if
they have a *delivered / out_for_delivery / shipped* order containing that
product. One review per (user, product, order_id).

Sellers can reply once per review. Anyone authenticated can mark a review
"helpful" (toggles like Amazon).

Aggregate rating + reviews_count is recomputed and synced onto the
`products` document so list / card screens stay snappy without joins.
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from db import db
from deps import get_current_user
from models import (
    EligibleReviewItem,
    Review,
    ReviewCreate,
    ReviewReply,
    ReviewReplyCreate,
    ReviewSummary,
    ReviewsPage,
)
from services.notifications import create_notification
from utils import now_utc

router = APIRouter(prefix="/reviews", tags=["reviews"])

# Order statuses considered "eligible to review" (item has been dispatched
# or actually delivered to the buyer).
ELIGIBLE_STATUSES = {"shipped", "out_for_delivery", "delivered"}
MAX_PHOTOS = 6


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _review_public(doc: dict) -> Review:
    """Strip private fields (`_id`) and project the public Review shape."""
    return Review(**{k: doc.get(k) for k in Review.model_fields.keys()})


async def _recompute_product_rating(product_id: str) -> None:
    """Recompute and persist avg rating + reviews_count on the product."""
    pipeline = [
        {"$match": {"product_id": product_id}},
        {
            "$group": {
                "_id": "$product_id",
                "avg": {"$avg": "$rating"},
                "count": {"$sum": 1},
            }
        },
    ]
    agg = await db.reviews.aggregate(pipeline).to_list(length=1)
    if agg:
        avg = round(float(agg[0]["avg"]), 2)
        count = int(agg[0]["count"])
    else:
        avg, count = 0.0, 0
    await db.products.update_one(
        {"id": product_id},
        {"$set": {"rating": avg, "reviews_count": count}},
    )


async def _eligible_orders_for(
    user_id: str, product_id: Optional[str] = None
) -> list[dict]:
    """Find orders where this user purchased `product_id` (or any product)
    and the order has reached an eligible status.

    Returns: list of {order_id, item, order_status, created_at}
    """
    q: dict = {
        "user_id": user_id,
        "status": {"$in": list(ELIGIBLE_STATUSES)},
    }
    if product_id:
        q["items.product_id"] = product_id
    out: list[dict] = []
    async for o in db.orders.find(q, {"_id": 0}):
        for it in o.get("items", []):
            if product_id and it.get("product_id") != product_id:
                continue
            out.append(
                {
                    "order_id": o["id"],
                    "item": it,
                    "order_status": o.get("status", "delivered"),
                    "created_at": o.get("created_at"),
                }
            )
    return out


# ---------------------------------------------------------------------------
# Eligible orders to review
# ---------------------------------------------------------------------------
@router.get("/eligible", response_model=List[EligibleReviewItem])
async def list_eligible_to_review(current=Depends(get_current_user)):
    """Items the buyer can still review (delivered/shipped & not yet reviewed)."""
    rows = await _eligible_orders_for(current["id"])
    if not rows:
        return []

    # Find which (order_id, product_id) tuples already have a review.
    keys = [(r["order_id"], r["item"]["product_id"]) for r in rows]
    existing = set()
    async for r in db.reviews.find(
        {
            "user_id": current["id"],
            "$or": [
                {"order_id": oid, "product_id": pid} for oid, pid in keys
            ],
        },
        {"_id": 0, "order_id": 1, "product_id": 1},
    ):
        existing.add((r["order_id"], r["product_id"]))

    items: list[EligibleReviewItem] = []
    seen: set[tuple[str, str]] = set()
    for r in rows:
        key = (r["order_id"], r["item"]["product_id"])
        if key in existing or key in seen:
            continue
        seen.add(key)
        items.append(
            EligibleReviewItem(
                order_id=r["order_id"],
                product_id=r["item"]["product_id"],
                product_name=r["item"].get("name", ""),
                product_image=r["item"].get("image", ""),
                order_status=r["order_status"],
                purchased_at=r["created_at"] or now_utc(),
            )
        )
    return items


# ---------------------------------------------------------------------------
# Read — list product reviews + summary
# ---------------------------------------------------------------------------
@router.get("/product/{product_id}", response_model=ReviewsPage)
async def list_product_reviews(
    product_id: str,
    sort: str = Query("recent", description="recent | helpful | rating_desc | rating_asc"),
    authorization: Annotated[Optional[str], Header()] = None,
):
    # Public endpoint — `current_user` injected manually if token present.
    current = None
    if authorization and authorization.lower().startswith("bearer "):
        try:
            from deps import get_current_user as _gcu
            current = await _gcu(authorization=authorization)
        except Exception:
            current = None

    sort_spec: list[tuple[str, int]]
    if sort == "helpful":
        sort_spec = [("helpful_count", -1), ("created_at", -1)]
    elif sort == "rating_desc":
        sort_spec = [("rating", -1), ("created_at", -1)]
    elif sort == "rating_asc":
        sort_spec = [("rating", 1), ("created_at", -1)]
    else:
        sort_spec = [("created_at", -1)]

    cursor = db.reviews.find({"product_id": product_id}, {"_id": 0}).sort(sort_spec)
    docs = [d async for d in cursor]

    if docs:
        avg = round(sum(d["rating"] for d in docs) / len(docs), 2)
        dist = Counter(int(d["rating"]) for d in docs)
    else:
        avg = 0.0
        dist = Counter()

    summary = ReviewSummary(
        product_id=product_id,
        avg_rating=avg,
        total=len(docs),
        distribution={str(k): dist.get(k, 0) for k in (1, 2, 3, 4, 5)},
    )

    can_review = False
    eligible_order_ids: list[str] = []
    if current:
        existing_pairs = {
            (d["user_id"], d["order_id"])
            for d in docs
            if d["user_id"] == current["id"]
        }
        rows = await _eligible_orders_for(current["id"], product_id)
        for r in rows:
            if (current["id"], r["order_id"]) in existing_pairs:
                continue
            if r["order_id"] not in eligible_order_ids:
                eligible_order_ids.append(r["order_id"])
        can_review = bool(eligible_order_ids)

    return ReviewsPage(
        summary=summary,
        items=[_review_public(d) for d in docs],
        can_review=can_review,
        eligible_order_ids=eligible_order_ids,
    )


# ---------------------------------------------------------------------------
# Create a review (verified purchase only)
# ---------------------------------------------------------------------------
@router.post("", response_model=Review, status_code=201)
async def create_review(body: ReviewCreate, current=Depends(get_current_user)):
    # 1. Buyer must own the order AND the order must contain the product
    order = await db.orders.find_one(
        {"id": body.order_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("status") not in ELIGIBLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="You can only review items after they've been dispatched or delivered.",
        )

    matching_item = next(
        (it for it in order.get("items", []) if it.get("product_id") == body.product_id),
        None,
    )
    if not matching_item:
        raise HTTPException(status_code=400, detail="That product is not in this order.")

    # 2. One review per (user, order, product)
    dup = await db.reviews.find_one(
        {
            "user_id": current["id"],
            "order_id": body.order_id,
            "product_id": body.product_id,
        },
        {"_id": 0, "id": 1},
    )
    if dup:
        raise HTTPException(status_code=409, detail="You've already reviewed this item.")

    photos = (body.photos or [])[:MAX_PHOTOS]

    review_id = f"rev_{uuid.uuid4().hex[:16]}"
    doc = {
        "id": review_id,
        "product_id": body.product_id,
        "seller_id": matching_item.get("seller_id"),
        "order_id": body.order_id,
        "user_id": current["id"],
        "user_name": current.get("full_name") or current.get("email", "Customer"),
        "user_country": current.get("country"),
        "rating": int(body.rating),
        "title": (body.title or "").strip() or None,
        "comment": body.comment.strip(),
        "photos": photos,
        "verified_purchase": True,
        "helpful_count": 0,
        "helpful_user_ids": [],
        "seller_reply": None,
        "created_at": now_utc(),
    }
    await db.reviews.insert_one(doc)
    await _recompute_product_rating(body.product_id)

    # Notify the seller a new review came in
    seller_id = matching_item.get("seller_id")
    if seller_id:
        short = body.product_id.replace("prod_", "")[:8].upper()
        await create_notification(
            user_id=seller_id,
            role="seller",
            n_type="new_review",
            title=f"New {body.rating}★ review on #{short}",
            body=(doc["title"] or doc["comment"])[:160],
        )

    return _review_public(doc)


# ---------------------------------------------------------------------------
# Helpful vote (toggle)
# ---------------------------------------------------------------------------
@router.post("/{review_id}/helpful", response_model=Review)
async def toggle_helpful(review_id: str, current=Depends(get_current_user)):
    doc = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Review not found")

    uid = current["id"]
    voters = set(doc.get("helpful_user_ids", []) or [])
    if uid in voters:
        voters.discard(uid)
    else:
        voters.add(uid)

    await db.reviews.update_one(
        {"id": review_id},
        {
            "$set": {
                "helpful_user_ids": list(voters),
                "helpful_count": len(voters),
            }
        },
    )
    fresh = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return _review_public(fresh)


# ---------------------------------------------------------------------------
# Seller reply
# ---------------------------------------------------------------------------
@router.post("/{review_id}/reply", response_model=Review)
async def seller_reply(
    review_id: str,
    body: ReviewReplyCreate,
    current=Depends(get_current_user),
):
    doc = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Review not found")
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if doc.get("seller_id") != current["id"]:
        raise HTTPException(status_code=403, detail="Only the seller of this product can reply")
    if doc.get("seller_reply"):
        raise HTTPException(status_code=409, detail="Reply already exists. Edit not supported yet.")

    seller_profile = await db.sellers.find_one(
        {"user_id": current["id"]}, {"_id": 0, "company_name": 1}
    )
    reply = ReviewReply(
        seller_id=current["id"],
        seller_name=(seller_profile or {}).get("company_name") or current.get("full_name"),
        body=body.body.strip(),
        created_at=now_utc(),
    ).model_dump()

    await db.reviews.update_one(
        {"id": review_id}, {"$set": {"seller_reply": reply}}
    )

    # Notify the buyer
    await create_notification(
        user_id=doc["user_id"],
        role="buyer",
        n_type="review_reply",
        title="Seller replied to your review",
        body=body.body[:160],
    )

    fresh = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return _review_public(fresh)


# ---------------------------------------------------------------------------
# Delete (only the author can delete their own review)
# ---------------------------------------------------------------------------
@router.delete("/{review_id}", status_code=204)
async def delete_review(review_id: str, current=Depends(get_current_user)):
    doc = await db.reviews.find_one(
        {"id": review_id}, {"_id": 0, "user_id": 1, "product_id": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Review not found")
    if doc["user_id"] != current["id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own review")
    await db.reviews.delete_one({"id": review_id})
    await _recompute_product_rating(doc["product_id"])
    return None
