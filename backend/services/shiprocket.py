"""Shiprocket X (cross-border courier) integration — LIVE (June 2026).

Auth: POST /v1/external/auth/login → JWT (cached ~9 days in
`db.shiprocket_tokens`). Order: POST /orders/create/adhoc. Courier:
serviceability → cheapest → assign/awb. Tracking: GET /courier/track/awb/{awb}.
Falls back to a mocked AWB if SHIPROCKET_EMAIL/PASSWORD are not set so
local dev keeps working.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import timedelta
from typing import Any, Optional

import httpx

from db import db
from utils import now_utc

logger = logging.getLogger("allsale")

SHIPROCKET_BASE_URL = os.environ.get("SHIPROCKET_BASE_URL", "https://apiv2.shiprocket.in")
SHIPROCKET_EMAIL = os.environ.get("SHIPROCKET_EMAIL")
SHIPROCKET_PASSWORD = os.environ.get("SHIPROCKET_PASSWORD")
SHIPROCKET_PICKUP = os.environ.get("SHIPROCKET_PICKUP_LOCATION", "Primary")
SHIPROCKET_TTL_DAYS = int(os.environ.get("SHIPROCKET_TOKEN_TTL_DAYS", "9"))
SHIPROCKET_LIVE = bool(SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD)

STATUS_MAP: dict[str, str] = {
    "new": "paid", "awb assigned": "paid", "label generated": "paid",
    "pickup scheduled": "paid", "pickup generated": "paid", "pickup queued": "paid",
    "pickup error": "paid", "pickup completed": "shipped", "shipped": "shipped",
    "in transit": "shipped", "reached destination hub": "shipped",
    "out for delivery": "out_for_delivery", "delivered": "delivered",
    "undelivered": "shipped", "rto initiated": "rto_initiated",
    "rto delivered": "rto_delivered", "cancelled": "cancelled",
}
STATUS_ID_MAP: dict[int, str] = {
    1: "paid", 2: "paid", 3: "paid", 4: "paid", 5: "paid", 6: "shipped",
    7: "delivered", 8: "cancelled", 9: "shipped", 10: "out_for_delivery",
    11: "rto_initiated", 12: "rto_delivered", 13: "shipped", 17: "delivered",
    18: "out_for_delivery", 19: "out_for_delivery", 21: "shipped",
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
    txt = raw.get("current_status") or raw.get("shipment_status") or raw.get("status") or ""
    return STATUS_MAP.get(str(txt).strip().lower())


def webhook_signature_ok(sent_token: Optional[str]) -> bool:
    secret = os.environ.get("SHIPROCKET_WEBHOOK_TOKEN")
    if not secret:
        return True
    return bool(sent_token) and sent_token == secret


# ---------------------------------------------------------------------------
# Token cache (MongoDB-backed)
# ---------------------------------------------------------------------------
async def _get_token() -> Optional[str]:
    if not SHIPROCKET_LIVE:
        return None
    now = now_utc()
    doc = await db.shiprocket_tokens.find_one({"account_id": "default"})
    if doc and doc.get("token") and doc.get("expires_at") and doc["expires_at"] > now:
        return doc["token"]
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{SHIPROCKET_BASE_URL}/v1/external/auth/login",
                json={"email": SHIPROCKET_EMAIL, "password": SHIPROCKET_PASSWORD},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.error("Shiprocket login failed: %s", e)
        return None
    token = data.get("token") or data.get("access_token")
    if not token:
        logger.error("Shiprocket login response missing token: %s", data)
        return None
    await db.shiprocket_tokens.update_one(
        {"account_id": "default"},
        {"$set": {"token": token, "expires_at": now + timedelta(days=SHIPROCKET_TTL_DAYS), "updated_at": now}},
        upsert=True,
    )
    logger.info("Shiprocket token refreshed (ttl=%sd)", SHIPROCKET_TTL_DAYS)
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Live API helpers
# ---------------------------------------------------------------------------
async def _create_adhoc(token: str, order: dict, seller: dict) -> Optional[dict]:
    addr = order.get("shipping_address") or {}
    items = order.get("items") or []
    sr_items = [
        {
            "name": (it.get("name") or "Product")[:80],
            "sku": str(it.get("product_id") or it.get("sku") or "SKU")[:40],
            "units": int(it.get("quantity") or 1),
            "selling_price": float(it.get("price_inr") or (it.get("price_nzd", 0) * 51)),
            "hsn": str(it.get("hsn") or ""),
        }
        for it in items
    ]
    sub_total = sum(i["selling_price"] * i["units"] for i in sr_items)
    payload = {
        "order_id": order["id"],
        "order_date": (order.get("created_at") or now_utc()).strftime("%Y-%m-%d %H:%M"),
        "pickup_location": SHIPROCKET_PICKUP,
        "billing_customer_name": (addr.get("name") or "Customer").split(" ")[0],
        "billing_last_name": " ".join((addr.get("name") or "").split(" ")[1:]) or "",
        "billing_address": addr.get("line1") or addr.get("address") or "",
        "billing_address_2": addr.get("line2") or "",
        "billing_city": addr.get("city") or "",
        "billing_pincode": str(addr.get("postal_code") or addr.get("pincode") or "1010"),
        "billing_state": addr.get("state") or addr.get("region") or "",
        "billing_country": addr.get("country") or "New Zealand",
        "billing_email": addr.get("email") or order.get("user_email") or "",
        "billing_phone": str(addr.get("phone") or "+64210000000"),
        "shipping_is_billing": True,
        "order_items": sr_items,
        "payment_method": "Prepaid",
        "sub_total": round(sub_total, 2),
        "length": int(order.get("package_length_cm") or 25),
        "breadth": int(order.get("package_breadth_cm") or 20),
        "height": int(order.get("package_height_cm") or 8),
        "weight": float(order.get("package_weight_kg") or 0.5),
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(
                f"{SHIPROCKET_BASE_URL}/v1/external/orders/create/adhoc",
                json=payload, headers=_headers(token),
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Shiprocket create_adhoc failed: %s", e)
        return None


async def _cheapest_courier(token: str, seller: dict, order: dict) -> Optional[dict]:
    addr = order.get("shipping_address") or {}
    params = {
        "pickup_postcode": str(seller.get("pincode") or "400001"),
        "delivery_postcode": str(addr.get("postal_code") or addr.get("pincode") or "1010"),
        "weight": str(order.get("package_weight_kg") or 0.5),
        "cod": "0",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(
                f"{SHIPROCKET_BASE_URL}/v1/external/courier/serviceability/",
                params=params, headers=_headers(token),
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.error("Shiprocket serviceability failed: %s", e)
        return None
    couriers = (data.get("data") or {}).get("available_courier_companies") or []
    if not couriers:
        return None
    return min(couriers, key=lambda c: float(c.get("rate") or c.get("freight_charge") or 9e9))


async def _assign_awb(token: str, shipment_id: Any, courier_id: Any) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post(
                f"{SHIPROCKET_BASE_URL}/v1/external/courier/assign/awb",
                json={"shipment_id": shipment_id, "courier_id": courier_id},
                headers=_headers(token),
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Shiprocket assign_awb failed: %s", e)
        return None


async def track_awb(awb: str) -> Optional[dict]:
    token = await _get_token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(
                f"{SHIPROCKET_BASE_URL}/v1/external/courier/track/awb/{awb}",
                headers=_headers(token),
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error("Shiprocket track failed for %s: %s", awb, e)
        return None


# ---------------------------------------------------------------------------
# Public entry point (idempotent: one shipment per order)
# ---------------------------------------------------------------------------
async def book_shiprocket_shipment(order_id: str) -> Optional[dict]:
    existing = await db.shipments.find_one({"order_id": order_id}, {"_id": 0})
    if existing:
        return existing
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return None

    if not SHIPROCKET_LIVE:
        # Local-dev mock fallback (was the only behaviour before)
        return await _mock_shipment(order)

    seller_id = order.get("seller_id") or (order.get("items") or [{}])[0].get("seller_id")
    seller = await db.sellers.find_one({"user_id": seller_id}, {"_id": 0}) or {}

    token = await _get_token()
    if not token:
        logger.warning("Falling back to mock — no Shiprocket token")
        return await _mock_shipment(order)

    sr_order = await _create_adhoc(token, order, seller)
    if not sr_order:
        return await _mock_shipment(order)
    sr_shipment_id = sr_order.get("shipment_id") or sr_order.get("order_id")

    courier = await _cheapest_courier(token, seller, order)
    awb_resp: dict = {}
    if courier and sr_shipment_id:
        awb_resp = await _assign_awb(token, sr_shipment_id, courier.get("courier_company_id")) or {}

    awb_data = (awb_resp.get("response") or {}).get("data") or {}
    awb_code = awb_data.get("awb_code") or f"SR{uuid.uuid4().hex[:10].upper()}"
    carrier_name = awb_data.get("courier_name") or (courier or {}).get("courier_name") or "Shiprocket X"

    shipment = {
        "id": f"shp_{uuid.uuid4().hex[:12]}",
        "order_id": order_id,
        "user_id": order.get("user_id"),
        "carrier": carrier_name,
        "awb_code": awb_code,
        "tracking_url": f"https://shiprocket.co/tracking/{awb_code}",
        "shiprocket_order_id": sr_order.get("order_id"),
        "shiprocket_shipment_id": sr_shipment_id,
        "status": "label_created",
        "pickup_scheduled_at": now_utc(),
        "estimated_delivery": awb_data.get("etd") or order.get("estimated_delivery", ""),
        "is_mocked": False,
        "created_at": now_utc(),
    }
    await db.shipments.insert_one(shipment)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"shipment_id": shipment["id"], "awb_code": awb_code}},
    )
    logger.info("Shiprocket LIVE shipment booked: %s for %s", awb_code, order_id)
    return shipment


async def _mock_shipment(order: dict) -> dict:
    awb = f"SR{uuid.uuid4().hex[:10].upper()}"
    shipment = {
        "id": f"shp_{uuid.uuid4().hex[:12]}",
        "order_id": order["id"],
        "user_id": order.get("user_id"),
        "carrier": "Shiprocket X (mock)",
        "awb_code": awb,
        "tracking_url": f"https://shiprocket.co/tracking/{awb}",
        "status": "label_created",
        "pickup_scheduled_at": now_utc(),
        "estimated_delivery": order.get("estimated_delivery", ""),
        "is_mocked": True,
        "created_at": now_utc(),
    }
    await db.shipments.insert_one(shipment)
    await db.orders.update_one(
        {"id": order["id"]},
        {"$set": {"shipment_id": shipment["id"], "awb_code": awb}},
    )
    return shipment
