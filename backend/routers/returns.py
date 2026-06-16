"""Returns flow: buyer creates, sellers approve/reject, partial refunds."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from config import (
    NON_RETURNABLE_CATEGORIES,
    RESTOCKING_FEE_PCT,
    RETURN_REASONS,
    RETURN_WINDOW_DAYS,
    SELLER_PAID_REASONS,
)
from db import db
from deps import get_current_user
from models import (
    ReturnDecision,
    ReturnRequest,
    ReturnRequestCreate,
)
from services.notifications import create_notification, notify_admins
from services.stripe_svc import issue_partial_refund
from utils import now_utc

router = APIRouter(tags=["returns"])


def _is_within_return_window(order: dict) -> bool:
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
    fee = round(gross * RESTOCKING_FEE_PCT, 2)
    return max(0.0, round(gross - fee, 2)), fee, True


@router.post("/returns/request", response_model=List[ReturnRequest])
async def create_return_requests(
    body: ReturnRequestCreate, current=Depends(get_current_user)
):
    if body.reason not in RETURN_REASONS:
        raise HTTPException(
            status_code=400, detail=f"reason must be one of {RETURN_REASONS}"
        )
    if len(body.photos) > 4:
        raise HTTPException(status_code=400, detail="Maximum 4 photos")
    if len(body.videos) > 1:
        raise HTTPException(status_code=400, detail="Maximum 1 video")

    order = await db.orders.find_one(
        {"id": body.order_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if not _is_within_return_window(order):
        raise HTTPException(
            status_code=400,
            detail="This order is not eligible for return (must be delivered within the last 7 days).",
        )

    # Photo proof is REQUIRED for seller-paid reasons. Checked AFTER ownership
    # so that other-user / outside-window requests return their original errors.
    if body.reason in SELLER_PAID_REASONS and len(body.photos) < 1:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please attach at least one photo as proof for this return reason."
            ),
        )

    all_items = order.get("items", [])
    chosen_ids = (
        set(body.product_ids)
        if body.product_ids
        else {it["product_id"] for it in all_items}
    )
    chosen_items = [it for it in all_items if it["product_id"] in chosen_ids]
    if not chosen_items:
        raise HTTPException(status_code=400, detail="No matching items in this order")

    product_ids = [it["product_id"] for it in chosen_items]
    products_cur = db.products.find({"id": {"$in": product_ids}}, {"_id": 0})
    async for p in products_cur:
        if p.get("category") in NON_RETURNABLE_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail=f"\"{p['name']}\" is in a non-returnable category ({p['category']}).",
            )

    # Store-credit refunds get a 5% bonus to incentivise the choice and
    # avoid Stripe refund fees. Anything else uses the original payment.
    refund_method = (body.refund_method or "original").strip().lower()
    if refund_method not in ("original", "store_credit"):
        refund_method = "original"

    by_seller: dict[str, list[dict]] = {}
    for it in chosen_items:
        sid = it.get("seller_id") or "unknown"
        by_seller.setdefault(sid, []).append(it)

    short_order = body.order_id.replace("order_", "")[:8].upper()
    created: list[ReturnRequest] = []
    for sid, sitems in by_seller.items():
        refund_amount, fee, buyer_pays = _compute_refund(sitems, body.reason)
        bonus = (
            round(refund_amount * 0.05, 2)
            if refund_method == "store_credit"
            else 0.0
        )
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
            "videos": body.videos[:1],
            "status": "pending_seller",
            "buyer_pays_shipping": buyer_pays,
            "restocking_fee_nzd": fee,
            "refund_amount_nzd": refund_amount,
            "refund_method": refund_method,
            "store_credit_bonus_nzd": bonus,
            "created_at": now_utc(),
        }
        await db.returns.insert_one(doc)
        created.append(ReturnRequest(**doc))

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
    await db.orders.update_one(
        {"id": body.order_id}, {"$set": {"return_requested_at": now_utc()}}
    )
    return created


@router.get("/returns/me", response_model=List[ReturnRequest])
async def my_returns(current=Depends(get_current_user)):
    cursor = db.returns.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [ReturnRequest(**r) async for r in cursor]


@router.get("/returns/order/{order_id}", response_model=List[ReturnRequest])
async def returns_for_order(order_id: str, current=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    is_buyer = order.get("user_id") == current["id"]
    is_seller_on_order = any(
        it.get("seller_id") == current["id"] for it in order.get("items", [])
    )
    if not (is_buyer or is_seller_on_order):
        raise HTTPException(status_code=403, detail="Forbidden")
    query: dict = {"order_id": order_id}
    if is_seller_on_order and not is_buyer:
        query["seller_id"] = current["id"]
    cursor = db.returns.find(query, {"_id": 0}).sort("created_at", -1)
    return [ReturnRequest(**r) async for r in cursor]


@router.get("/seller/returns", response_model=List[ReturnRequest])
async def list_seller_returns(seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = db.returns.find({"seller_id": seller["id"]}, {"_id": 0}).sort("created_at", -1)
    return [ReturnRequest(**r) async for r in cursor]


async def _decide_return(
    return_id: str, seller_id: str, approve: bool, note: Optional[str]
) -> ReturnRequest:
    rtn = await db.returns.find_one({"id": return_id, "seller_id": seller_id}, {"_id": 0})
    if not rtn:
        raise HTTPException(status_code=404, detail="Return not found")
    if rtn["status"] != "pending_seller":
        raise HTTPException(
            status_code=400, detail=f"Return is already {rtn['status']}"
        )

    order = await db.orders.find_one({"id": rtn["order_id"]}, {"_id": 0})
    refund_id: Optional[str] = None
    new_status = "approved" if approve else "rejected"
    method = rtn.get("refund_method", "original")
    bonus = float(rtn.get("store_credit_bonus_nzd") or 0.0)
    total_credit = float(rtn["refund_amount_nzd"]) + bonus

    if approve and order:
        if method == "store_credit":
            # Top up the buyer's wallet (no Stripe call needed).
            await db.users.update_one(
                {"id": rtn["user_id"]},
                {"$inc": {"wallet_balance_nzd": total_credit}},
            )
            await db.wallet_ledger.insert_one(
                {
                    "id": f"wl_{uuid.uuid4().hex[:12]}",
                    "user_id": rtn["user_id"],
                    "amount_nzd": total_credit,
                    "kind": "credit",
                    "source": "return_refund",
                    "return_id": rtn["id"],
                    "order_id": rtn["order_id"],
                    "created_at": now_utc(),
                }
            )
            new_status = "refunded"
        else:
            amount_cents = int(round(float(rtn["refund_amount_nzd"]) * 100))
            refund_id = await issue_partial_refund(
                order.get("session_id"), amount_cents
            )
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
        if method == "store_credit":
            body_msg = (
                f"${total_credit:.2f} NZD added to your Allsale wallet"
                + (f" (+${bonus:.2f} bonus)" if bonus > 0 else "")
                + ". Apply it at checkout on your next order."
            )
        else:
            body_msg = (
                f"Your refund of ${rtn['refund_amount_nzd']:.2f} NZD is on the way "
                "and will appear within 5–10 business days."
            )
        await create_notification(
            user_id=rtn["user_id"],
            role="buyer",
            n_type="return_approved",
            title=f"Return for #{short} approved",
            body=body_msg,
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


@router.post("/returns/{return_id}/approve", response_model=ReturnRequest)
async def approve_return(
    return_id: str, body: ReturnDecision, seller=Depends(get_current_user)
):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    return await _decide_return(return_id, seller["id"], approve=True, note=body.note)


@router.post("/returns/{return_id}/reject", response_model=ReturnRequest)
async def reject_return(
    return_id: str, body: ReturnDecision, seller=Depends(get_current_user)
):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    return await _decide_return(return_id, seller["id"], approve=False, note=body.note)


# ---------------------------------------------------------------------------
# REST-friendly aliases for cross-platform clients (web project uses these).
# Same handlers as /returns/request and /returns/me — just nicer paths.
# ---------------------------------------------------------------------------
from typing import Any as _Any  # noqa: E402


@router.post("/orders/{order_id}/return", response_model=List[ReturnRequest])
async def order_return_alias(
    order_id: str,
    body: ReturnRequestCreate,
    user=Depends(get_current_user),
):
    """REST-friendly alias for POST /returns/request.

    The legacy endpoint takes order_id IN THE BODY; this version takes it from
    the URL and overrides whatever the client sent (URL wins — prevents the
    common bug of clients submitting the wrong order_id by mistake).
    """
    # Force the URL order_id into the body so the legacy handler receives it.
    if hasattr(body, "order_id"):
        body.order_id = order_id  # type: ignore[attr-defined]
    return await create_return_requests(body, user)  # type: ignore[name-defined]


@router.get("/account/returns", response_model=List[ReturnRequest])
async def account_returns_alias(user=Depends(get_current_user)):
    """REST-friendly alias for GET /returns/me."""
    return await my_returns(user)  # type: ignore[name-defined]


@router.get("/account/returns/{return_id}", response_model=ReturnRequest)
async def account_return_detail(return_id: str, user=Depends(get_current_user)):
    """Single return detail scoped to the current buyer.

    Returns docs use `user_id` as the canonical FK; we also accept `buyer_id`
    for legacy rows that may pre-date the rename.
    """
    doc = await db.returns.find_one(
        {
            "id": return_id,
            "$or": [{"user_id": user["id"]}, {"buyer_id": user["id"]}],
        },
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Return not found")
    return ReturnRequest(**doc)


# ---------------------------------------------------------------------------
# Extra REST aliases requested by the parallel web agent (June 2026).
# These all delegate to the canonical handlers above so business logic stays
# in one place.
# ---------------------------------------------------------------------------
@router.get("/returns/mine", response_model=List[ReturnRequest])
async def returns_mine_alias(user=Depends(get_current_user)):
    """Alias for GET /returns/me."""
    return await my_returns(user)  # type: ignore[name-defined]


@router.get("/me/returns", response_model=List[ReturnRequest])
async def me_returns_alias(user=Depends(get_current_user)):
    """Alias for GET /returns/me."""
    return await my_returns(user)  # type: ignore[name-defined]


@router.post("/returns", response_model=List[ReturnRequest])
async def returns_post_alias(
    body: ReturnRequestCreate, user=Depends(get_current_user)
):
    """Alias for POST /returns/request (no /request suffix)."""
    return await create_return_requests(body, user)  # type: ignore[name-defined]


@router.post("/orders/{order_id}/returns", response_model=List[ReturnRequest])
async def order_returns_plural_alias(
    order_id: str,
    body: ReturnRequestCreate,
    user=Depends(get_current_user),
):
    """Plural alias for POST /orders/{order_id}/return."""
    if hasattr(body, "order_id"):
        body.order_id = order_id  # type: ignore[attr-defined]
    return await create_return_requests(body, user)  # type: ignore[name-defined]


@router.get("/orders/{order_id}/returns", response_model=List[ReturnRequest])
async def order_returns_get_alias(
    order_id: str, user=Depends(get_current_user)
):
    """Alias for GET /returns/order/{order_id}."""
    return await returns_for_order(order_id, user)  # type: ignore[name-defined]
