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

import base64
import io
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr
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
        "tax_nzd": order.get("tax_nzd"),
        "tax_rate": order.get("tax_rate"),
        "tax_country": order.get("tax_country"),
        "tax_label_key": order.get("tax_label_key"),
        "tax_at_border": order.get("tax_at_border"),
        "tax_inclusive": order.get("tax_inclusive"),
        "tax_over_threshold": order.get("tax_over_threshold"),
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
    # Tax / consumption duty (NZ GST, AU GST, UK VAT, etc.)
    _tax_nzd = float(order.get("tax_nzd") or 0)
    _tax_country = order.get("tax_country")
    if _tax_nzd > 0:
        _tax_pct = round(float(order.get("tax_rate") or 0) * 100)
        _tax_label = {
            "NZ": f"NZ GST {_tax_pct}%",
            "AU": f"AU GST {_tax_pct}%",
            "GB": f"UK VAT {_tax_pct}%",
        }.get(_tax_country or "", f"Tax {_tax_pct}%")
        totals_rows.append(_totals_row(_tax_label, _tax_nzd))
    elif order.get("tax_inclusive"):
        totals_rows.append([
            Paragraph("GST included in price (18% IGST)", small),
            Paragraph("—", small),
        ])
    elif order.get("tax_at_border") and order.get("tax_over_threshold"):
        # High-value parcel — customs collects at the border.
        totals_rows.append([
            Paragraph("Customs duty (collected at border)", small),
            Paragraph("—", small),
        ])
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
    # Legal/registration footer — accurate per destination so the buyer (and
    # any tax auditor) sees the right basis for any consumption tax charged
    # on this invoice.
    _country = order.get("tax_country")
    _tax_nzd = float(order.get("tax_nzd") or 0)
    _at_border = order.get("tax_at_border")
    if _tax_nzd > 0 and _country == "NZ":
        footer_legal = (
            "Allsale Ltd · Auckland, New Zealand · NZBN pending · "
            "NZ GST 15% collected and remitted to Inland Revenue on imports "
            "under NZ$1,000 (offshore-retailer regime, GST registered)"
        )
    elif _tax_nzd > 0 and _country == "AU":
        footer_legal = (
            "Allsale Ltd · Auckland, New Zealand · NZBN pending · "
            "AU GST 10% collected and remitted to the ATO on imports under "
            "AU$1,000 (offshore-retailer regime, GST registered)"
        )
    elif _tax_nzd > 0 and _country == "GB":
        footer_legal = (
            "Allsale Ltd · Auckland, New Zealand · NZBN pending · "
            "UK VAT 20% collected and remitted to HMRC on imports up to £135 "
            "(offshore-retailer regime, VAT registered)"
        )
    elif _at_border and order.get("tax_over_threshold") and float(order.get("tax_rate") or 0) > 0:
        # High-value parcel into NZ/AU/UK — those jurisdictions DO collect
        # at the border above their low-value threshold. Pacific/US/CA
        # don't fit this branch because their rate is 0 and they don't run
        # an offshore-retailer regime at all.
        footer_legal = (
            "Allsale Ltd · Auckland, New Zealand · NZBN pending · "
            "Destination customs duty / import VAT applies at the border for "
            "this order (above low-value threshold)"
        )
    elif order.get("tax_inclusive") or _country == "IN":
        # India domestic — seller's price already includes 18% IGST.
        footer_legal = (
            "Allsale Ltd · Auckland, New Zealand · NZBN pending · "
            "18% IGST is included in the seller's listed price (India domestic sale)"
        )
    else:
        # US/CA/Pacific etc — local customs handles at the border if applicable.
        footer_legal = (
            "Allsale Ltd · Auckland, New Zealand · NZBN pending · "
            "Destination import duties (if any) are assessed by local customs"
        )
    elements.append(Paragraph(footer_legal, small))
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


# ---------------------------------------------------------------------------
# Email-this-invoice (Resend)
# ---------------------------------------------------------------------------
class InvoiceEmailRequest(BaseModel):
    """Body for POST /orders/{id}/invoice/email.

    Both fields are optional — when omitted we send to the buyer's account
    email. `to` lets a buyer forward the receipt (e.g. to an employer).
    """
    to: Optional[EmailStr] = None
    message: Optional[str] = None  # optional buyer note prepended in the body


def _invoice_email_html(order: dict, short_id: str, buyer_name: str | None,
                        custom_message: str | None) -> str:
    total = _format_money(
        order.get("charge_amount") or order.get("total_nzd") or 0,
        order.get("buyer_currency") or "NZD",
    )
    when = order.get("paid_at") or order.get("created_at") or ""
    if isinstance(when, datetime):
        when = when.strftime("%d %b %Y")
    item_rows = []
    for it in (order.get("items") or [])[:12]:
        item_rows.append(
            f"<tr><td style='padding:6px 0;color:#0f172a;'>{(it.get('name') or it.get('product_name') or '—')[:80]}"
            f"</td><td style='text-align:right;color:#475569;'>x{it.get('quantity', 1)}</td></tr>"
        )
    body_blocks = []
    if custom_message:
        # Light XSS-safety — Resend does NOT sanitise, so we keep it primitive.
        safe = (
            custom_message.replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br/>")
        )[:1000]
        body_blocks.append(
            f"<p style='font-size:14px;color:#334155;background:#f1f5f9;padding:12px;border-radius:8px;'>{safe}</p>"
        )
    return f"""
    <div style='font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;'>
      <div style='background:#7c3aed;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;'>
        <h2 style='margin:0;font-size:20px;'>Allsale receipt</h2>
        <p style='margin:4px 0 0;opacity:0.9;font-size:13px;'>Order #{short_id} · {when}</p>
      </div>
      <div style='border:1px solid #e2e8f0;border-top:none;padding:20px 22px;border-radius:0 0 12px 12px;'>
        <p style='margin:0 0 12px;font-size:14px;'>Hi {buyer_name or 'there'},</p>
        <p style='margin:0 0 16px;font-size:14px;color:#334155;'>
          Your invoice for order <strong>#{short_id}</strong> is attached as a PDF.
          Keep it for your records — it's also available any time inside the Allsale app.
        </p>
        {''.join(body_blocks)}
        <table style='width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;'>
          {''.join(item_rows)}
        </table>
        <div style='margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;'>
          <span style='font-size:13px;color:#64748b;'>Total paid</span>
          <strong style='font-size:18px;color:#0f172a;'>{total}</strong>
        </div>
      </div>
      <p style='font-size:11px;color:#94a3b8;text-align:center;margin-top:18px;'>
        Questions? Reply to this email or contact support@allsale.co.nz
      </p>
    </div>
    """


@router.post("/orders/{order_id}/invoice/email")
async def email_invoice(
    order_id: str,
    body: InvoiceEmailRequest | None = None,
    current=Depends(get_current_user),
):
    """Send the buyer's invoice PDF as a Resend email.

    Auth: only the buyer who placed the order (or any admin). Same gate as
    `GET /orders/{id}/invoice.pdf`.

    Body (optional):
        - `to`: forward the receipt to a different email (defaults to the
          buyer's account email).
        - `message`: a short personal note prepended in the email body.

    Returns `{ok, sent, to, resend_id}` or `{ok, sent:false, skipped, reason}`
    when Resend isn't configured (handy in CI / dev).
    """
    order = await _fetch_order_for_invoice(order_id, current)
    try:
        pdf_bytes = _build_pdf_bytes(order, current.get("email"))
    except Exception as e:
        logger.exception("invoice email pdf gen failed for %s: %s", order_id, e)
        raise HTTPException(status_code=500, detail="Couldn't generate invoice")

    short = _short_id(order_id)
    addr_name = (order.get("address") or {}).get("full_name")
    to_email = (body.to if body and body.to else current.get("email"))
    if not to_email:
        raise HTTPException(status_code=400, detail="No email on file — pass `to` in the body.")

    # Lazy import to avoid an import cycle (services.email re-imports cleanly).
    from services.email import send_email

    html = _invoice_email_html(
        order, short, addr_name, body.message if body else None
    )
    attachment_b64 = base64.b64encode(pdf_bytes).decode("ascii")
    result = send_email(
        to=str(to_email),
        subject=f"Your Allsale invoice · Order #{short}",
        html=html,
        text=f"Your Allsale invoice for order #{short} is attached.",
        attachments=[
            {
                "filename": f"allsale-invoice-{short}.pdf",
                "content": attachment_b64,
                "content_type": "application/pdf",
            }
        ],
    )

    # Record the dispatch so /admin can audit "did the buyer ever ask for a
    # resend?" without needing Resend's dashboard.
    await db.orders.update_one(
        {"id": order_id},
        {
            "$push": {
                "invoice_email_log": {
                    "to": to_email,
                    "sent_at": datetime.utcnow(),
                    "by_user_id": current.get("id"),
                    "resend_id": result.get("id"),
                    "ok": bool(result.get("sent")),
                    "reason": result.get("reason"),
                }
            }
        },
    )

    return {
        "ok": True,
        "sent": bool(result.get("sent")),
        "to": str(to_email),
        "skipped": bool(result.get("skipped")),
        "reason": result.get("reason"),
        "resend_id": result.get("id"),
    }
