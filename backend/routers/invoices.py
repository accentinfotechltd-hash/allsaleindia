"""Buyer order invoice — PDF generation.

  GET /api/orders/{order_id}/invoice.pdf   → application/pdf stream
  GET /api/orders/{order_id}/invoice       → JSON preview (same data, debug)

Generates a clean A4 PDF receipt the buyer can save for their records.
Uses ReportLab (pure-python, no system deps).  Numbers honour the buyer's
local currency where it was charged — falls back to NZD totals otherwise.

Notes:
  • Auth required — only the buyer who placed the order, or any admin, can
    download the invoice.
  • Commission breakdown is INTENTIONALLY omitted from the buyer-facing
    invoice (that's seller/internal data); only gross totals + tax stub
    are shown to the buyer.
  • Returns 404 for non-existent or unpaid orders so we never issue an
    invoice for an order that wasn't actually charged.
"""
from __future__ import annotations

import io
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from reportlab.lib import colors as rl_colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from db import db
from deps import get_current_user

logger = logging.getLogger("allsale.invoices")
router = APIRouter(tags=["invoices"])

PURPLE = rl_colors.HexColor("#7c3aed")
SOFT_GREY = rl_colors.HexColor("#64748b")
HAIRLINE = rl_colors.HexColor("#e2e8f0")
BG_TINT = rl_colors.HexColor("#f8fafc")


# ---------------------------------------------------------------------------
# Auth + lookup helper
# ---------------------------------------------------------------------------
async def _fetch_order_for_invoice(order_id: str, user: dict) -> dict:
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Authorisation: buyer who placed it, OR any admin
    is_admin = bool(user.get("is_admin")) or bool(user.get("admin_role"))
    if not is_admin and order.get("user_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Not your order")

    # Only paid orders get an invoice — otherwise we'd be issuing a receipt
    # for an unpaid cart, which is fraud-bait.
    if order.get("payment_status") != "paid" and order.get("status") not in {
        "paid", "confirmed", "shipped", "delivered", "completed",
    }:
        raise HTTPException(
            status_code=400,
            detail="Invoice is only available once payment has cleared.",
        )
    return order


def _short_id(order_id: str) -> str:
    return order_id.replace("order_", "")[:10].upper()


def _format_money(amount: float, currency: str = "NZD") -> str:
    cur = (currency or "NZD").upper()
    return f"{cur} {float(amount or 0):,.2f}"


def _safe(value: Any, default: str = "—") -> str:
    if value is None or value == "":
        return default
    return str(value)


# ---------------------------------------------------------------------------
# JSON preview (debug + future web rendering)
# ---------------------------------------------------------------------------
@router.get("/orders/{order_id}/invoice")
async def invoice_json(order_id: str, current=Depends(get_current_user)):
    order = await _fetch_order_for_invoice(order_id, current)
    return {
        "order_id": order["id"],
        "short_id": _short_id(order["id"]),
        "issued_at": datetime.utcnow().isoformat() + "Z",
        "buyer": {
            "name": (order.get("address") or {}).get("full_name"),
            "email": current.get("email"),
            "country": order.get("buyer_country"),
        },
        "address": order.get("address") or {},
        "items": [
            {
                "name": it.get("name") or it.get("product_name"),
                "quantity": it.get("quantity"),
                "price_nzd": it.get("price_nzd"),
                "seller_name": it.get("seller_name"),
            }
            for it in (order.get("items") or [])
        ],
        "subtotal_nzd": order.get("subtotal_nzd"),
        "shipping_nzd": order.get("shipping_nzd"),
        "discount_nzd": order.get("discount_nzd"),
        "points_discount_nzd": order.get("points_discount_nzd"),
        "total_nzd": order.get("total_nzd"),
        "charge_amount": order.get("charge_amount"),
        "buyer_currency": order.get("buyer_currency") or "NZD",
        "paid_at": order.get("paid_at"),
        "estimated_delivery": order.get("estimated_delivery"),
        "shipping_courier_name": order.get("shipping_courier_name"),
    }


# ---------------------------------------------------------------------------
# PDF generator
# ---------------------------------------------------------------------------
def _build_pdf_bytes(order: dict, buyer_email: str | None) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Allsale invoice {_short_id(order['id'])}",
        author="Allsale Ltd",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "h1", parent=styles["Heading1"], fontSize=22, textColor=PURPLE,
        spaceAfter=2, leading=24,
    )
    body = ParagraphStyle(
        "body", parent=styles["BodyText"], fontSize=10, leading=14,
        textColor=rl_colors.HexColor("#0f172a"),
    )
    small = ParagraphStyle(
        "small", parent=body, fontSize=9, textColor=SOFT_GREY, leading=12,
    )
    bold_small = ParagraphStyle(
        "boldsmall", parent=body, fontSize=9, leading=12, fontName="Helvetica-Bold",
    )

    addr = order.get("address") or {}
    currency = (order.get("buyer_currency") or "NZD").upper()
    charge_amount = float(order.get("charge_amount") or order.get("total_nzd") or 0)
    paid_at = order.get("paid_at")
    paid_str = (
        paid_at.strftime("%d %b %Y, %H:%M UTC")
        if isinstance(paid_at, datetime)
        else _safe(paid_at)
    )

    elements: list[Any] = []

    # ----- Header band -----
    elements.append(Paragraph("<b>Allsale</b>", h1))
    elements.append(Paragraph(
        "Indian Bazaar · operated by Allsale Ltd (NZ) · support@allsale.co.nz",
        small,
    ))
    elements.append(Spacer(1, 8))

    header_table = Table(
        [[
            Paragraph(f"<b>INVOICE</b><br/>"
                      f"#{_short_id(order['id'])}", body),
            Paragraph(
                f"<b>Issued:</b> {datetime.utcnow().strftime('%d %b %Y')}<br/>"
                f"<b>Paid:</b> {paid_str}<br/>"
                f"<b>Order ID:</b> {order['id']}", small,
            ),
        ]],
        colWidths=[None, 78 * mm],
    )
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BG_TINT),
        ("BOX", (0, 0), (-1, -1), 0.5, HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 14))

    # ----- Bill-to / Ship-to -----
    ship_to = (
        f"<b>{_safe(addr.get('full_name'))}</b><br/>"
        f"{_safe(addr.get('line1'))}<br/>"
        f"{_safe(addr.get('line2')) if addr.get('line2') else ''}"
        f"{('<br/>' + _safe(addr.get('line2'))) if False else ''}"
        f"{_safe(addr.get('city'))}, {_safe(addr.get('region'))} "
        f"{_safe(addr.get('postcode'))}<br/>"
        f"{_safe(addr.get('country'))}<br/>"
        f"{_safe(addr.get('phone'))}"
    ).replace("<br/><br/>", "<br/>")

    bill_block = Table(
        [[
            Paragraph("<b>BILL TO / SHIP TO</b><br/>" + ship_to, body),
            Paragraph(
                "<b>BUYER</b><br/>"
                f"{_safe(buyer_email)}<br/>"
                f"Region: {_safe(order.get('buyer_country'))}",
                body,
            ),
        ]],
        colWidths=[None, 78 * mm],
    )
    bill_block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(bill_block)
    elements.append(Spacer(1, 14))

    # ----- Items table -----
    item_rows: list[list[Any]] = [[
        Paragraph("<b>Item</b>", bold_small),
        Paragraph("<b>Seller</b>", bold_small),
        Paragraph("<b>Qty</b>", bold_small),
        Paragraph("<b>Price</b>", bold_small),
        Paragraph("<b>Line total</b>", bold_small),
    ]]
    for it in order.get("items") or []:
        name = it.get("name") or it.get("product_name") or "Item"
        qty = int(it.get("quantity") or 1)
        price = float(it.get("price_nzd") or 0)
        line = price * qty
        item_rows.append([
            Paragraph(_safe(name), body),
            Paragraph(_safe(it.get("seller_name"), default="—"), small),
            Paragraph(str(qty), body),
            Paragraph(_format_money(price, "NZD"), body),
            Paragraph(_format_money(line, "NZD"), body),
        ])
    items_table = Table(
        item_rows,
        colWidths=[None, 38 * mm, 14 * mm, 25 * mm, 28 * mm],
        repeatRows=1,
    )
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PURPLE),
        ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, PURPLE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 12))

    # ----- Totals (NZD canonical + buyer-currency footnote) -----
    def _totals_row(label: str, amount: float, *, bold: bool = False) -> list[Any]:
        style = bold_small if bold else small
        return [
            Paragraph(f"<b>{label}</b>" if bold else label, style),
            Paragraph(_format_money(amount, "NZD"), style),
        ]

    totals_rows: list[list[Any]] = [
        _totals_row("Subtotal", float(order.get("subtotal_nzd") or 0)),
        _totals_row("Shipping", float(order.get("shipping_nzd") or 0)),
    ]
    if (order.get("discount_nzd") or 0) > 0:
        totals_rows.append(_totals_row(
            f"Coupon ({_safe(order.get('coupon_label') or order.get('coupon_code'))})",
            -float(order.get("discount_nzd") or 0),
        ))
    if (order.get("points_discount_nzd") or 0) > 0:
        totals_rows.append(_totals_row(
            f"Points redeemed ({int(order.get('points_used') or 0)} pts)",
            -float(order.get("points_discount_nzd") or 0),
        ))
    totals_rows.append([Paragraph("", small), Paragraph("", small)])  # spacer
    totals_rows.append(_totals_row(
        "TOTAL (NZD)", float(order.get("total_nzd") or 0), bold=True,
    ))
    if currency != "NZD":
        totals_rows.append([
            Paragraph(
                f"<i>Charged in {currency}</i>", small,
            ),
            Paragraph(
                f"<i>{_format_money(charge_amount, currency)}</i>", small,
            ),
        ])

    totals_table = Table(totals_rows, colWidths=[None, 38 * mm])
    totals_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, -2 if currency != "NZD" else -1),
         (-1, -2 if currency != "NZD" else -1), 0.5, PURPLE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    # Right-align the whole totals block by wrapping it
    right_align_wrapper = Table(
        [[Paragraph("", small), totals_table]],
        colWidths=[None, 90 * mm],
    )
    right_align_wrapper.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elements.append(right_align_wrapper)
    elements.append(Spacer(1, 16))

    # ----- Shipping / delivery footer -----
    courier_line = ""
    if order.get("shipping_courier_name"):
        courier_line = (
            f"Courier: <b>{_safe(order.get('shipping_courier_name'))}</b><br/>"
        )
    elements.append(Paragraph(
        f"{courier_line}"
        f"Estimated delivery: <b>{_safe(order.get('estimated_delivery'), default='7–21 business days')}</b><br/>"
        f"Tracking and dispatch updates are sent to your email.",
        small,
    ))
    elements.append(Spacer(1, 14))

    # ----- Legal footer -----
    elements.append(Paragraph(
        "<b>About this invoice.</b> Allsale is a marketplace platform — "
        "individual products are sold by verified Indian sellers via the "
        "Allsale platform. This invoice is your proof of purchase. Refunds "
        "(within 7 days), returns, and disputes are handled per Allsale's "
        "Return Policy.",
        small,
    ))
    elements.append(Paragraph(
        "Allsale Ltd · Auckland, New Zealand · NZBN pending · GST not applicable on cross-border imports",
        small,
    ))
    elements.append(Paragraph(
        "Customer support: support@allsale.co.nz",
        small,
    ))

    doc.build(elements)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PDF endpoint
# ---------------------------------------------------------------------------
@router.get("/orders/{order_id}/invoice.pdf")
async def invoice_pdf(order_id: str, current=Depends(get_current_user)):
    order = await _fetch_order_for_invoice(order_id, current)
    try:
        pdf_bytes = _build_pdf_bytes(order, current.get("email"))
    except Exception as e:
        logger.exception("invoice pdf generation failed for %s: %s", order_id, e)
        raise HTTPException(status_code=500, detail="Couldn't generate invoice")
    filename = f"allsale-invoice-{_short_id(order_id)}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
