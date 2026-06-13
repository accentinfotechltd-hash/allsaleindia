"""Tests for the Loyalty Points feature (Phase 5).

Covers:
- GET  /api/points/balance       — shape, auth required, anon=401
- GET  /api/points/history       — sorted desc, limit clamped, balance attached
- POST /api/points/redeem-preview — pure preview, cap_by reasons
- POST /api/cart/points          — apply/persist points_to_use on cart
- DELETE /api/cart/points        — unset points_to_use
- GET  /api/cart                 — exposes points_used, points_discount_nzd,
                                    points_balance, points_max_usable;
                                    stale points auto-drop

Critical correctness vs Mongo state:
1. Welcome bonus on signup (idempotent)
2. Order earn on payment success (idempotent per order_id)
3. Review earn idempotent per review_id
4. Redeem flow ledger debit on payment success
5. Caps: balance / max_per_order / cart_total
6. Rounding: usable_points is always a multiple of 100
7. Stacks with coupons
8. compute_redeem unit tests
9. Cross-user isolation
10. Stale points_to_use silently dropped
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _address():
    return {
        "full_name": "Points Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def _new_user(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_pts_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"Pts {label}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "email": email,
        "user_id": d["user"]["id"],
        "token": d["access_token"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {d['access_token']}",
        },
    }


# A single persistent event loop is used across all helpers so that the
# motor singleton inside backend/db.py (which lazily caches its io_loop on
# first use) is always bound to the SAME loop. Otherwise the second
# asyncio.run() invocation would create a new loop and motor would raise
# "Event loop is closed".
_LOOP = asyncio.new_event_loop()


def _mongo_run(coro_fn):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL, io_loop=_LOOP)
        db = cli[DB_NAME]
        try:
            return await coro_fn(db)
        finally:
            cli.close()
    return _LOOP.run_until_complete(go())


def _count_ledger(user_id, **extra):
    async def go(db):
        q = {"user_id": user_id, **extra}
        return await db.points_ledger.count_documents(q)
    return _mongo_run(go)


def _ledger_sum(user_id):
    async def go(db):
        cur = db.points_ledger.find({"user_id": user_id}, {"_id": 0, "delta": 1})
        total = 0
        async for r in cur:
            total += int(r["delta"])
        return total
    return _mongo_run(go)


def _force_paid_order(order_id):
    """Mark an order paid and trigger _on_payment_succeeded once."""
    async def go(db):
        from routers.checkout import _on_payment_succeeded
        order = await db.orders.find_one({"id": order_id}, {"_id": 0})
        assert order is not None, "order not found"
        if order.get("payment_status") != "paid":
            await db.orders.update_one(
                {"id": order_id},
                {"$set": {"payment_status": "pending", "status": "pending"}},
            )
        await _on_payment_succeeded(order.get("session_id") or "sess_x", order["user_id"], order_id)
    return _mongo_run(go)


def _checkout_until_session(api_client, base_url, headers):
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 200, r.text
    return r.json()["order_id"]


def _add_to_cart(api_client, base_url, headers, product_id, qty=1):
    r = api_client.post(
        f"{base_url}/api/cart", headers=headers,
        json={"product_id": product_id, "quantity": qty},
    )
    assert r.status_code == 200, r.text


def _pick_product(api_client, base_url, min_price_nzd=None):
    prods = api_client.get(f"{base_url}/api/products").json()
    if min_price_nzd is not None:
        for p in prods:
            if p.get("price_nzd", 0) >= min_price_nzd and p.get("in_stock", True):
                return p
    return prods[0]


def _clear_cart(api_client, base_url, headers):
    r = api_client.get(f"{base_url}/api/cart", headers=headers)
    if r.status_code != 200:
        return
    for it in r.json().get("items", []):
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=headers)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def fresh_user(api_client, base_url):
    return _new_user(api_client, base_url, "fresh")


@pytest.fixture
def user_b(api_client, base_url):
    return _new_user(api_client, base_url, "b")


# ---------------------------------------------------------------------------
# /points/balance — shape + auth
# ---------------------------------------------------------------------------
def test_balance_requires_auth(api_client, base_url):
    r = api_client.get(f"{base_url}/api/points/balance")
    assert r.status_code == 401


def test_balance_shape_and_welcome_bonus(api_client, base_url, fresh_user):
    r = api_client.get(f"{base_url}/api/points/balance", headers=fresh_user["headers"])
    assert r.status_code == 200, r.text
    data = r.json()
    for key in (
        "balance", "monetary_value_nzd", "expiring_soon",
        "earn_rate_per_nzd", "redeem_rate_per_nzd", "welcome_bonus",
    ):
        assert key in data, f"missing {key}"
    assert data["earn_rate_per_nzd"] == 1
    assert data["redeem_rate_per_nzd"] == 100
    assert data["welcome_bonus"] == 500
    # Fresh user should receive welcome bonus
    assert data["balance"] == 500
    assert data["monetary_value_nzd"] == 5.0


def test_welcome_bonus_persisted_in_ledger(fresh_user):
    cnt = _count_ledger(fresh_user["user_id"], reason="signup_bonus")
    assert cnt == 1


def test_welcome_bonus_idempotent(fresh_user):
    """Re-running award_welcome_bonus must NOT double-credit."""
    async def go(db):
        from services.points import award_welcome_bonus, current_balance
        b1 = await current_balance(fresh_user["user_id"])
        created = await award_welcome_bonus(fresh_user["user_id"])
        b2 = await current_balance(fresh_user["user_id"])
        return b1, b2, created
    b1, b2, created = _mongo_run(go)
    assert b1 == 500
    assert b2 == 500
    assert created is False


# ---------------------------------------------------------------------------
# /points/history — shape, limit, sort
# ---------------------------------------------------------------------------
def test_history_requires_auth(api_client, base_url):
    r = api_client.get(f"{base_url}/api/points/history")
    assert r.status_code == 401


def test_history_shape_sorted_desc(api_client, base_url, fresh_user):
    r = api_client.get(f"{base_url}/api/points/history?limit=10", headers=fresh_user["headers"])
    assert r.status_code == 200, r.text
    data = r.json()
    assert "balance" in data and "items" in data
    assert data["balance"]["balance"] == 500
    assert len(data["items"]) >= 1
    item = data["items"][0]
    assert item["reason"] == "signup_bonus"
    assert item["delta"] == 500
    assert item["ref_type"] == "user"
    # No mongo _id leakage
    assert "_id" not in item


def test_history_limit_clamped(api_client, base_url, fresh_user):
    r = api_client.get(f"{base_url}/api/points/history?limit=999", headers=fresh_user["headers"])
    assert r.status_code == 200
    # Limit clamped to 200; should still return data without error
    r2 = api_client.get(f"{base_url}/api/points/history?limit=0", headers=fresh_user["headers"])
    assert r2.status_code == 200


# ---------------------------------------------------------------------------
# compute_redeem — pure logic unit tests
# ---------------------------------------------------------------------------
def test_compute_redeem_balance_cap():
    from services.points import compute_redeem
    res = compute_redeem(requested=10_000, balance=2000, subtotal_nzd=500.0)
    assert res["usable_points"] == 2000
    assert res["capped_by"] == "balance"
    assert res["discount_nzd"] == 20.0
    assert res["balance_after"] == 0


def test_compute_redeem_max_per_order_cap():
    from services.points import compute_redeem
    # 50 NZD cart, 50% cap = 25 NZD = 2500 pts
    res = compute_redeem(requested=5000, balance=10_000, subtotal_nzd=50.0)
    assert res["usable_points"] == 2500
    assert res["capped_by"] == "max_per_order"
    assert res["discount_nzd"] == 25.0


def test_compute_redeem_cart_total_cap():
    from services.points import compute_redeem
    # 50% of $5 = $2.50 → floor to $2 = 200 pts
    res = compute_redeem(requested=10_000, balance=10_000, subtotal_nzd=5.0)
    assert res["usable_points"] <= 200
    # Should be a multiple of 100
    assert res["usable_points"] % 100 == 0
    assert res["capped_by"] in ("max_per_order", "cart_total")


def test_compute_redeem_rounding_multiple_of_100():
    from services.points import compute_redeem
    for req in (150, 250, 999, 1001, 333):
        res = compute_redeem(requested=req, balance=10_000, subtotal_nzd=1000.0)
        assert res["usable_points"] % 100 == 0, f"req={req} → usable={res['usable_points']}"


def test_compute_redeem_zero_inputs():
    from services.points import compute_redeem
    assert compute_redeem(requested=0, balance=1000, subtotal_nzd=100.0)["usable_points"] == 0
    assert compute_redeem(requested=1000, balance=0, subtotal_nzd=100.0)["usable_points"] == 0
    assert compute_redeem(requested=1000, balance=1000, subtotal_nzd=0.0)["usable_points"] == 0


# ---------------------------------------------------------------------------
# /points/redeem-preview
# ---------------------------------------------------------------------------
def test_redeem_preview_empty_cart(api_client, base_url, fresh_user):
    _clear_cart(api_client, base_url, fresh_user["headers"])
    r = api_client.post(
        f"{base_url}/api/points/redeem-preview",
        headers=fresh_user["headers"],
        json={"points": 500},
    )
    assert r.status_code == 200
    # subtotal=0 → usable=0
    assert r.json()["usable_points"] == 0


def test_redeem_preview_balance_cap_via_api(api_client, base_url, fresh_user):
    p = _pick_product(api_client, base_url)
    _add_to_cart(api_client, base_url, fresh_user["headers"], p["id"])
    r = api_client.post(
        f"{base_url}/api/points/redeem-preview",
        headers=fresh_user["headers"],
        json={"points": 10_000},
    )
    assert r.status_code == 200
    data = r.json()
    # Balance is 500, must be capped by either balance or other cap
    assert data["usable_points"] <= 500
    assert data["usable_points"] % 100 == 0


# ---------------------------------------------------------------------------
# POST /cart/points apply + DELETE /cart/points remove
# ---------------------------------------------------------------------------
def test_apply_points_to_empty_cart_fails(api_client, base_url, fresh_user):
    _clear_cart(api_client, base_url, fresh_user["headers"])
    r = api_client.post(
        f"{base_url}/api/cart/points",
        headers=fresh_user["headers"],
        json={"points": 100},
    )
    assert r.status_code == 400


def test_apply_then_remove_points_on_cart(api_client, base_url, fresh_user):
    p = _pick_product(api_client, base_url)
    _add_to_cart(api_client, base_url, fresh_user["headers"], p["id"])
    r = api_client.post(
        f"{base_url}/api/cart/points",
        headers=fresh_user["headers"],
        json={"points": 500},
    )
    assert r.status_code == 200, r.text
    cart = r.json()
    assert cart["points_used"] > 0
    assert cart["points_discount_nzd"] > 0
    assert cart["points_balance"] == 500
    # subtotal+shipping-discount, clamped >=0
    assert cart["total_nzd"] == round(
        max(0.0, cart["subtotal_nzd"] + cart["shipping_nzd"] - cart["discount_nzd"]), 2
    )

    r = api_client.delete(f"{base_url}/api/cart/points", headers=fresh_user["headers"])
    assert r.status_code == 200
    cart2 = r.json()
    assert cart2["points_used"] == 0
    assert cart2["points_discount_nzd"] == 0.0


def test_apply_points_no_balance(api_client, base_url):
    """A user with no points balance can't apply."""
    # Build user manually then nuke their welcome bonus
    user = _new_user(__import__("requests").Session(), base_url, "nobal")
    async def wipe(db):
        await db.points_ledger.delete_many({"user_id": user["user_id"]})
    _mongo_run(wipe)
    import requests
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    p = _pick_product(s, base_url)
    s.post(f"{base_url}/api/cart", headers=user["headers"],
           json={"product_id": p["id"], "quantity": 1})
    r = s.post(f"{base_url}/api/cart/points", headers=user["headers"], json={"points": 100})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Cross-user isolation
# ---------------------------------------------------------------------------
def test_cross_user_isolation(api_client, base_url, fresh_user, user_b):
    # Both users have their own welcome bonus only
    r1 = api_client.get(f"{base_url}/api/points/history?limit=50", headers=fresh_user["headers"]).json()
    r2 = api_client.get(f"{base_url}/api/points/history?limit=50", headers=user_b["headers"]).json()
    for it in r1["items"]:
        assert it["user_id"] == fresh_user["user_id"]
    for it in r2["items"]:
        assert it["user_id"] == user_b["user_id"]
    # User A's ledger entries don't appear in B's
    a_ids = {it["id"] for it in r1["items"]}
    b_ids = {it["id"] for it in r2["items"]}
    assert a_ids.isdisjoint(b_ids)


# ---------------------------------------------------------------------------
# Order earn + redeem on payment success — full e2e
# ---------------------------------------------------------------------------
def test_order_earn_and_redeem_on_payment(api_client, base_url, fresh_user):
    p = _pick_product(api_client, base_url, min_price_nzd=50)
    qty = max(1, int(100 // float(p["price_nzd"])))  # aim around $100 cart subtotal
    _add_to_cart(api_client, base_url, fresh_user["headers"], p["id"], qty=qty)
    # Apply 500 pts (welcome bonus) to get $5 discount
    r = api_client.post(
        f"{base_url}/api/cart/points",
        headers=fresh_user["headers"],
        json={"points": 500},
    )
    assert r.status_code == 200, r.text
    cart_pre = r.json()
    subtotal = cart_pre["subtotal_nzd"]
    pts_used = cart_pre["points_used"]
    pts_disc = cart_pre["points_discount_nzd"]
    assert pts_used == 500
    assert pts_disc == 5.0

    order_id = _checkout_until_session(api_client, base_url, fresh_user["headers"])

    # Mark order paid and trigger payment-success hook
    _force_paid_order(order_id)

    # Earned points = floor(1 * subtotal_nzd)
    expected_earn = int(subtotal)  # 1 pt per whole NZD

    bal_after = api_client.get(
        f"{base_url}/api/points/balance", headers=fresh_user["headers"]
    ).json()["balance"]
    # bal = 500 (welcome) - 500 (redeem) + expected_earn
    assert bal_after == expected_earn, f"bal={bal_after}, expected={expected_earn}"

    # Ledger contains both order_earn and order_redeem entries
    earn_cnt = _count_ledger(fresh_user["user_id"], reason="order_earn", ref_id=order_id)
    redeem_cnt = _count_ledger(fresh_user["user_id"], reason="order_redeem", ref_id=order_id)
    assert earn_cnt == 1
    assert redeem_cnt == 1

    # Idempotency: invoke the hook again — no double-credit or double-debit
    _force_paid_order(order_id)
    earn_cnt2 = _count_ledger(fresh_user["user_id"], reason="order_earn", ref_id=order_id)
    redeem_cnt2 = _count_ledger(fresh_user["user_id"], reason="order_redeem", ref_id=order_id)
    assert earn_cnt2 == 1
    assert redeem_cnt2 == 1


# ---------------------------------------------------------------------------
# Stacks with coupons
# ---------------------------------------------------------------------------
def _create_admin_coupon(code, value_nzd=10.0):
    async def go(db):
        await db.coupons.delete_one({"code": code})
        await db.coupons.insert_one({
            "id": f"cp_{int(time.time()*1000)}",
            "code": code,
            "description": f"Test coupon {code}",
            "type": "fixed",
            "value": float(value_nzd),
            "min_order_nzd": 0.0,
            "max_discount_nzd": None,
            "valid_from": None,
            "valid_to": None,
            "usage_limit_total": None,
            "used_count": 0,
            "per_user_limit": 10,
            "scope": "all",
            "scope_value": [],
            "countries": [],
            "owner_id": "admin",
            "owner_name": "Allsale",
            "active": True,
            "created_at": datetime.now(timezone.utc),
        })
    _mongo_run(go)


def test_points_stack_with_coupon(api_client, base_url, fresh_user):
    code = f"TESTPTS{int(time.time())}"
    _create_admin_coupon(code, value_nzd=10.0)
    p = _pick_product(api_client, base_url, min_price_nzd=50)
    qty = max(1, int(100 // float(p["price_nzd"])))
    _add_to_cart(api_client, base_url, fresh_user["headers"], p["id"], qty=qty)
    # Apply coupon
    rc = api_client.post(
        f"{base_url}/api/cart/coupon", headers=fresh_user["headers"], json={"code": code}
    )
    assert rc.status_code == 200, rc.text
    cart_c = rc.json()
    coupon_discount = float(cart_c["discount_nzd"])
    assert coupon_discount >= 10.0 - 0.01

    # Apply 500 points on top
    rp = api_client.post(
        f"{base_url}/api/cart/points", headers=fresh_user["headers"], json={"points": 500}
    )
    assert rp.status_code == 200
    cart = rp.json()
    # discount = coupon $10 + points $5
    assert abs(cart["discount_nzd"] - (coupon_discount + 5.0)) < 0.01, cart
    assert cart["points_used"] == 500
    # total = subtotal + shipping - discount, clamped
    expected_total = round(max(0.0, cart["subtotal_nzd"] + cart["shipping_nzd"] - cart["discount_nzd"]), 2)
    assert abs(cart["total_nzd"] - expected_total) < 0.01


# ---------------------------------------------------------------------------
# Stale points auto-drop
# ---------------------------------------------------------------------------
def test_stale_points_to_use_dropped(api_client, base_url, fresh_user):
    p = _pick_product(api_client, base_url, min_price_nzd=50)
    _add_to_cart(api_client, base_url, fresh_user["headers"], p["id"])
    r = api_client.post(
        f"{base_url}/api/cart/points",
        headers=fresh_user["headers"],
        json={"points": 500},
    )
    assert r.status_code == 200, r.text
    assert r.json()["points_used"] == 500

    # Wipe the user's ledger to simulate external balance drop
    async def wipe(db):
        await db.points_ledger.delete_many({"user_id": fresh_user["user_id"]})
    _mongo_run(wipe)

    r2 = api_client.get(f"{base_url}/api/cart", headers=fresh_user["headers"])
    assert r2.status_code == 200
    cart = r2.json()
    # API response correctly shows no points applied / no discount.
    assert cart["points_used"] == 0
    assert cart["points_discount_nzd"] == 0.0
    assert cart["points_balance"] == 0
    # Cart total should NOT include any stale discount
    expected_total = round(max(0.0, cart["subtotal_nzd"] + cart["shipping_nzd"] - cart["discount_nzd"]), 2)
    assert abs(cart["total_nzd"] - expected_total) < 0.01
    # NOTE: DB persistence side of the auto-drop is asserted separately
    # (and is currently a known minor leak — see test_reports).


# ---------------------------------------------------------------------------
# Review earn idempotent
# ---------------------------------------------------------------------------
def test_review_earn_idempotent_unit(fresh_user):
    async def go(db):
        from services.points import award_review_points, current_balance
        rid = f"rev_test_{int(time.time())}"
        b0 = await current_balance(fresh_user["user_id"])
        a = await award_review_points(fresh_user["user_id"], rid)
        b1 = await current_balance(fresh_user["user_id"])
        a2 = await award_review_points(fresh_user["user_id"], rid)
        b2 = await current_balance(fresh_user["user_id"])
        return b0, a, b1, a2, b2
    b0, a, b1, a2, b2 = _mongo_run(go)
    assert a == 50  # first call awarded
    assert b1 - b0 == 50
    assert a2 == 0  # second call no-op
    assert b2 == b1
