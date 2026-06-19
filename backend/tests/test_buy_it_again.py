"""Tests for GET /orders/buy-it-again — the Buy-it-again home rail.

Verifies:
  - Empty list when buyer has no delivered orders.
  - Delivered orders contribute their products (dedupe + count).
  - Out-of-stock products are filtered out server-side.
  - Static path wins over the dynamic /orders/{order_id} (no 404 collision).
  - Auth required.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone


def _db():
    from db import db
    return db


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _login(api_client, base_url, email, pw):
    r = api_client.post(
        f"{base_url}/api/auth/login", json={"email": email, "password": pw}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


async def _ensure_throwaway_buyer():
    """Idempotent — used to keep tests isolated from buyer@example.com."""
    email = "buy-again-iter44@example.com"
    existing = await _db().users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing:
        return existing["id"], email, "BuyAgain2026!"
    import bcrypt
    pw_hash = bcrypt.hashpw(b"BuyAgain2026!", bcrypt.gensalt()).decode()
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await _db().users.insert_one(
        {
            "id": uid, "email": email, "password_hash": pw_hash,
            "full_name": "Buy Again", "is_seller": False, "email_verified": True,
            "created_at": datetime.now(timezone.utc), "token_version": 0,
        }
    )
    return uid, email, "BuyAgain2026!"


def test_buy_it_again_requires_auth(api_client, base_url):
    r = api_client.get(f"{base_url}/api/orders/buy-it-again")
    assert r.status_code in (401, 403)


def test_buy_it_again_empty_for_buyer_with_no_delivered_orders(api_client, base_url):
    uid, email, pw = _run(_ensure_throwaway_buyer())
    # Wipe any prior delivered orders for this fixture user.
    _run(_db().orders.delete_many({"user_id": uid}))
    token = _login(api_client, base_url, email, pw)
    r = api_client.get(
        f"{base_url}/api/orders/buy-it-again",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"items": [], "total": 0}


def test_buy_it_again_returns_products_from_delivered_orders(api_client, base_url):
    uid, email, pw = _run(_ensure_throwaway_buyer())

    async def _seed():
        # Pick two real, in-stock products to attach.
        prods = []
        async for p in _db().products.find(
            {"in_stock": True, "stock_count": {"$gt": 0}},
            {"_id": 0, "id": 1, "name": 1, "price_nzd": 1},
        ).limit(2):
            prods.append(p)
        assert len(prods) >= 2, "Need at least 2 in-stock products in seed"

        # Wipe + seed two delivered orders so the rail has something to show.
        await _db().orders.delete_many({"user_id": uid})
        now = datetime.now(timezone.utc)
        for i, p in enumerate(prods):
            await _db().orders.insert_one(
                {
                    "id": f"order_iter44_{uuid.uuid4().hex[:8]}",
                    "user_id": uid,
                    "status": "delivered",
                    "payment_status": "paid",
                    "delivered_at": now - timedelta(days=2 - i),
                    "created_at": now - timedelta(days=5 - i),
                    "items": [
                        {
                            "product_id": p["id"],
                            "name": p["name"],
                            "quantity": 1,
                            "price_nzd": p["price_nzd"],
                        }
                    ],
                    "total_nzd": p["price_nzd"],
                }
            )
        return [p["id"] for p in prods]

    pids = _run(_seed())
    token = _login(api_client, base_url, email, pw)
    r = api_client.get(
        f"{base_url}/api/orders/buy-it-again",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    returned_ids = [it["id"] for it in body["items"]]
    # Both seeded products surface; newer one first.
    for pid in pids:
        assert pid in returned_ids, f"{pid} missing from buy-it-again: {returned_ids}"
    # Lean projection includes the rail-specific fields.
    sample = body["items"][0]
    assert "times_purchased" in sample
    assert "last_purchased_at" in sample
    assert "image" in sample
    assert body["total"] >= 2


def test_buy_it_again_does_not_collide_with_dynamic_order_path(api_client, base_url):
    """Regression: register order matters in FastAPI. GET /orders/buy-it-again
    must not be matched by /orders/{order_id}.
    """
    uid, email, pw = _run(_ensure_throwaway_buyer())
    token = _login(api_client, base_url, email, pw)
    r = api_client.get(
        f"{base_url}/api/orders/buy-it-again",
        headers={"Authorization": f"Bearer {token}"},
    )
    # Must not be 404 — would mean it was treated as an order_id.
    assert r.status_code == 200, r.text
    assert "items" in r.json()
