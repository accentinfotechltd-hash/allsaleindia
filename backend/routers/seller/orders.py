"""Seller orders & payouts: list per-seller order slices, payout summary, CSV export."""
from __future__ import annotations

import csv
import io
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from db import db
from deps import get_current_user
from models import (
    Payout,
    SellerOrder,
    SellerOrderItem,
    SellerPayoutSummary,
)
from services.seller_tier import get_seller_tier_snapshot

router = APIRouter(tags=["seller"])


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
            it
            for it in order.get("items", [])
            if it.get("seller_id") == seller["id"]
        ]
        if not my_items:
            continue
        subtotal = round(
            sum(it["price_nzd"] * it["quantity"] for it in my_items), 2
        )
        addr = order.get("address") or {}
        out.append(
            SellerOrder(
                order_id=order["id"],
                buyer_name=addr.get("full_name", "Customer"),
                buyer_city=addr.get("city", ""),
                buyer_region=addr.get("region", ""),
                items=[
                    SellerOrderItem(
                        **{
                            k: it[k]
                            for k in (
                                "product_id",
                                "name",
                                "image",
                                "price_nzd",
                                "quantity",
                            )
                        }
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


@router.get("/seller/tier")
async def get_my_tier(seller=Depends(get_current_user)):
    """Current reputation tier, metrics & progress toward the next tier."""
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    return await get_seller_tier_snapshot(seller["id"])


@router.get("/seller/payouts", response_model=SellerPayoutSummary)
async def list_seller_payouts(seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = (
        db.payouts.find({"seller_id": seller["id"]}, {"_id": 0})
        .sort("created_at", -1)
    )
    payouts: list[Payout] = []
    held = 0.0
    available = 0.0
    reserve_held = 0.0
    paid_out = 0.0
    next_release_at = None
    async for raw in cursor:
        # Backward-compat: migrate `pending` → `held` on the fly for display
        if raw.get("status") == "pending":
            raw["status"] = "held"
        if "tier" not in raw:
            raw["tier"] = None
        if "reserve_nzd" not in raw:
            raw["reserve_nzd"] = 0.0
        po = Payout(**raw)
        payouts.append(po)
        amt = po.net_payable_nzd
        if po.status == "held":
            held += amt
            if po.release_at and (
                next_release_at is None or po.release_at < next_release_at
            ):
                next_release_at = po.release_at
        elif po.status == "available":
            available += amt - po.reserve_nzd  # reserve part is already counted
            reserve_held += 0  # reserve already released in available
        elif po.status == "reserve_held":
            available += amt - po.reserve_nzd
            reserve_held += po.reserve_nzd
        elif po.status == "paid_out":
            paid_out += amt
        # cancelled — exclude
    pending_legacy = round(held + reserve_held + available, 2)
    tier_snapshot = await get_seller_tier_snapshot(seller["id"])
    return SellerPayoutSummary(
        payouts=payouts,
        lifetime_earnings_nzd=round(pending_legacy + paid_out, 2),
        pending_nzd=pending_legacy,
        paid_out_nzd=round(paid_out, 2),
        held_nzd=round(held, 2),
        available_nzd=round(available, 2),
        reserve_held_nzd=round(reserve_held, 2),
        next_release_at=next_release_at,
        tier=tier_snapshot["tier"]["name"],
    )


@router.get("/seller/orders.csv")
async def export_seller_orders_csv(seller=Depends(get_current_user)):
    """Stream a CSV of this seller's orders (one row per item).

    Columns: order_id, created_at, buyer_name, buyer_city, buyer_region,
    product_id, product_name, quantity, unit_price_nzd, item_subtotal_nzd,
    order_status, awb_code.
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")

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
            created.isoformat()
            if hasattr(created, "isoformat")
            else str(created or "")
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
