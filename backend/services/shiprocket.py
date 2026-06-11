"""Shiprocket X (cross-border courier) integration — currently MOCKED."""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from db import db
from utils import now_utc

logger = logging.getLogger("allsale")

SHIPROCKET_LIVE = bool(
    os.environ.get("SHIPROCKET_EMAIL") and os.environ.get("SHIPROCKET_PASSWORD")
)


# Shiprocket → Allsale order-status mapping.
STATUS_MAP: dict[str, str] = {
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

STATUS_ID_MAP: dict[int, str] = {
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


def map_shiprocket_status(raw: dict) -> Optional[str]:
    sid = raw.get("current_status_id") or raw.get("status_id")
    if isinstance(sid, (int, str)):
        try:
            mapped = STATUS_ID_MAP.get(int(sid))
            if mapped:
                return mapped
        except (TypeError, ValueError):
            pass
    txt = (
        raw.get("current_status")
        or raw.get("shipment_status")
        or raw.get("status")
        or ""
    )
    return STATUS_MAP.get(str(txt).strip().lower())


def webhook_signature_ok(sent_token: Optional[str]) -> bool:
    """Optional shared-secret verification.

    If ``SHIPROCKET_WEBHOOK_TOKEN`` is configured in env, the webhook MUST send
    it back as the ``X-Api-Key`` header. When unset (e.g. local dev) we accept
    everything so mocked payloads still work.
    """
    secret = os.environ.get("SHIPROCKET_WEBHOOK_TOKEN")
    if not secret:
        return True
    return bool(sent_token) and sent_token == secret


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
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"shipment_id": shipment["id"], "awb_code": awb}},
    )
    logger.info(
        "shipment label created %s for %s (mocked=%s)",
        awb,
        order_id,
        not SHIPROCKET_LIVE,
    )
    return shipment
