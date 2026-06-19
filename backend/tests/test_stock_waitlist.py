"""Back-in-stock waitlist + restock fan-out tests."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone


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


async def _ensure_buyer():
    email = "stock-watch-iter46@example.com"
    existing = await _db().users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing:
        return existing["id"], email, "StockWatch2026!"
    import bcrypt
    pw_hash = bcrypt.hashpw(b"StockWatch2026!", bcrypt.gensalt()).decode()
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await _db().users.insert_one(
        {
            "id": uid, "email": email, "password_hash": pw_hash,
            "full_name": "Stock Watcher", "is_seller": False,
            "email_verified": True,
            "created_at": datetime.now(timezone.utc), "token_version": 0,
        }
    )
    return uid, email, "StockWatch2026!"


def _seed_oos_product(name: str = "OOS-test-iter46") -> str:
    """Insert a temporary OOS product owned by no real seller."""
    async def _go():
        pid = f"prod_iter46_{uuid.uuid4().hex[:10]}"
        # Find a real seller id so listings.patch RBAC works (we don't use
        # the seller endpoint in these tests, only the buyer-facing one).
        await _db().products.insert_one(
            {
                "id": pid, "name": name, "image": "https://x.test/i.jpg",
                "price_nzd": 19.99, "price_inr": 999, "category": "Test",
                "in_stock": False, "stock_count": 0,
                "created_at": datetime.now(timezone.utc),
                "seller_id": "seller_test", "seller_name": "Test Seller",
            }
        )
        return pid

    return _run(_go())


def test_opt_in_and_opt_out(api_client, base_url):
    uid, email, pw = _run(_ensure_buyer())
    pid = _seed_oos_product()
    token = _login(api_client, base_url, email, pw)
    headers = {"Authorization": f"Bearer {token}"}

    # Initial state: not watching.
    r = api_client.get(
        f"{base_url}/api/products/{pid}/notify-when-in-stock", headers=headers
    )
    assert r.status_code == 200
    assert r.json() == {"watching": False}

    # Opt-in.
    r = api_client.post(
        f"{base_url}/api/products/{pid}/notify-when-in-stock",
        json={}, headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["watching"] is True

    # Idempotent re-opt-in.
    r = api_client.post(
        f"{base_url}/api/products/{pid}/notify-when-in-stock",
        json={}, headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["watching"] is True

    # Confirm state.
    r = api_client.get(
        f"{base_url}/api/products/{pid}/notify-when-in-stock", headers=headers
    )
    assert r.json()["watching"] is True

    # Opt-out.
    r = api_client.delete(
        f"{base_url}/api/products/{pid}/notify-when-in-stock", headers=headers
    )
    assert r.status_code == 200
    assert r.json()["watching"] is False

    # Cleanup.
    _run(_db().products.delete_one({"id": pid}))


def test_opt_in_rejected_when_already_in_stock(api_client, base_url):
    _, email, pw = _run(_ensure_buyer())
    # Use a real in-stock product.
    async def _pick():
        return await _db().products.find_one(
            {"in_stock": True, "stock_count": {"$gt": 0}}, {"_id": 0, "id": 1}
        )

    p = _run(_pick())
    token = _login(api_client, base_url, email, pw)
    r = api_client.post(
        f"{base_url}/api/products/{p['id']}/notify-when-in-stock",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_fan_out_notifies_and_clears_waitlist(api_client, base_url):
    """When `notify_back_in_stock` runs, every waitlisted buyer gets an
    in-app notification AND the waitlist row is removed (one-shot)."""
    from services.stock_waitlist import notify_back_in_stock

    uid, email, pw = _run(_ensure_buyer())
    pid = _seed_oos_product("Restock-test-iter46")

    # Manually waitlist the buyer.
    _run(_db().stock_waitlist.delete_many({"user_id": uid}))
    _run(_db().stock_waitlist.insert_one({
        "user_id": uid,
        "product_id": pid,
        "created_at": datetime.now(timezone.utc),
    }))

    # Flip stock to in-stock + invoke fan-out.
    _run(_db().products.update_one(
        {"id": pid}, {"$set": {"in_stock": True, "stock_count": 5}}
    ))
    result = _run(notify_back_in_stock(pid))
    assert result["notified"] == 1

    # In-app notification was created.
    n = _run(_db().notifications.find_one(
        {"user_id": uid, "type": "back_in_stock"}
    ))
    assert n is not None

    # Waitlist row was cleared (one-shot semantics).
    remaining = _run(_db().stock_waitlist.count_documents({"product_id": pid}))
    assert remaining == 0

    # Cleanup.
    _run(_db().products.delete_one({"id": pid}))
    _run(_db().notifications.delete_many(
        {"user_id": uid, "type": "back_in_stock"}
    ))


def test_my_stock_watch_list(api_client, base_url):
    uid, email, pw = _run(_ensure_buyer())
    _run(_db().stock_waitlist.delete_many({"user_id": uid}))
    pid = _seed_oos_product("Watchlist-test-iter46")
    _run(_db().stock_waitlist.insert_one({
        "user_id": uid,
        "product_id": pid,
        "created_at": datetime.now(timezone.utc),
    }))
    token = _login(api_client, base_url, email, pw)
    r = api_client.get(
        f"{base_url}/api/me/stock-watch",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert any(it["product_id"] == pid for it in body["items"])
    # Cleanup.
    _run(_db().stock_waitlist.delete_many({"user_id": uid}))
    _run(_db().products.delete_one({"id": pid}))
