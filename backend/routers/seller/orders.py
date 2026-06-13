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


@router.get("/seller/payouts", response_model=SellerPayoutSummary)
async def list_seller_payouts(seller=Depends(get_current_user)):
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    cursor = (
        db.payouts.find({"seller_id": seller["id"]}, {"_id": 0})
        .sort("created_at", -1)
    )
    payouts = [Payout(**p) async for p in cursor]
    pending = round(
        sum(p.net_payable_nzd for p in payouts if p.status == "pending"), 2
    )
    paid_out = round(
        sum(p.net_payable_nzd for p in payouts if p.status == "paid_out"), 2
    )
    return SellerPayoutSummary(
        payouts=payouts,
        lifetime_earnings_nzd=round(pending + paid_out, 2),
        pending_nzd=pending,
        paid_out_nzd=paid_out,
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
