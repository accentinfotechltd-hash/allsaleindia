"""Back-in-stock waitlist service.

When a product is OOS, buyers can opt-in to a one-shot notification that
fires the moment the seller restocks. Implementation:

  • `db.stock_waitlist` (one row per (user_id, product_id))
  • `add_to_waitlist()` / `remove_from_waitlist()` / `is_on_waitlist()`
    are exposed via the router.
  • `notify_back_in_stock(product_id)` is invoked from seller-listing
    update endpoints whenever the stock crosses from 0 → >0. It sends
    a Resend email AND creates an in-app notification, then deletes
    the waitlist rows so each buyer is notified exactly once.
"""
from __future__ import annotations

import logging
from typing import Optional

from db import db
from utils import now_utc

logger = logging.getLogger("allsale.stock_waitlist")


async def add_to_waitlist(user_id: str, product_id: str) -> bool:
    """Returns True if a new row was added, False if already present."""
    res = await db.stock_waitlist.update_one(
        {"user_id": user_id, "product_id": product_id},
        {"$setOnInsert": {
            "user_id": user_id,
            "product_id": product_id,
            "created_at": now_utc(),
        }},
        upsert=True,
    )
    return bool(res.upserted_id)


async def remove_from_waitlist(user_id: str, product_id: str) -> bool:
    res = await db.stock_waitlist.delete_one(
        {"user_id": user_id, "product_id": product_id}
    )
    return res.deleted_count > 0


async def is_on_waitlist(user_id: str, product_id: str) -> bool:
    return await db.stock_waitlist.count_documents(
        {"user_id": user_id, "product_id": product_id}, limit=1
    ) > 0


async def list_for_user(user_id: str) -> list[dict]:
    """List a buyer's currently-watched products (newest first)."""
    rows = []
    async for w in db.stock_waitlist.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1):
        prod = await db.products.find_one(
            {"id": w["product_id"]},
            {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1, "in_stock": 1, "stock_count": 1},
        )
        if not prod:
            continue
        rows.append(
            {
                "product_id": w["product_id"],
                "name": prod.get("name", ""),
                "image": prod.get("image", ""),
                "price_nzd": float(prod.get("price_nzd") or 0),
                "in_stock": int(prod.get("stock_count", 0) or 0) > 0
                and bool(prod.get("in_stock", True)),
                "created_at": (
                    w["created_at"].isoformat() if w.get("created_at") else None
                ),
            }
        )
    return rows


def _build_email_html(product: dict, deep_link: str) -> str:
    image = product.get("image") or ""
    name = product.get("name") or "Your wish-listed item"
    price = product.get("price_nzd")
    price_line = f"NZD ${price:.2f}" if isinstance(price, (int, float)) else ""
    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;">
      <div style="background:#7c3aed;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;">
        <h2 style="margin:0;font-size:20px;">🔔 Back in stock!</h2>
        <p style="margin:4px 0 0;opacity:0.9;font-size:13px;">Be quick — it's the popular one.</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:20px 22px;border-radius:0 0 12px 12px;">
        {f'<img src="{image}" alt="" style="width:100%;max-height:280px;border-radius:8px;object-fit:cover;"/>' if image else ''}
        <h3 style="margin:14px 0 4px;font-size:17px;">{name}</h3>
        <p style="margin:0 0 18px;color:#475569;font-size:13px;">{price_line}</p>
        <a href="{deep_link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:11px 22px;border-radius:999px;font-weight:800;text-decoration:none;font-size:14px;">View on Allsale →</a>
      </div>
      <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:18px;">
        You only get this email once per restock. You'll need to opt in again next time.
      </p>
    </div>
    """


async def notify_back_in_stock(product_id: str) -> dict:
    """Fan out notifications for every waitlisted buyer on this product.

    Each buyer is notified ONCE (waitlist row is deleted right after).
    Returns a small stats dict for callers/admin debugging.
    """
    product = await db.products.find_one(
        {"id": product_id},
        {"_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1},
    )
    if not product:
        return {"notified": 0, "skipped": True, "reason": "product_not_found"}

    rows = [
        r async for r in db.stock_waitlist.find(
            {"product_id": product_id}, {"_id": 0, "user_id": 1}
        )
    ]
    if not rows:
        return {"notified": 0}

    # Import here to dodge a circular import at module load.
    from services.email import send_email
    from services.notifications import create_notification

    deep_link = f"https://allsale.co.nz/product/{product_id}"
    html = _build_email_html(product, deep_link)

    notified = 0
    for r in rows:
        uid = r["user_id"]
        user = await db.users.find_one(
            {"id": uid}, {"_id": 0, "id": 1, "email": 1, "full_name": 1}
        )
        if not user:
            continue
        # In-app notification (always fires).
        try:
            await create_notification(
                user_id=uid,
                role="buyer",
                n_type="back_in_stock",
                title=f"{product['name']} is back in stock!",
                body="Tap to grab it before it sells out again.",
                order_id=None,
            )
        except Exception as e:
            logger.warning("back_in_stock in-app notif failed: %s", e)
        # Email (best-effort — never block the seller's update).
        if user.get("email"):
            try:
                send_email(
                    to=user["email"],
                    subject=f"Back in stock · {product['name']}",
                    html=html,
                    text=f"{product['name']} is back in stock on Allsale: {deep_link}",
                )
            except Exception as e:
                logger.warning("back_in_stock email failed: %s", e)
        notified += 1

    # One-shot: clear waitlist for this product so we don't re-notify on
    # subsequent stock changes.
    await db.stock_waitlist.delete_many({"product_id": product_id})
    return {"notified": notified, "product_id": product_id}
