"""Tests for gift wrap per-line: PATCH /cart/{pid}/gift, fee math, and
that gift fields persist + drop cleanly on toggle-off."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone


def _db():
    from db import db
    return db


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _ensure_gift_buyer():
    email = "gift-wrap-iter45@example.com"
    existing = await _db().users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing:
        return existing["id"], email, "GiftWrap2026!"
    import bcrypt
    pw_hash = bcrypt.hashpw(b"GiftWrap2026!", bcrypt.gensalt()).decode()
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await _db().users.insert_one(
        {
            "id": uid, "email": email, "password_hash": pw_hash,
            "full_name": "Gift Buyer", "is_seller": False, "email_verified": True,
            "created_at": datetime.now(timezone.utc), "token_version": 0,
        }
    )
    return uid, email, "GiftWrap2026!"


def _login(api_client, base_url, email, pw):
    r = api_client.post(
        f"{base_url}/api/auth/login", json={"email": email, "password": pw}
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_gift_wrap_flow_end_to_end(api_client, base_url):
    uid, email, pw = _run(_ensure_gift_buyer())
    # Clear the buyer's cart so the test is hermetic.
    _run(_db().carts.delete_many({"user_id": uid}))
    token = _login(api_client, base_url, email, pw)
    headers = {"Authorization": f"Bearer {token}"}

    # Need two in-stock product IDs.
    async def _pick_two():
        out = []
        async for p in _db().products.find(
            {"in_stock": True, "stock_count": {"$gt": 0}},
            {"_id": 0, "id": 1, "price_nzd": 1},
        ).limit(2):
            out.append(p)
        return out

    products = _run(_pick_two())
    assert len(products) >= 2
    pid_a, pid_b = products[0]["id"], products[1]["id"]

    # Seed both into the cart.
    for pid in (pid_a, pid_b):
        r = api_client.post(
            f"{base_url}/api/cart",
            json={"product_id": pid, "quantity": 1},
            headers=headers,
        )
        assert r.status_code == 200, r.text
    cart = api_client.get(f"{base_url}/api/cart", headers=headers).json()
    base_total = cart["total_nzd"]
    assert cart["gift_wrap_fee_nzd"] == 0
    assert cart["gift_wrap_count"] == 0

    # Toggle gift wrap ON for the first line.
    r = api_client.patch(
        f"{base_url}/api/cart/{pid_a}/gift",
        json={"gift_wrap": True, "gift_message": "Happy birthday!"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    cart = r.json()
    assert cart["gift_wrap_count"] == 1
    assert abs(cart["gift_wrap_fee_nzd"] - 5.00) < 0.01
    assert abs(cart["total_nzd"] - (base_total + 5.00)) < 0.01
    matched_line = next(i for i in cart["items"] if i["product_id"] == pid_a)
    assert matched_line.get("gift_wrap") is True
    assert matched_line.get("gift_message") == "Happy birthday!"

    # Add gift wrap on the second line too — fee doubles to $10.
    r = api_client.patch(
        f"{base_url}/api/cart/{pid_b}/gift",
        json={"gift_wrap": True, "gift_message": ""},
        headers=headers,
    )
    assert r.status_code == 200
    cart = r.json()
    assert cart["gift_wrap_count"] == 2
    assert abs(cart["gift_wrap_fee_nzd"] - 10.00) < 0.01
    assert abs(cart["total_nzd"] - (base_total + 10.00)) < 0.01

    # Toggle OFF for the first line.
    r = api_client.patch(
        f"{base_url}/api/cart/{pid_a}/gift",
        json={"gift_wrap": False},
        headers=headers,
    )
    assert r.status_code == 200
    cart = r.json()
    assert cart["gift_wrap_count"] == 1
    assert abs(cart["gift_wrap_fee_nzd"] - 5.00) < 0.01
    matched_line = next(i for i in cart["items"] if i["product_id"] == pid_a)
    assert not matched_line.get("gift_wrap")
    # Message cleared when wrap is off.
    assert "gift_message" not in matched_line or matched_line["gift_message"] is None

    # Unknown product id → 404.
    r = api_client.patch(
        f"{base_url}/api/cart/does-not-exist/gift",
        json={"gift_wrap": True},
        headers=headers,
    )
    assert r.status_code == 404


def test_gift_wrap_requires_auth(api_client, base_url):
    r = api_client.patch(
        f"{base_url}/api/cart/any-id/gift", json={"gift_wrap": True}
    )
    assert r.status_code in (401, 403)


def test_gift_wrap_message_truncated_to_240(api_client, base_url):
    uid, email, pw = _run(_ensure_gift_buyer())
    _run(_db().carts.delete_many({"user_id": uid}))
    token = _login(api_client, base_url, email, pw)
    headers = {"Authorization": f"Bearer {token}"}

    async def _pick_one():
        return await _db().products.find_one(
            {"in_stock": True, "stock_count": {"$gt": 0}}, {"_id": 0, "id": 1}
        )

    p = _run(_pick_one())
    api_client.post(
        f"{base_url}/api/cart",
        json={"product_id": p["id"], "quantity": 1},
        headers=headers,
    )

    long_msg = "X" * 500
    r = api_client.patch(
        f"{base_url}/api/cart/{p['id']}/gift",
        json={"gift_wrap": True, "gift_message": long_msg},
        headers=headers,
    )
    assert r.status_code == 200
    cart = r.json()
    line = next(i for i in cart["items"] if i["product_id"] == p["id"])
    assert len(line["gift_message"]) == 240
