"""Flash sales — time-boxed, auto-publish/expire per-product discounts.

A flash sale is "active" when:
- `active=True` AND
- `valid_from <= now < valid_to` AND
- `units_sold < units_max`

Pricing: when a product has an active sale, the cart hydration substitutes
the sale price. `units_sold` is incremented atomically on payment success
(idempotent per order_id via the orders.flash_sales[].order_id index).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from db import db


MIN_DISCOUNT_PCT = 10
MAX_DURATION_DAYS = 7
MAX_ACTIVE_PER_SELLER = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(d):
    if d is None:
        return None
    if isinstance(d, datetime) and d.tzinfo is None:
        return d.replace(tzinfo=timezone.utc)
    return d


def _is_currently_active(sale: dict, now: datetime | None = None) -> bool:
    if not sale or not sale.get("active", True):
        return False
    n = now or _now()
    vf = _aware(sale.get("valid_from"))
    vt = _aware(sale.get("valid_to"))
    if not vf or not vt:
        return False
    if vf > n or vt <= n:
        return False
    return int(sale.get("units_sold") or 0) < int(sale.get("units_max") or 0)


def _public_view(sale: dict, *, product_name: str | None = None,
                 product_image: str | None = None, is_dod: bool = False) -> dict:
    sold_out = int(sale.get("units_sold") or 0) >= int(sale.get("units_max") or 0)
    return {
        "id": sale["id"],
        "product_id": sale["product_id"],
        "product_name": product_name,
        "product_image": product_image,
        "seller_name": sale.get("seller_name"),
        "sale_price_nzd": float(sale["sale_price_nzd"]),
        "original_price_nzd": float(sale["original_price_nzd"]),
        "discount_pct": int(sale["discount_pct"]),
        "ends_at": _aware(sale["valid_to"]),
        "starts_at": _aware(sale["valid_from"]),
        "units_sold": int(sale.get("units_sold") or 0),
        "units_max": int(sale.get("units_max") or 0),
        "is_deal_of_the_day": bool(is_dod),
        "sold_out": sold_out,
    }


async def get_active_for_product(product_id: str) -> Optional[dict]:
    """Returns the most-discounted active sale for a product, or None."""
    now = _now()
    cursor = db.flash_sales.find(
        {
            "product_id": product_id,
            "active": True,
            "valid_from": {"$lte": now},
            "valid_to": {"$gt": now},
        },
        {"_id": 0},
    )
    best: dict | None = None
    async for s in cursor:
        if not _is_currently_active(s, now):
            continue
        if best is None or int(s.get("discount_pct", 0)) > int(best.get("discount_pct", 0)):
            best = s
    return best


async def list_currently_active() -> list[dict]:
    """All currently active sales, sorted with featured Deal-of-the-Day first."""
    now = _now()
    out: list[dict] = []
    async for s in db.flash_sales.find(
        {
            "active": True,
            "valid_from": {"$lte": now},
            "valid_to": {"$gt": now},
        },
        {"_id": 0},
    ):
        if _is_currently_active(s, now):
            out.append(s)
    # Sort: featured first, then highest discount, then earliest ending
    out.sort(
        key=lambda s: (
            not s.get("featured", False),
            -int(s.get("discount_pct", 0)),
            _aware(s["valid_to"]),
        )
    )
    return out


async def hydrate_with_products(sales: list[dict]) -> list[dict]:
    """Enrich a list of sales with product name/image."""
    if not sales:
        return []
    ids = list({s["product_id"] for s in sales})
    products = {}
    async for p in db.products.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "image": 1}):
        products[p["id"]] = p
    deal_of_day_id = sales[0]["id"] if sales and sales[0].get("featured") else None
    out: list[dict] = []
    for s in sales:
        prod = products.get(s["product_id"]) or {}
        out.append(
            _public_view(
                s,
                product_name=prod.get("name"),
                product_image=prod.get("image"),
                is_dod=(s["id"] == deal_of_day_id),
            )
        )
    return out


async def record_units_sold(
    *, sale_id: str, order_id: str, qty: int
) -> int:
    """Increment units_sold. Idempotent per (sale_id, order_id)."""
    qty = max(0, int(qty))
    if qty == 0:
        return 0
    # Use a marker insert in `flash_sale_usage` to guarantee idempotency
    try:
        await db.flash_sale_usage.insert_one(
            {"sale_id": sale_id, "order_id": order_id, "qty": qty, "at": _now()}
        )
    except Exception:
        # Duplicate — already counted
        return 0
    await db.flash_sales.update_one(
        {"id": sale_id}, {"$inc": {"units_sold": qty}}
    )
    return qty


async def create_sale(
    *,
    seller: dict,
    product: dict,
    body,
) -> dict:
    """Validate & insert a new flash sale. `body` is a FlashSaleCreate."""
    now = _now()
    vf = _aware(body.valid_from)
    vt = _aware(body.valid_to)
    if vf is None or vt is None or vt <= vf:
        raise ValueError("valid_to must be after valid_from")
    if vt <= now:
        raise ValueError("valid_to must be in the future")
    # Cap duration
    if (vt - vf).days > MAX_DURATION_DAYS:
        raise ValueError(f"Max sale duration is {MAX_DURATION_DAYS} days")

    original = float(product.get("price_nzd") or 0.0)
    if original <= 0:
        raise ValueError("Product has no list price")
    if body.sale_price_nzd >= original:
        raise ValueError("Sale price must be lower than the product's list price")

    pct = int(round((1 - (body.sale_price_nzd / original)) * 100))
    if pct < MIN_DISCOUNT_PCT:
        raise ValueError(f"Discount must be at least {MIN_DISCOUNT_PCT}%")

    # Cap active per seller
    active_count = 0
    async for s in db.flash_sales.find(
        {"seller_id": seller["id"], "active": True, "valid_to": {"$gt": now}},
        {"_id": 0, "id": 1},
    ):
        active_count += 1
    if active_count >= MAX_ACTIVE_PER_SELLER:
        raise ValueError(
            f"You already have {MAX_ACTIVE_PER_SELLER} active flash sales. "
            "Pause or wait for one to end before creating another."
        )

    seller_profile = await db.sellers.find_one(
        {"user_id": seller["id"]}, {"_id": 0, "company_name": 1}
    )
    doc = {
        "id": f"fs_{uuid.uuid4().hex[:14]}",
        "product_id": product["id"],
        "seller_id": seller["id"],
        "seller_name": (seller_profile or {}).get("company_name") or seller.get("full_name"),
        "sale_price_nzd": round(float(body.sale_price_nzd), 2),
        "original_price_nzd": round(original, 2),
        "discount_pct": pct,
        "valid_from": vf,
        "valid_to": vt,
        "units_max": int(body.units_max),
        "units_sold": 0,
        "featured": bool(body.featured),
        "active": bool(body.active),
        "created_at": now,
    }
    await db.flash_sales.insert_one(doc)
    return doc
