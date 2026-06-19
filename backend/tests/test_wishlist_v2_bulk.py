"""Wishlist 2.0 — bulk operations + sort

Covers:
  * GET /api/wishlist?sort=recent|price_asc|price_desc|name
  * Invalid sort -> 422
  * POST /api/wishlist/move-to-cart (specific ids, remove_after true/false)
  * POST /api/wishlist/move-to-cart with empty body -> moves entire wishlist (in-stock only)
  * POST /api/wishlist/move-to-cart skips out-of-stock with reason
  * POST /api/wishlist/remove-bulk
  * DELETE /api/wishlist (clear all)
  * sort=name handles case-insensitive unicode
  * Single-item endpoints regression (POST/{pid}, DELETE/{pid})
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
import requests

# -- BASE_URL resolution --
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
)
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = (BASE_URL or "").rstrip("/")

BUYER_EMAIL = "buyer@example.com"
BUYER_PASSWORD = "Buyer2026!"


# ---------- Helpers ----------
def _auth_headers(token: str) -> dict:
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


def _login_buyer() -> dict:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"buyer login failed: {r.status_code} {r.text}"
    data = r.json()
    # Skip 2FA path
    if data.get("requires_2fa"):
        pytest.skip("buyer requires 2FA, cannot run automated tests")
    return {
        "token": data["access_token"],
        "user_id": data["user"]["id"],
        "headers": _auth_headers(data["access_token"]),
    }


def _list_products(limit: int = 200) -> list[dict]:
    r = requests.get(f"{BASE_URL}/api/products?limit={limit}", timeout=20)
    assert r.status_code == 200
    return r.json()


def _pick_in_stock(n: int) -> list[dict]:
    prods = _list_products()
    in_stock = [
        p for p in prods
        if int(p.get("stock_count") or 0) > 0 and p.get("in_stock", True)
    ]
    # Prefer non-TEST_ products for nicer hydration, but fall back if not enough
    real_first = [p for p in in_stock if not p.get("name", "").startswith("TEST_")]
    pool = real_first if len(real_first) >= n else in_stock
    assert len(pool) >= n, f"need {n} in-stock products, got {len(pool)}"
    # Dedup by id (TEST_ rows can repeat names across sellers, but distinct ids)
    seen, out = set(), []
    for p in pool:
        if p["id"] in seen:
            continue
        seen.add(p["id"])
        out.append(p)
        if len(out) >= n:
            break
    return out


def _pick_out_of_stock() -> dict | None:
    prods = _list_products()
    for p in prods:
        sc = p.get("stock_count")
        if (sc is not None and int(sc) <= 0) or p.get("in_stock") is False:
            return p
    return None


def _clear_wishlist(headers: dict) -> None:
    requests.delete(f"{BASE_URL}/api/wishlist", headers=headers, timeout=20)


def _clear_cart(headers: dict) -> None:
    """Best-effort: empty buyer's cart."""
    try:
        r = requests.get(f"{BASE_URL}/api/cart", headers=headers, timeout=10)
        if r.status_code == 200:
            for item in (r.json() or {}).get("items", []):
                pid = item.get("product_id")
                if pid:
                    requests.delete(
                        f"{BASE_URL}/api/cart/{pid}",
                        headers=headers, timeout=10,
                    )
    except Exception:
        pass


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def buyer() -> dict:
    return _login_buyer()


@pytest.fixture(scope="module")
def in_stock_products() -> list[dict]:
    return _pick_in_stock(4)


@pytest.fixture(scope="module")
def oos_product() -> dict | None:
    return _pick_out_of_stock()


@pytest.fixture(autouse=True)
def _reset_state(buyer):
    """Fresh wishlist + cart before each test."""
    _clear_wishlist(buyer["headers"])
    _clear_cart(buyer["headers"])
    yield
    _clear_wishlist(buyer["headers"])
    _clear_cart(buyer["headers"])


# ---------- Auth regression for new endpoints ----------
class TestNewEndpointsAuth:
    def test_move_to_cart_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/wishlist/move-to-cart",
            json={"product_ids": []},
            timeout=20,
        )
        assert r.status_code == 401

    def test_remove_bulk_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/wishlist/remove-bulk",
            json={"product_ids": ["x"]},
            timeout=20,
        )
        assert r.status_code == 401

    def test_clear_requires_auth(self):
        r = requests.delete(f"{BASE_URL}/api/wishlist", timeout=20)
        assert r.status_code == 401


# ---------- Sort ----------
class TestSort:
    def test_default_sort_recent(self, buyer, in_stock_products):
        # add 3 in chronological order
        for p in in_stock_products[:3]:
            requests.post(
                f"{BASE_URL}/api/wishlist/{p['id']}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.get(
            f"{BASE_URL}/api/wishlist", headers=buyer["headers"], timeout=20
        )
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 3
        added_at = [it["added_at"] for it in items]
        assert added_at == sorted(added_at, reverse=True), \
            f"recent sort not desc: {added_at}"

    def test_sort_price_asc(self, buyer, in_stock_products):
        for p in in_stock_products[:3]:
            requests.post(
                f"{BASE_URL}/api/wishlist/{p['id']}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.get(
            f"{BASE_URL}/api/wishlist?sort=price_asc",
            headers=buyer["headers"], timeout=20,
        )
        assert r.status_code == 200
        prices = [it["price_nzd"] for it in r.json()]
        assert prices == sorted(prices), f"not ascending: {prices}"

    def test_sort_price_desc(self, buyer, in_stock_products):
        for p in in_stock_products[:3]:
            requests.post(
                f"{BASE_URL}/api/wishlist/{p['id']}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.get(
            f"{BASE_URL}/api/wishlist?sort=price_desc",
            headers=buyer["headers"], timeout=20,
        )
        assert r.status_code == 200
        prices = [it["price_nzd"] for it in r.json()]
        assert prices == sorted(prices, reverse=True), f"not desc: {prices}"

    def test_sort_name_ascending_case_insensitive(self, buyer, in_stock_products):
        for p in in_stock_products[:3]:
            requests.post(
                f"{BASE_URL}/api/wishlist/{p['id']}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.get(
            f"{BASE_URL}/api/wishlist?sort=name",
            headers=buyer["headers"], timeout=20,
        )
        assert r.status_code == 200
        names = [it["name"] for it in r.json()]
        lower = [n.lower() for n in names]
        assert lower == sorted(lower), f"name sort not case-insensitive A-Z: {names}"

    def test_invalid_sort_returns_422(self, buyer):
        r = requests.get(
            f"{BASE_URL}/api/wishlist?sort=banana",
            headers=buyer["headers"], timeout=20,
        )
        assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"


# ---------- Single-item regression ----------
class TestSingleItemRegression:
    def test_add_idempotent(self, buyer, in_stock_products):
        pid = in_stock_products[0]["id"]
        r1 = requests.post(
            f"{BASE_URL}/api/wishlist/{pid}", headers=buyer["headers"], timeout=20
        )
        assert r1.status_code == 201
        c1 = r1.json()["wishlist_count"]
        r2 = requests.post(
            f"{BASE_URL}/api/wishlist/{pid}", headers=buyer["headers"], timeout=20
        )
        assert r2.status_code == 201
        assert r2.json()["wishlist_count"] == c1

    def test_remove_single(self, buyer, in_stock_products):
        pid = in_stock_products[0]["id"]
        requests.post(
            f"{BASE_URL}/api/wishlist/{pid}", headers=buyer["headers"], timeout=20
        )
        r = requests.delete(
            f"{BASE_URL}/api/wishlist/{pid}", headers=buyer["headers"], timeout=20
        )
        assert r.status_code == 200
        assert r.json()["removed"] is True
        # verify gone
        ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=buyer["headers"], timeout=20
        ).json()
        assert pid not in ids


# ---------- Move to cart ----------
class TestMoveToCart:
    def test_move_specific_ids_remove_after(self, buyer, in_stock_products):
        pids = [p["id"] for p in in_stock_products[:3]]
        for pid in pids:
            requests.post(
                f"{BASE_URL}/api/wishlist/{pid}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/move-to-cart",
            headers=buyer["headers"],
            json={"product_ids": pids, "remove_after": True},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["moved"] == 3
        assert set(body["moved_ids"]) == set(pids)
        assert body["skipped"] == []
        assert body["wishlist_count"] == 0
        assert body["cart_count"] >= 3
        # verify cart actually has them
        cart = requests.get(
            f"{BASE_URL}/api/cart", headers=buyer["headers"], timeout=20
        ).json()
        cart_pids = {it["product_id"] for it in cart.get("items", [])}
        assert set(pids).issubset(cart_pids)
        # verify wishlist empty
        wl = requests.get(
            f"{BASE_URL}/api/wishlist", headers=buyer["headers"], timeout=20
        ).json()
        assert wl == []

    def test_move_increments_existing_cart_qty(self, buyer, in_stock_products):
        pid = in_stock_products[0]["id"]
        # add 1 to cart first
        requests.post(
            f"{BASE_URL}/api/cart",
            headers=buyer["headers"],
            json={"product_id": pid, "quantity": 1},
            timeout=20,
        )
        # add to wishlist and move
        requests.post(
            f"{BASE_URL}/api/wishlist/{pid}",
            headers=buyer["headers"], timeout=20,
        )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/move-to-cart",
            headers=buyer["headers"],
            json={"product_ids": [pid], "remove_after": True},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["moved"] == 1
        cart = requests.get(
            f"{BASE_URL}/api/cart", headers=buyer["headers"], timeout=20
        ).json()
        target = next(it for it in cart["items"] if it["product_id"] == pid)
        assert target["quantity"] >= 2

    def test_move_empty_body_moves_all_in_stock(self, buyer, in_stock_products):
        pids = [p["id"] for p in in_stock_products[:3]]
        for pid in pids:
            requests.post(
                f"{BASE_URL}/api/wishlist/{pid}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/move-to-cart",
            headers=buyer["headers"],
            json={"product_ids": [], "remove_after": True},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["moved"] == 3
        assert body["wishlist_count"] == 0

    def test_move_skips_out_of_stock(self, buyer, in_stock_products, oos_product):
        if not oos_product:
            pytest.skip("no out-of-stock product available in catalog")
        in_pid = in_stock_products[0]["id"]
        oos_pid = oos_product["id"]
        for pid in (in_pid, oos_pid):
            requests.post(
                f"{BASE_URL}/api/wishlist/{pid}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/move-to-cart",
            headers=buyer["headers"],
            json={"product_ids": [in_pid, oos_pid], "remove_after": True},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["moved"] == 1
        assert body["moved_ids"] == [in_pid]
        assert len(body["skipped"]) == 1
        assert body["skipped"][0]["product_id"] == oos_pid
        assert body["skipped"][0]["reason"] == "out_of_stock"
        # OOS item should remain in wishlist
        ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=buyer["headers"], timeout=20
        ).json()
        assert oos_pid in ids
        assert in_pid not in ids

    def test_move_remove_after_false_keeps_wishlist(self, buyer, in_stock_products):
        pid = in_stock_products[0]["id"]
        requests.post(
            f"{BASE_URL}/api/wishlist/{pid}",
            headers=buyer["headers"], timeout=20,
        )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/move-to-cart",
            headers=buyer["headers"],
            json={"product_ids": [pid], "remove_after": False},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["moved"] == 1
        # still in wishlist
        ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=buyer["headers"], timeout=20
        ).json()
        assert pid in ids


# ---------- Remove bulk ----------
class TestRemoveBulk:
    def test_remove_bulk_deletes_multiple(self, buyer, in_stock_products):
        pids = [p["id"] for p in in_stock_products[:3]]
        for pid in pids:
            requests.post(
                f"{BASE_URL}/api/wishlist/{pid}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/remove-bulk",
            headers=buyer["headers"],
            json={"product_ids": pids[:2]},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["removed"] == 2
        assert body["wishlist_count"] == 1
        # only pids[2] remains
        remaining = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=buyer["headers"], timeout=20
        ).json()
        assert remaining == [pids[2]]

    def test_remove_bulk_empty_list_is_noop(self, buyer, in_stock_products):
        pid = in_stock_products[0]["id"]
        requests.post(
            f"{BASE_URL}/api/wishlist/{pid}",
            headers=buyer["headers"], timeout=20,
        )
        r = requests.post(
            f"{BASE_URL}/api/wishlist/remove-bulk",
            headers=buyer["headers"],
            json={"product_ids": []},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["removed"] == 0
        assert body["wishlist_count"] == 1


# ---------- Clear all ----------
class TestClearAll:
    def test_clear_empties_entire_wishlist(self, buyer, in_stock_products):
        pids = [p["id"] for p in in_stock_products[:3]]
        for pid in pids:
            requests.post(
                f"{BASE_URL}/api/wishlist/{pid}",
                headers=buyer["headers"], timeout=20,
            )
        r = requests.delete(
            f"{BASE_URL}/api/wishlist", headers=buyer["headers"], timeout=20
        )
        assert r.status_code == 200
        body = r.json()
        assert body["removed"] == 3
        assert body["wishlist_count"] == 0
        # verify
        ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=buyer["headers"], timeout=20
        ).json()
        assert ids == []

    def test_clear_when_empty_returns_zero(self, buyer):
        r = requests.delete(
            f"{BASE_URL}/api/wishlist", headers=buyer["headers"], timeout=20
        )
        assert r.status_code == 200
        assert r.json()["removed"] == 0
        assert r.json()["wishlist_count"] == 0
