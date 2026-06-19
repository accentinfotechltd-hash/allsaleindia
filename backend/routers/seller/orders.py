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
    ProofOfDelivery,
    ProofOfDeliveryUploadRequest,
    SellerOrder,
    SellerOrderItem,
    SellerPayoutSummary,
)
from services.notifications import create_notification
from services.seller_tier import get_seller_tier_snapshot
from utils import now_utc

router = APIRouter(tags=["seller"])


# ---------------------------------------------------------------------------
# Proof of delivery upload (Phase 1.5)
# ---------------------------------------------------------------------------
@router.post(
    "/seller/orders/{order_id}/proof-of-delivery",
    response_model=ProofOfDelivery,
)
async def upload_proof_of_delivery(
    order_id: str,
    body: ProofOfDeliveryUploadRequest,
    seller=Depends(get_current_user),
):
    """Seller uploads a photo as proof that the parcel was delivered.

    Allowed when:
      * the seller owns at least one item in the order
      * status is `out_for_delivery` or `delivered`
      * a carrier `pod_url` hasn't already been captured (carrier wins by default)

    Triggers a buyer notification + email via Resend.
    """
    if not seller.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    owned = any(
        it.get("seller_id") == seller["id"] for it in order.get("items", []) or []
    )
    if not owned:
        raise HTTPException(status_code=403, detail="This order isn't yours")

    if order.get("status") not in {"out_for_delivery", "delivered"}:
        raise HTTPException(
            status_code=400,
            detail="Proof of delivery can only be added once the parcel is out for delivery or delivered.",
        )

    existing = order.get("proof_of_delivery") or {}
    if existing and existing.get("uploaded_by") == "carrier":
        raise HTTPException(
            status_code=409,
            detail="Carrier already provided proof of delivery for this order.",
        )

    # Basic shape validation — accept data URI or HTTPS URL only
    img = body.image.strip()
    if not (img.startswith("data:image/") or img.startswith("https://")):
        raise HTTPException(
            status_code=400,
            detail="Image must be a base64 data URI (data:image/jpeg;base64,…) or an HTTPS URL.",
        )

    proof = {
        "image": img,
        "note": (body.note or "").strip() or None,
        "uploaded_by": "seller",
        "uploaded_at": now_utc(),
    }
    patch: dict = {"proof_of_delivery": proof}
    # If status was still OFD, advance to delivered now that seller confirms drop-off.
    if order.get("status") == "out_for_delivery":
        patch["status"] = "delivered"
        if not order.get("delivered_at"):
            patch["delivered_at"] = now_utc()
    await db.orders.update_one({"id": order_id}, {"$set": patch})

    # In-app notification for buyer
    short = order_id.replace("order_", "").upper()[:8]
    try:
        await create_notification(
            user_id=order["user_id"],
            role="buyer",
            n_type="proof_of_delivery_uploaded",
            title=f"Delivery confirmed on order #{short}",
            body="Your seller has shared a delivery photo. Open your order to view.",
            order_id=order_id,
        )
    except Exception:
        pass

    # Email via Resend (best-effort, async-safe)
    try:
        from services.email import send_email

        buyer = await db.users.find_one(
            {"id": order["user_id"]}, {"_id": 0, "email": 1, "full_name": 1}
        )
        if buyer and buyer.get("email"):
            buyer_name = (buyer.get("full_name") or "there").split(" ")[0]
            note_block = (
                f'<p style="margin:8px 0;color:#475569"><em>Note from seller:</em> {proof["note"]}</p>'
                if proof["note"]
                else ""
            )
            html = f"""
            <div style="font-family:system-ui,Helvetica,Arial,sans-serif;padding:24px;max-width:540px;margin:0 auto;color:#0f172a">
              <h2 style="margin:0 0 12px">Hi {buyer_name}, your order has been delivered ✅</h2>
              <p style="margin:0 0 16px;color:#475569">
                Order <strong>#{short}</strong> has been delivered. The seller has shared a delivery photo as proof of receipt.
              </p>
              {note_block}
              <p style="margin:16px 0 8px"><a href="https://shop.allsale.co.nz/order/{order_id}" style="background:#FF6B35;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">View delivery proof</a></p>
              <p style="margin-top:24px;font-size:12px;color:#94a3b8">If anything's wrong with your delivery, you have 7 days to start a return from your order page.</p>
            </div>
            """
            send_email(
                to=buyer["email"],
                subject=f"Delivery confirmed — Order #{short}",
                html=html,
                text=(
                    f"Hi {buyer_name}, your Allsale order #{short} has been delivered. "
                    "Open the app to view the delivery photo. "
                    "You have 7 days from delivery to request a return if needed."
                ),
            )
    except Exception:
        pass  # never let email failures break the seller flow

    return ProofOfDelivery(**proof)


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
                proof_of_delivery=order.get("proof_of_delivery"),
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
