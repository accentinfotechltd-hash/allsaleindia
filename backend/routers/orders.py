"""Buyer-facing orders: list, get, cancel + shipment lookup."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from db import db
from deps import get_current_user
from models import (
    CancelOrderRequest,
    Order,
    Shipment,
)
from services.notifications import create_notification, notify_admins
from services.stock import restock_for_order
from services.stripe_svc import issue_stripe_refund
from utils import now_utc

router = APIRouter(tags=["orders"])


@router.post("/orders/{order_id}/cancel", response_model=Order)
async def cancel_order(
    order_id: str,
    body: CancelOrderRequest,
    current=Depends(get_current_user),
):
    """Buyer cancels an order within the 12-hour window."""
    order = await db.orders.find_one(
        {"id": order_id, "user_id": current["id"]}, {"_id": 0}
    )
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
        raise HTTPException(
            status_code=400,
            detail="This order cannot be cancelled yet (payment not confirmed).",
        )
    if isinstance(cancellable_until, datetime) and cancellable_until.tzinfo is None:
        cancellable_until = cancellable_until.replace(tzinfo=timezone.utc)
    if now_utc() > cancellable_until:
        raise HTTPException(
            status_code=400,
            detail="The 12-hour cancellation window has passed. Please request a return after delivery.",
        )

    refund_id, refund_amount = await issue_stripe_refund(order)

    await db.payouts.update_many(
        {"order_id": order_id, "status": "pending"},
        {"$set": {"status": "void", "voided_at": now_utc()}},
    )

    await restock_for_order(order_id)

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


@router.get("/orders", response_model=List[Order])
async def list_orders(current=Depends(get_current_user)):
    cursor = db.orders.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1)
    return [Order(**o) async for o in cursor]


@router.get("/orders/{order_id}", response_model=Order)
async def get_order(order_id: str, current=Depends(get_current_user)):
    o = await db.orders.find_one({"id": order_id, "user_id": current["id"]}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    return Order(**o)


@router.get("/shipments/{order_id}", response_model=Shipment)
async def get_shipment(order_id: str, current=Depends(get_current_user)):
    o = await db.orders.find_one({"id": order_id, "user_id": current["id"]}, {"_id": 0})
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    s = await db.shipments.find_one({"order_id": order_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Shipment not yet created")
    return Shipment(**{k: s[k] for k in Shipment.model_fields.keys() if k in s})
