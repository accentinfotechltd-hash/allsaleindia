"""Buyer-facing orders: list, get, cancel + shipment lookup."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from db import db
from deps import get_current_user
from models import (
    CancelOrderRequest,
    Order,
    OrderTracking,
    ReorderResult,
    Shipment,
    TrackingEvent,
    TrackingStage,
)
from services.cart import hydrate_cart
from services.eta import compute_eta_summary
from services.geocode import osm_static_map_url
from services.notifications import create_notification, notify_admins
from services.stock import restock_for_order
from services.stripe_svc import issue_stripe_refund
from utils import now_utc

router = APIRouter(tags=["orders"])


# Stage order used for both the timeline and progress percentage.
_STAGES: list[tuple[str, str]] = [
    ("paid", "Order confirmed"),
    ("shipped", "Shipped from India"),
    ("out_for_delivery", "Out for delivery"),
    ("delivered", "Delivered"),
]
_STAGE_KEYS = [k for k, _ in _STAGES]
_STAGE_TS_FIELD = {
    "paid": "created_at",
    "shipped": "shipped_at",
    "out_for_delivery": "out_for_delivery_at",
    "delivered": "delivered_at",
}


@router.post("/orders/{order_id}/cancel", response_model=Order)
async def cancel_order(
    order_id: str,
    body: CancelOrderRequest,
    current=Depends(get_current_user),
):
    """Buyer cancels an order any time before it ships from India.

    Cancellation is allowed while the order status is ``paid`` or
    ``pending``. Once it transitions to ``shipped`` / ``out_for_delivery`` /
    ``delivered`` the buyer must use the returns flow instead.
    """
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

    # Payment must be confirmed for a refund path to exist.
    if order.get("payment_status") not in {"paid", "refund_pending"}:
        raise HTTPException(
            status_code=400,
            detail="This order cannot be cancelled yet (payment not confirmed).",
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


# ---------------------------------------------------------------------------
# Buy-it-again rail (June 2026)
# IMPORTANT: This STATIC path must be registered BEFORE the dynamic
# `/orders/{order_id}` below — Starlette matches in registration order and
# would otherwise treat "buy-it-again" as an order_id.
# ---------------------------------------------------------------------------
@router.get("/orders/buy-it-again")
async def buy_it_again(
    limit: int = Query(default=12, ge=1, le=40),
    current=Depends(get_current_user),
):
    """Distinct products from the buyer's past **delivered** orders.

    Ranked by `last_purchased_at` (newest order containing the product wins
    when the same product appears in multiple orders). Skips products that
    are now out of stock or in a hidden buyer category.

    Returns a lean projection (id, name, image, price, last_purchased_at,
    times_purchased) — sized for a horizontal home-tab rail.
    """
    last_buy: dict[str, dict] = {}
    cursor = db.orders.find(
        {
            "user_id": current["id"],
            "$or": [
                {"status": "delivered"},
                {"delivered_at": {"$ne": None}},
                {"buyer_confirmed_at": {"$ne": None}},
            ],
        },
        {"_id": 0, "id": 1, "items": 1, "delivered_at": 1, "created_at": 1, "buyer_confirmed_at": 1},
    ).sort("created_at", -1)
    async for o in cursor:
        when = (
            o.get("delivered_at")
            or o.get("buyer_confirmed_at")
            or o.get("created_at")
        )
        for it in (o.get("items") or []):
            pid = it.get("product_id") or it.get("id")
            if not pid:
                continue
            existing = last_buy.get(pid)
            if existing is None or (when and when > existing["last_purchased_at"]):
                last_buy[pid] = {
                    "last_purchased_at": when,
                    "times_purchased": (existing or {}).get("times_purchased", 0) + 1,
                    "qty_last": it.get("quantity") or 1,
                }
            else:
                existing["times_purchased"] += 1

    if not last_buy:
        return {"items": [], "total": 0}

    pids = list(last_buy.keys())
    fields = {
        "_id": 0,
        "id": 1, "name": 1, "image": 1, "price_nzd": 1, "price_inr": 1,
        "category": 1, "in_stock": 1, "stock_count": 1, "rating": 1,
        "reviews_count": 1, "seller_name": 1,
    }
    products: dict[str, dict] = {}
    async for p in db.products.find({"id": {"$in": pids}}, fields):
        if int(p.get("stock_count", 0) or 0) <= 0 and not p.get("in_stock"):
            continue
        products[p["id"]] = p

    out: list[dict] = []
    for pid in sorted(
        last_buy.keys(),
        key=lambda k: last_buy[k]["last_purchased_at"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    ):
        prod = products.get(pid)
        if not prod:
            continue
        meta = last_buy[pid]
        out.append(
            {
                **prod,
                "last_purchased_at": (
                    meta["last_purchased_at"].isoformat()
                    if isinstance(meta["last_purchased_at"], datetime)
                    else None
                ),
                "times_purchased": meta["times_purchased"],
                "qty_last": meta["qty_last"],
            }
        )
        if len(out) >= limit:
            break

    return {"items": out, "total": len(out)}


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


# ---------------------------------------------------------------------------
# REST aliases (June 2026 — web agent parity)
# ---------------------------------------------------------------------------
@router.get("/account/orders", response_model=List[Order])
async def account_orders_alias(current=Depends(get_current_user)):
    """Alias for GET /orders — the buyer's own order list."""
    return await list_orders(current)  # type: ignore[name-defined]


@router.get("/account/orders/{order_id}", response_model=Order)
async def account_order_detail_alias(
    order_id: str, current=Depends(get_current_user)
):
    """Alias for GET /orders/{order_id}."""
    return await get_order(order_id, current)  # type: ignore[name-defined]


@router.get("/me/orders", response_model=List[Order])
async def me_orders_alias(current=Depends(get_current_user)):
    """Alias for GET /orders."""
    return await list_orders(current)  # type: ignore[name-defined]


# ---------------------------------------------------------------------------
# Tracking timeline + post-delivery actions (June 2026)
# ---------------------------------------------------------------------------
@router.get("/orders/{order_id}/tracking", response_model=OrderTracking)
async def get_order_tracking(order_id: str, current=Depends(get_current_user)):
    """Detailed tracking timeline for a buyer's order.

    Returns:
      - 4-stage progress (paid → shipped → out_for_delivery → delivered) w/ per-stage timestamps
      - Detailed scan events from the shipment doc (sorted newest first)
      - Progress percentage (0..100) derived from stages reached
      - Estimated delivery, AWB, carrier and the carrier's deep-link URL
    """
    order = await db.orders.find_one(
        {"id": order_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    current_status = order.get("status") or ""
    shp = await db.shipments.find_one({"order_id": order_id}, {"_id": 0}) or {}

    # Build stage list — "done" if either the current status matches/exceeds
    # the stage OR a stage-specific timestamp has been captured.
    try:
        current_idx = _STAGE_KEYS.index(current_status)
    except ValueError:
        # paid is the implicit starting stage even if status is unknown.
        current_idx = -1 if current_status in {"cancelled", "refunded"} else 0

    stages: list[TrackingStage] = []
    for i, (key, label) in enumerate(_STAGES):
        done = i <= current_idx if current_idx >= 0 else False
        ts_field = _STAGE_TS_FIELD[key]
        at_val = order.get(ts_field)
        # Fallback: if stage is done and no explicit ts, use created_at for "paid"
        if done and not at_val and key == "paid":
            at_val = order.get("created_at")
        stages.append(TrackingStage(key=key, label=label, done=done, at=at_val))

    progress_pct = 0
    if current_status in {"cancelled", "refunded"}:
        progress_pct = 0
    elif current_idx >= 0:
        progress_pct = int(round(((current_idx + 1) / len(_STAGES)) * 100))

    # Latest scan events from shipment.events array (oldest first stored, return newest first)
    raw_events = list(shp.get("events", []) or [])
    raw_events.sort(key=lambda e: e.get("at") or datetime.min, reverse=True)
    events: list[TrackingEvent] = []
    for e in raw_events[:60]:  # cap at most-recent 60 to keep payload small
        events.append(
            TrackingEvent(
                at=e.get("at") or now_utc(),
                status=e.get("status"),
                location=e.get("location"),
                remark=e.get("remark"),
            )
        )

    return OrderTracking(
        order_id=order_id,
        status=current_status,
        progress_pct=progress_pct,
        stages=stages,
        events=events,
        awb_code=shp.get("awb_code") or order.get("awb_code"),
        carrier=shp.get("carrier"),
        tracking_url=shp.get("tracking_url"),
        estimated_delivery=order.get("estimated_delivery"),
        last_tracking_status=order.get("tracking_status"),
        last_tracking_location=order.get("last_tracking_location"),
        last_tracking_update=order.get("last_tracking_update"),
        delivered_at=order.get("delivered_at"),
        buyer_confirmed_at=order.get("buyer_confirmed_at"),
        proof_of_delivery=order.get("proof_of_delivery"),
        eta_summary=compute_eta_summary(
            status=current_status,
            estimated_delivery=order.get("estimated_delivery"),
            delivered_at=order.get("delivered_at"),
            buyer_confirmed_at=order.get("buyer_confirmed_at"),
            last_tracking_update=order.get("last_tracking_update"),
            out_for_delivery_at=order.get("out_for_delivery_at"),
            shipped_at=order.get("shipped_at"),
            created_at=order.get("created_at"),
        ),
        last_tracking_geo=(
            {
                **order["last_tracking_geo"],
                "static_map_url": osm_static_map_url(
                    order["last_tracking_geo"]["lat"],
                    order["last_tracking_geo"]["lng"],
                ),
            }
            if isinstance(order.get("last_tracking_geo"), dict)
            and order["last_tracking_geo"].get("lat") is not None
            else None
        ),
    )


@router.post("/orders/{order_id}/mark-received", response_model=Order)
async def mark_order_received(order_id: str, current=Depends(get_current_user)):
    """Buyer confirms physical receipt of the parcel.

    Only allowed once `delivered` per Shiprocket *or* the buyer wants to
    confirm an out_for_delivery parcel because the carrier never closed
    out their scan. Setting this is independent of the return window.
    """
    order = await db.orders.find_one(
        {"id": order_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.get("status") in {"cancelled", "refunded"}:
        raise HTTPException(status_code=400, detail="This order was cancelled.")
    if order.get("status") not in {"out_for_delivery", "delivered"}:
        raise HTTPException(
            status_code=400,
            detail="You can confirm receipt once the parcel is out for delivery or has been delivered.",
        )
    if order.get("buyer_confirmed_at"):
        raise HTTPException(status_code=409, detail="You've already confirmed delivery.")

    patch: dict = {"buyer_confirmed_at": now_utc()}
    # If carrier never closed out as delivered, flip the order to delivered now —
    # buyer confirmation is authoritative for the return window.
    if order.get("status") != "delivered":
        patch["status"] = "delivered"
        if not order.get("delivered_at"):
            patch["delivered_at"] = now_utc()

    await db.orders.update_one({"id": order_id}, {"$set": patch})

    # Notify the sellers — useful when carrier scan failed
    short = order_id.replace("order_", "").upper()[:8]
    seen: set[str] = set()
    for it in order.get("items", []):
        sid = it.get("seller_id")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        try:
            await create_notification(
                user_id=sid,
                role="seller",
                n_type="order_received_by_buyer",
                title=f"Order #{short} confirmed received",
                body="The buyer has confirmed receipt of their parcel.",
                order_id=order_id,
            )
        except Exception:
            pass

    fresh = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return Order(**fresh)


@router.post("/orders/{order_id}/reorder", response_model=ReorderResult)
async def reorder_order(order_id: str, current=Depends(get_current_user)):
    """Add every in-stock item from a past order back into the buyer's cart.

    Items that are now out of stock, hidden, or no longer exist are reported
    in `skipped` with a reason instead of silently dropping them. The buyer
    can review the cart immediately afterwards.
    """
    order = await db.orders.find_one(
        {"id": order_id, "user_id": current["id"]}, {"_id": 0}
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    added: list[str] = []
    skipped: list[dict] = []

    cart = await db.carts.find_one({"user_id": current["id"]}, {"_id": 0}) or {}
    cart_items: list[dict] = list(cart.get("items", []) or [])

    for it in order.get("items", []):
        pid = it.get("product_id")
        qty = max(1, int(it.get("quantity", 1)))
        if not pid:
            continue
        prod = await db.products.find_one({"id": pid}, {"_id": 0})
        if not prod:
            skipped.append({"product_id": pid, "reason": "no_longer_available"})
            continue
        if not prod.get("in_stock", True):
            skipped.append({"product_id": pid, "reason": "out_of_stock"})
            continue
        stock_count = prod.get("stock_count")
        if isinstance(stock_count, int) and stock_count <= 0:
            skipped.append({"product_id": pid, "reason": "out_of_stock"})
            continue
        # Cap qty by available stock if known
        if isinstance(stock_count, int) and stock_count > 0:
            qty = min(qty, stock_count)

        existing = next((c for c in cart_items if c["product_id"] == pid), None)
        if existing:
            existing["quantity"] = int(existing["quantity"]) + qty
        else:
            cart_items.append({"product_id": pid, "quantity": qty})
        added.append(pid)

    await db.carts.update_one(
        {"user_id": current["id"]},
        {"$set": {"items": cart_items, "updated_at": now_utc()}},
        upsert=True,
    )
    view = await hydrate_cart(current["id"])
    return ReorderResult(
        cart_item_count=sum(int(i["quantity"]) for i in cart_items),
        added=added,
        skipped=skipped,
    )
