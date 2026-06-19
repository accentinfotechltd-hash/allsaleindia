"""Notification preference categories — single source of truth.

Each `n_type` emitted by the codebase falls into one of these categories.
The buyer / seller can mute a category via `PUT /me/notification-prefs`;
when a category is muted, ``services.notifications.create_notification``
skips the database insert entirely so the bell stays clean.

NOTE: Admin recipients (``user_id == "admin"``) are NEVER muted — admins
need to see operational signal regardless of any single user's prefs.
"""
from __future__ import annotations


# Category metadata shown in the UI. Order = display order.
NOTIFICATION_CATEGORIES: list[dict] = [
    {
        "key": "orders",
        "label": "Order updates",
        "description": "Confirmations, shipping, delivery & cancellations.",
        "default": True,
        "roles": ["buyer"],
    },
    {
        "key": "returns",
        "label": "Returns & refunds",
        "description": "Return requests, approvals, refunds.",
        "default": True,
        "roles": ["buyer"],
    },
    {
        "key": "reviews",
        "label": "Reviews",
        "description": "Replies to your reviews, moderation outcomes.",
        "default": True,
        "roles": ["buyer", "seller"],
    },
    {
        "key": "support",
        "label": "Support tickets",
        "description": "Replies and resolutions from our team.",
        "default": True,
        "roles": ["buyer", "seller"],
    },
    {
        "key": "back_in_stock",
        "label": "Back in stock",
        "description": "When items you waitlisted are available again.",
        "default": True,
        "roles": ["buyer"],
    },
    {
        "key": "seller_alerts",
        "label": "Seller alerts",
        "description": "New orders, payouts and POD uploads.",
        "default": True,
        "roles": ["seller"],
    },
    {
        "key": "promos",
        "label": "Promotions & deals",
        "description": "Flash sales, coupons and personalised offers.",
        "default": True,
        "roles": ["buyer"],
    },
]


# Maps each n_type prefix/literal to its category key. Anything not
# matched falls through to the "_other" bucket which is ALWAYS allowed
# (so we never silently drop a brand-new notification type added later).
_PREFIX_MAP: list[tuple[str, str]] = [
    ("order_", "orders"),
    ("shipment_milestone_", "orders"),
    ("out_for_delivery", "orders"),
    ("new_order", "seller_alerts"),
    ("proof_of_delivery_uploaded", "seller_alerts"),
    ("financing_application", "seller_alerts"),
    ("return_", "returns"),
    ("new_review", "reviews"),
    ("review_", "reviews"),
    ("support_", "support"),
    ("back_in_stock", "back_in_stock"),
    ("promo_", "promos"),
    ("flash_sale_", "promos"),
    ("marketing_", "promos"),
    ("coupon_", "promos"),
]


def category_for_type(n_type: str) -> str | None:
    """Returns the category key for a given notification type, or ``None``
    if the type doesn't belong to any user-mutable category (always
    delivered)."""
    for prefix, cat in _PREFIX_MAP:
        if n_type.startswith(prefix):
            return cat
    return None


def default_prefs() -> dict[str, bool]:
    """All categories enabled by default."""
    return {c["key"]: c["default"] for c in NOTIFICATION_CATEGORIES}
