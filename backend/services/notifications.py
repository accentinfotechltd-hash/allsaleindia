"""Notification fan-out helpers."""
from __future__ import annotations

import uuid
from typing import Optional

from db import db
from services.notification_prefs import category_for_type, default_prefs
from utils import now_utc


async def _is_muted_for(user_id: str, n_type: str) -> bool:
    """Returns True iff the recipient has explicitly muted the category
    this notification type belongs to. Admin recipients are never muted.
    Unknown types (no category) are always delivered.
    """
    if user_id == "admin":
        return False
    cat = category_for_type(n_type)
    if cat is None:
        return False
    doc = await db.notification_prefs.find_one(
        {"user_id": user_id}, {"_id": 0, "prefs": 1}
    )
    prefs = (doc or {}).get("prefs") or {}
    # Default = enabled when the key is absent.
    merged = {**default_prefs(), **prefs}
    return merged.get(cat, True) is False


async def create_notification(
    user_id: str,
    role: str,
    n_type: str,
    title: str,
    body: str,
    order_id: Optional[str] = None,
) -> dict:
    """Insert an in-app notification.

    `user_id` should be a real user id; for admin recipients pass the literal
    string ``"admin"``.

    Honours the recipient's per-category mute preferences — if the
    notification's category is muted, **nothing is inserted** and an empty
    dict is returned (callers do not currently rely on the return value
    for control flow, so this is a safe no-op).
    """
    if await _is_muted_for(user_id, n_type):
        return {}
    doc = {
        "id": f"ntf_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "role": role,
        "type": n_type,
        "title": title,
        "body": body,
        "order_id": order_id,
        "read": False,
        "created_at": now_utc(),
    }
    await db.notifications.insert_one(doc)
    return doc


async def notify_admins(
    n_type: str,
    title: str,
    body: str,
    order_id: Optional[str] = None,
) -> None:
    await create_notification(
        user_id="admin",
        role="admin",
        n_type=n_type,
        title=title,
        body=body,
        order_id=order_id,
    )


async def notify_order_placed(order_id: str) -> None:
    """Fan-out: notify the buyer, each unique seller, and the admin."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        return
    short = order_id.replace("order_", "")[:8].upper()
    total = order.get("total_nzd", 0)

    await create_notification(
        user_id=order["user_id"],
        role="buyer",
        n_type="order_placed",
        title=f"Order #{short} confirmed",
        body=(
            f"Thanks! Your order of ${total:.2f} NZD is being prepared. "
            "You can cancel within 12 hours."
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
            n_type="new_order",
            title=f"New order #{short}",
            body="You have a new order. Please prepare items for dispatch.",
            order_id=order_id,
        )

    await notify_admins(
        n_type="order_placed",
        title=f"New order #{short}",
        body=f"Order placed for ${total:.2f} NZD by user {order['user_id']}.",
        order_id=order_id,
    )
