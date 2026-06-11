"""Notification fan-out helpers."""
from __future__ import annotations

import uuid
from typing import Optional

from db import db
from utils import now_utc


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
    """
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
