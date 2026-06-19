"""Shiprocket webhook + buyer-facing shipment lookup."""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from config import PAYOUT_HOLD_DAYS_AFTER_DELIVERY, RETURN_WINDOW_DAYS
from db import db
from deps import get_current_user
from models import Shipment
from services.notifications import create_notification
from services.b2b_referrals import accrue_referral_commission
from services.shipment_milestones import detect_milestone
from services.shiprocket import (
    map_shiprocket_status,
    webhook_signature_ok,
)
from utils import now_utc

logger = logging.getLogger("allsale")
router = APIRouter(tags=["shiprocket"])


@router.post("/shiprocket/webhook")
async def shiprocket_webhook(
    request: Request,
    x_api_key: Annotated[Optional[str], Header()] = None,
):
    """Receive shipment status updates from Shiprocket. Idempotent."""
    raw = await request.body()
    if not webhook_signature_ok(x_api_key):
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

    mapped = map_shiprocket_status(payload)
    if not mapped:
        logger.info(
            "shiprocket webhook unknown status: %s", payload.get("current_status")
        )
        return {"received": True, "awb": awb, "ignored": True}

    shipment = await db.shipments.find_one({"awb_code": awb}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found for awb")

    order = await db.orders.find_one({"id": shipment["order_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    current = order.get("status")
    if current in {"cancelled", "refunded", "delivered"}:
        return {"received": True, "awb": awb, "noop": True, "status": current}

    new_order_status = mapped
    if mapped == "paid" and current == "paid":
        new_order_status = "paid"

    update_ts: dict = {
        "status": new_order_status,
        "tracking_status": payload.get("current_status") or payload.get("shipment_status"),
        "last_tracking_update": now_utc(),
    }
    # Capture latest scan location for snappy UI display without joins.
    loc = payload.get("current_location") or payload.get("location")
    if loc:
        update_ts["last_tracking_location"] = loc
    # Stage transition timestamps power the tracking timeline UI.
    if mapped == "shipped" and not order.get("shipped_at"):
        update_ts["shipped_at"] = now_utc()
    if mapped == "out_for_delivery" and not order.get("out_for_delivery_at"):
        update_ts["out_for_delivery_at"] = now_utc()
    if mapped == "delivered":
        update_ts["delivered_at"] = now_utc()
        update_ts["return_window_until"] = now_utc() + timedelta(days=RETURN_WINDOW_DAYS)
        update_ts["payout_release_at"] = now_utc() + timedelta(
            days=PAYOUT_HOLD_DAYS_AFTER_DELIVERY
        )
        # Carrier-provided proof of delivery (Shiprocket pod_url / proof_image_url)
        pod = (
            payload.get("pod_url")
            or payload.get("proof_image_url")
            or payload.get("delivery_image_url")
        )
        if pod and not order.get("proof_of_delivery"):
            update_ts["proof_of_delivery"] = {
                "image": pod,
                "note": payload.get("delivery_note") or "Delivered by courier",
                "uploaded_by": "carrier",
                "uploaded_at": now_utc(),
            }
    await db.orders.update_one({"id": order["id"]}, {"$set": update_ts})

    # Accrue B2B referral commission once an order is confirmed delivered.
    if mapped == "delivered":
        try:
            fresh_order = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
            await accrue_referral_commission(fresh_order or order)
        except Exception:
            # Never let referral accrual break the webhook.
            pass

    # Schedule tier-aware payout release on delivery; void on RTO/refund.
    try:
        if mapped == "delivered":
            from services.payouts import mark_delivered
            await mark_delivered(order["id"])
        elif mapped in {"rto_delivered", "refunded", "cancelled"}:
            from services.payouts import cancel_payouts
            await cancel_payouts(order["id"], reason=mapped)
    except Exception:  # pragma: no cover — non-fatal
        pass

    await db.shipments.update_one(
        {"awb_code": awb},
        {
            "$set": {
                "status": mapped,
                "carrier_status_raw": payload.get("current_status")
                or payload.get("shipment_status"),
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

    # ------------------------------------------------------------------
    # Phase 1.5 #4 — fire one-time in-transit milestones (e.g. arrived in
    # destination country, customs cleared) so buyers see meaningful nudges
    # in the bell drawer even when the overall order status hasn't flipped.
    # ------------------------------------------------------------------
    try:
        # Re-read because we just appended an event above.
        fresh = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
        milestone = detect_milestone(
            event_status=payload.get("current_status") or payload.get("shipment_status"),
            event_location=payload.get("current_location") or payload.get("location"),
            event_remark=payload.get("scan_remark") or payload.get("activity"),
            order=fresh or order,
        )
        if milestone:
            await create_notification(
                user_id=order["user_id"],
                role="buyer",
                n_type=f"shipment_milestone_{milestone['key']}",
                title=milestone["title"],
                body=milestone["body"],
                order_id=order["id"],
            )
            await db.orders.update_one(
                {"id": order["id"]},
                {"$addToSet": {"milestones_notified": milestone["key"]}},
            )
    except Exception:
        # Milestone notifications are a UX nicety — never break the webhook.
        pass

    return {
        "received": True,
        "awb": awb,
        "order_id": order["id"],
        "order_status": new_order_status,
    }


@router.get("/orders/{order_id}/shipment", response_model=Optional[Shipment])
async def get_order_shipment(order_id: str, current=Depends(get_current_user)):
    """Return shipment info for an order owned by the current user."""
    order = await db.orders.find_one(
        {"id": order_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    shp = await db.shipments.find_one({"order_id": order_id}, {"_id": 0})
    if not shp:
        return None
    return Shipment(
        id=shp["id"],
        order_id=shp["order_id"],
        carrier=shp.get("carrier", "Shiprocket X"),
        awb_code=shp["awb_code"],
        tracking_url=shp.get(
            "tracking_url", f"https://shiprocket.co/tracking/{shp['awb_code']}"
        ),
        status=shp.get("status", "label_created"),
        estimated_delivery=shp.get(
            "estimated_delivery", order.get("estimated_delivery", "")
        ),
        is_mocked=bool(shp.get("is_mocked", False)),
    )
