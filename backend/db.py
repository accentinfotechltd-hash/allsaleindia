"""Mongo client singleton.

Keep imports light — every module that touches the DB pulls `db` from here
to avoid duplicating client instances.
"""
from __future__ import annotations

import logging

from motor.motor_asyncio import AsyncIOMotorClient

from config import DB_NAME, MONGO_URL

logger = logging.getLogger("allsale")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]


async def ensure_indexes() -> None:
    """Create idempotent indexes on the collections we use."""
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.products.create_index("id", unique=True)
    await db.products.create_index("category")
    await db.products.create_index("subcategory")
    await db.carts.create_index("user_id", unique=True)
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("user_id")
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.sellers.create_index("user_id", unique=True)
    # GSTIN is OPTIONAL for sole proprietors → keep uniqueness but
    # only on docs that actually have a GSTIN (partial index).
    try:
        await db.sellers.drop_index("gstin_1")
    except Exception:
        pass
    await db.sellers.create_index(
        "gstin",
        unique=True,
        partialFilterExpression={"gstin": {"$type": "string"}},
    )
    await db.products.create_index("seller_id")
    await db.payouts.create_index("id", unique=True)
    await db.payouts.create_index([("seller_id", 1), ("status", 1)])
    await db.payouts.create_index([("order_id", 1), ("seller_id", 1)], unique=True)
    await db.orders.create_index("items.seller_id")
    await db.shipments.create_index("order_id", unique=True)
    await db.shipments.create_index("awb_code", unique=True)
    await db.notifications.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read", 1)])
    await db.returns.create_index("id", unique=True)
    await db.returns.create_index([("user_id", 1), ("created_at", -1)])
    await db.returns.create_index([("seller_id", 1), ("status", 1)])
    await db.returns.create_index("order_id")
    # analytics_events: per-day aggregation by seller for the 7/30-day chart.
    await db.analytics_events.create_index([("seller_id", 1), ("at", -1)])
    await db.analytics_events.create_index([("seller_id", 1), ("type", 1), ("at", -1)])
    # reviews: lookup by product (list reviews on product page), by user
    # (My Reviews / verified-purchase dedupe), and by seller (My Reviews
    # tab in seller dashboard).
    await db.reviews.create_index("id", unique=True)
    await db.reviews.create_index([("product_id", 1), ("created_at", -1)])
    await db.reviews.create_index([("user_id", 1), ("created_at", -1)])
    await db.reviews.create_index([("seller_id", 1), ("created_at", -1)])
    await db.reviews.create_index(
        [("user_id", 1), ("order_id", 1), ("product_id", 1)],
        unique=True,
    )
    # coupons & redemptions
    await db.coupons.create_index("id", unique=True)
    await db.coupons.create_index("code", unique=True)
    await db.coupons.create_index([("owner_id", 1), ("created_at", -1)])
    await db.coupons.create_index([("active", 1), ("valid_to", 1)])
    await db.coupon_usage.create_index(
        [("coupon_id", 1), ("order_id", 1)], unique=True
    )
    await db.coupon_usage.create_index([("coupon_id", 1), ("user_id", 1)])
    await db.coupon_usage.create_index([("user_id", 1), ("redeemed_at", -1)])
    # wishlists: lookup by user (My Wishlist) + uniqueness per (user, product)
    await db.wishlists.create_index(
        [("user_id", 1), ("product_id", 1)], unique=True
    )
    await db.wishlists.create_index([("user_id", 1), ("added_at", -1)])
    await db.wishlists.create_index("product_id")
    # points_ledger — fast user-history & balance aggregations
    await db.points_ledger.create_index("id", unique=True)
    await db.points_ledger.create_index([("user_id", 1), ("created_at", -1)])
    await db.points_ledger.create_index([("user_id", 1), ("reason", 1), ("ref_id", 1)])
    await db.points_ledger.create_index("expires_at")
    # flash sales
    await db.flash_sales.create_index("id", unique=True)
    await db.flash_sales.create_index([("active", 1), ("valid_from", 1), ("valid_to", 1)])
    await db.flash_sales.create_index([("seller_id", 1), ("created_at", -1)])
    await db.flash_sales.create_index([("product_id", 1), ("active", 1)])
    await db.flash_sale_usage.create_index(
        [("sale_id", 1), ("order_id", 1)], unique=True
    )
    # Referrals
    await db.users.create_index("referral_code", unique=True, sparse=True)
    await db.referrals.create_index("referee_id", unique=True)
    await db.referrals.create_index([("referrer_id", 1), ("created_at", -1)])
    await db.referrals.create_index([("status", 1), ("created_at", 1)])
    # chat
    await db.chat_conversations.create_index("id", unique=True)
    await db.chat_conversations.create_index([("buyer_id", 1), ("last_message_at", -1)])
    await db.chat_conversations.create_index([("seller_id", 1), ("last_message_at", -1)])
    await db.chat_conversations.create_index(
        [("buyer_id", 1), ("seller_id", 1), ("product_id", 1)], unique=True
    )
    await db.chat_messages.create_index([("conversation_id", 1), ("created_at", 1)])
    await db.chat_messages.create_index("id", unique=True)
