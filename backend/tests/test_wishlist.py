"""Wishlist / Favorites — exhaustive backend tests.

Covers:
 - 401 on every endpoint without bearer token
 - GET /wishlist (hydrated list, sorted by added_at desc, skips deleted)
 - GET /wishlist/ids (lightweight ids)
 - POST /wishlist/{product_id} (idempotent add, 404 on bad product)
 - DELETE /wishlist/{product_id} (idempotent remove)
 - Cross-user isolation (user A's items never leak into user B)
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

# -- BASE_URL resolution (same as conftest) --
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    from pathlib import Path
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = (BASE_URL or "").rstrip("/")


# ---------- Helpers ----------

def _register_user(suffix: str) -> dict:
    """Register a new user, return {email, token, user_id, headers}."""
    email = f"TEST_wish_{suffix}_{uuid.uuid4().hex[:8]}@allsale.co.nz"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"Wish {suffix}"},
        timeout=20,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email,
        "token": data["access_token"],
        "user_id": data["user"]["id"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {data['access_token']}",
        },
    }


def _pick_real_products(n: int = 3) -> list[str]:
    """Pick `n` real seeded product ids that actually have hydratable fields.

    We deliberately skip rows whose name starts with TEST_ (those are leftover
    seeds from other test runs with no real seller, sometimes useful but we
    want stable hydration here)."""
    r = requests.get(f"{BASE_URL}/api/products?limit=200", timeout=20)
    assert r.status_code == 200
    products = r.json()
    real = [p for p in products if not p.get("name", "").startswith("TEST_")]
    pool = real if len(real) >= n else products
    assert len(pool) >= n, f"need {n} products, got {len(pool)}"
    return [p["id"] for p in pool[:n]]


# ---------- Module-scoped fixtures ----------

@pytest.fixture(scope="module")
def user_a() -> dict:
    return _register_user("A")


@pytest.fixture(scope="module")
def user_b() -> dict:
    return _register_user("B")


@pytest.fixture(scope="module")
def real_product_ids() -> list[str]:
    return _pick_real_products(3)


# ---------- Auth (401) ----------

class TestWishlistAuth:
    """All wishlist endpoints must require a bearer token."""

    def test_get_list_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/wishlist", timeout=20)
        assert r.status_code == 401

    def test_get_ids_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/wishlist/ids", timeout=20)
        assert r.status_code == 401

    def test_post_requires_auth(self, real_product_ids):
        r = requests.post(
            f"{BASE_URL}/api/wishlist/{real_product_ids[0]}", timeout=20
        )
        assert r.status_code == 401

    def test_delete_requires_auth(self, real_product_ids):
        r = requests.delete(
            f"{BASE_URL}/api/wishlist/{real_product_ids[0]}", timeout=20
        )
        assert r.status_code == 401

    def test_bad_bearer_token_rejected(self):
        r = requests.get(
            f"{BASE_URL}/api/wishlist",
            headers={"Authorization": "Bearer not.a.real.token"},
            timeout=20,
        )
        assert r.status_code == 401


# ---------- Core CRUD ----------

class TestWishlistCRUD:
    """Add/list/remove flows for a single user."""

    def test_initial_empty(self, user_a):
        r = requests.get(f"{BASE_URL}/api/wishlist", headers=user_a["headers"], timeout=20)
        assert r.status_code == 200
        assert r.json() == []

    def test_initial_ids_empty(self, user_a):
        r = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        )
        assert r.status_code == 200
        assert r.json() == []

    def test_add_unknown_product_404(self, user_a):
        r = requests.post(
            f"{BASE_URL}/api/wishlist/does-not-exist-{uuid.uuid4().hex[:6]}",
            headers=user_a["headers"],
            timeout=20,
        )
        assert r.status_code == 404

    def test_add_then_list(self, user_a, real_product_ids):
        pid = real_product_ids[0]
        r = requests.post(
            f"{BASE_URL}/api/wishlist/{pid}", headers=user_a["headers"], timeout=20
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["added"] is True
        assert body["wishlist_count"] >= 1

        # GET /wishlist
        r2 = requests.get(
            f"{BASE_URL}/api/wishlist", headers=user_a["headers"], timeout=20
        )
        assert r2.status_code == 200
        items = r2.json()
        assert any(it["product_id"] == pid for it in items)
        # hydration fields
        item = next(it for it in items if it["product_id"] == pid)
        for k in (
            "name", "image", "price_nzd", "price_inr", "category",
            "rating", "reviews_count", "in_stock", "added_at",
        ):
            assert k in item, f"missing {k} in hydrated row"
        assert isinstance(item["price_nzd"], (int, float))
        assert isinstance(item["price_inr"], (int, float))
        assert isinstance(item["in_stock"], bool)
        assert item["added_at"]  # non-empty ISO string

        # GET /wishlist/ids
        r3 = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        )
        assert r3.status_code == 200
        ids = r3.json()
        assert pid in ids
        assert all(isinstance(x, str) for x in ids)

    def test_add_is_idempotent(self, user_a, real_product_ids):
        pid = real_product_ids[0]
        # First add already happened in previous test; do it again
        r1 = requests.post(
            f"{BASE_URL}/api/wishlist/{pid}", headers=user_a["headers"], timeout=20
        )
        assert r1.status_code == 201
        count1 = r1.json()["wishlist_count"]

        r2 = requests.post(
            f"{BASE_URL}/api/wishlist/{pid}", headers=user_a["headers"], timeout=20
        )
        assert r2.status_code == 201
        count2 = r2.json()["wishlist_count"]
        assert count1 == count2, "duplicate add must not change wishlist_count"

        # IDs list should contain pid exactly once
        ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        ).json()
        assert ids.count(pid) == 1

    def test_sorted_by_added_at_desc(self, user_a, real_product_ids):
        # Add two more products with a small delay → newest first
        pid2, pid3 = real_product_ids[1], real_product_ids[2]
        r = requests.post(
            f"{BASE_URL}/api/wishlist/{pid2}", headers=user_a["headers"], timeout=20
        )
        assert r.status_code == 201
        time.sleep(1.1)  # ensure distinct ISO seconds
        r = requests.post(
            f"{BASE_URL}/api/wishlist/{pid3}", headers=user_a["headers"], timeout=20
        )
        assert r.status_code == 201

        items = requests.get(
            f"{BASE_URL}/api/wishlist", headers=user_a["headers"], timeout=20
        ).json()
        added_at_list = [it["added_at"] for it in items]
        # Strict descending order
        assert added_at_list == sorted(added_at_list, reverse=True), (
            f"expected desc, got {added_at_list}"
        )
        # newest is pid3
        assert items[0]["product_id"] == pid3

    def test_delete_removes_and_returns_count(self, user_a, real_product_ids):
        pid = real_product_ids[1]
        before = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        ).json()
        assert pid in before

        r = requests.delete(
            f"{BASE_URL}/api/wishlist/{pid}", headers=user_a["headers"], timeout=20
        )
        assert r.status_code == 200
        body = r.json()
        assert body["removed"] is True
        assert body["wishlist_count"] == len(before) - 1

        after = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        ).json()
        assert pid not in after

    def test_delete_idempotent_on_missing(self, user_a, real_product_ids):
        pid = real_product_ids[1]  # already removed above
        r1 = requests.delete(
            f"{BASE_URL}/api/wishlist/{pid}", headers=user_a["headers"], timeout=20
        )
        assert r1.status_code == 200
        assert r1.json()["removed"] is True
        c1 = r1.json()["wishlist_count"]

        r2 = requests.delete(
            f"{BASE_URL}/api/wishlist/{pid}", headers=user_a["headers"], timeout=20
        )
        assert r2.status_code == 200
        assert r2.json()["removed"] is True
        assert r2.json()["wishlist_count"] == c1

    def test_delete_unknown_product_still_200(self, user_a):
        """DELETE on a never-added (or non-existent) product id is a no-op 200."""
        r = requests.delete(
            f"{BASE_URL}/api/wishlist/does-not-exist-{uuid.uuid4().hex[:6]}",
            headers=user_a["headers"],
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["removed"] is True


# ---------- Cross-user isolation ----------

class TestWishlistIsolation:
    """User A's adds must never appear for user B."""

    def test_b_starts_empty(self, user_b):
        r = requests.get(f"{BASE_URL}/api/wishlist", headers=user_b["headers"], timeout=20)
        assert r.status_code == 200
        assert r.json() == []
        r2 = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_b["headers"], timeout=20
        )
        assert r2.status_code == 200
        assert r2.json() == []

    def test_b_isolated_from_a(self, user_a, user_b, real_product_ids):
        # user_a has at least pid0 and pid3 still in their wishlist from earlier
        a_ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        ).json()
        assert len(a_ids) >= 1

        # user_b adds a DIFFERENT product
        pid_b = real_product_ids[1]  # was removed from A
        r = requests.post(
            f"{BASE_URL}/api/wishlist/{pid_b}", headers=user_b["headers"], timeout=20
        )
        assert r.status_code == 201
        assert r.json()["wishlist_count"] == 1

        # B's list must contain only pid_b and none of A's
        b_ids = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_b["headers"], timeout=20
        ).json()
        assert b_ids == [pid_b]
        for aid in a_ids:
            assert aid not in b_ids, "A's items leaked into B"

        # And A's list must NOT have changed because of B
        a_ids_after = requests.get(
            f"{BASE_URL}/api/wishlist/ids", headers=user_a["headers"], timeout=20
        ).json()
        assert set(a_ids_after) == set(a_ids)


# ---------- Cleanup ----------

@pytest.fixture(scope="module", autouse=True)
def _cleanup_wishlists(user_a, user_b, real_product_ids):
    """After all tests in module, clear wishlists for both test users."""
    yield
    for u in (user_a, user_b):
        for pid in real_product_ids:
            try:
                requests.delete(
                    f"{BASE_URL}/api/wishlist/{pid}",
                    headers=u["headers"],
                    timeout=10,
                )
            except Exception:
                pass
