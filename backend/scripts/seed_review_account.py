"""Re-seed the App Store / Play Store reviewer account.

Run from the backend root:
    python -m scripts.seed_review_account

Idempotent — drops any prior `_seed: review_account` rows before inserting.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import motor.motor_asyncio
import requests

EMAIL = "apple-review@allsale.co.nz"
PASSWORD = "AppleReview2026!"
BACKEND = "http://localhost:8001"


def _ensure_account() -> str:
    """Register (or login) the reviewer account; returns user id."""
    r = requests.post(
        f"{BACKEND}/api/auth/register",
        json={"email": EMAIL, "password": PASSWORD, "full_name": "App Store Reviewer"},
        timeout=10,
    )
    if r.status_code == 200:
        return r.json()["user"]["id"]
    # Already exists -> login
    r = requests.post(
        f"{BACKEND}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["user"]["id"]


async def _seed(user_id: str) -> None:
    cli = motor.motor_asyncio.AsyncIOMotorClient("mongodb://localhost:27017")
    db = cli["allsale_database"]
    await db.orders.delete_many({"_seed": "review_account"})
    await db.wishlists.delete_many({"user_id": user_id, "_seed": "review_account"})

    prods = []
    async for p in db.products.find(
        {"in_stock": True, "stock_count": {"$gt": 0}},
        {
            "_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1,
            "seller_id": 1, "seller_name": 1,
        },
    ).limit(2):
        prods.append(p)

    now = datetime.now(timezone.utc)
    items = [
        {
            "product_id": p["id"],
            "name": p["name"],
            "image": p.get("image"),
            "price_nzd": float(p.get("price_nzd", 0)),
            "quantity": 1,
            "seller_id": p.get("seller_id"),
            "seller_name": p.get("seller_name"),
        }
        for p in prods
    ]
    subtotal = sum(i["price_nzd"] for i in items)
    total = round(subtotal + 9.99 + subtotal * 0.05, 2)

    order = {
        "id": f"ord_{uuid4().hex[:12]}",
        "user_id": user_id,
        "email": EMAIL,
        "items": items,
        "subtotal_nzd": round(subtotal, 2),
        "shipping_nzd": 9.99,
        "total_nzd": total,
        "address": {
            "full_name": "App Store Reviewer",
            "line1": "1 Infinite Loop",
            "city": "Cupertino",
            "region": "California",
            "postcode": "95014",
            "country": "US",
            "phone": "+1 408 996 1010",
        },
        "status": "shipped",
        "payment_status": "paid",
        "session_id": "cs_test_review_demo",
        "estimated_delivery": (now + timedelta(days=8)).strftime("%a, %d %b"),
        "buyer_country": "US",
        "buyer_currency": "USD",
        "tracking": {
            "carrier": "Shiprocket X",
            "tracking_number": "SRX-DEMO-001",
            "status": "in_transit",
            "events": [
                {"label": "Order placed", "at": (now - timedelta(days=3)).isoformat()},
                {"label": "Payment confirmed", "at": (now - timedelta(days=3)).isoformat()},
                {"label": "Seller dispatched", "at": (now - timedelta(days=2)).isoformat()},
                {"label": "In transit · Mumbai hub", "at": (now - timedelta(days=1)).isoformat()},
            ],
        },
        "paid_at": now - timedelta(days=3),
        "created_at": now - timedelta(days=3),
        "updated_at": now,
        "_seed": "review_account",
    }
    await db.orders.insert_one(order)

    if prods:
        await db.wishlists.insert_one(
            {
                "user_id": user_id,
                "product_id": prods[0]["id"],
                "added_at": now - timedelta(days=4),
                "_seed": "review_account",
            }
        )
    print(f"Seeded order {order['id']} with {len(items)} item(s), total NZD ${total:.2f}")


def main() -> None:
    user_id = _ensure_account()
    print(f"Reviewer account ready: {EMAIL}  id={user_id}")
    asyncio.run(_seed(user_id))


if __name__ == "__main__":
    main()
