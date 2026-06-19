"""Iteration 35 — Saved addresses CRUD + loyalty points apply/remove on cart.

Backend regression for the checkout-wiring iteration. Uses the seeded buyer
buyer@example.com / Buyer2026! so balances/cart items can persist across runs.

Test plan:
  Addresses
    1. List addresses (200, default-first ordering).
    2. Create new address (201) — also handles first-ever auto-default.
    3. PATCH address fields.
    4. POST /addresses/{id}/default — flips default flag.
    5. DELETE address — promotes another to default if it was default.
  Points
    6. GET /points/balance returns balance + redeem_rate_per_nzd.
    7. POST /cart/points {points: N} applies, GET /cart shows points_used + points_discount_nzd.
    8. DELETE /cart/points clears it.
"""
from __future__ import annotations

import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or ""
).rstrip("/")
if not BASE_URL:
    from pathlib import Path
    env_text = Path("/app/frontend/.env").read_text()
    for line in env_text.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

BUYER_EMAIL = "buyer@example.com"
BUYER_PASSWORD = "Buyer2026!"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def buyer_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"buyer login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    assert token
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def cleanup_addresses(buyer_headers):
    """Track addresses created in this module so we can clean them up."""
    created: list[str] = []
    yield created
    for aid in created:
        try:
            requests.delete(
                f"{BASE_URL}/api/account/addresses/{aid}",
                headers=buyer_headers,
                timeout=15,
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Saved addresses CRUD
# ---------------------------------------------------------------------------
class TestSavedAddresses:
    def test_list_addresses_initial(self, buyer_headers):
        r = requests.get(
            f"{BASE_URL}/api/account/addresses", headers=buyer_headers, timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "addresses" in data
        assert isinstance(data["addresses"], list)
        # If non-empty, default must be first.
        if data["addresses"]:
            assert data["addresses"][0].get("is_default") is True

    def test_create_address(self, buyer_headers, cleanup_addresses):
        payload = {
            "label": "TEST_Home",
            "full_name": "TEST Buyer",
            "phone": "+64211234567",
            "line1": "TEST 123 Queen Street",
            "city": "Auckland",
            "state": "Auckland",
            "postal_code": "1010",
            "country": "NZ",
            "is_default": False,
        }
        r = requests.post(
            f"{BASE_URL}/api/account/addresses",
            json=payload,
            headers=buyer_headers,
            timeout=15,
        )
        assert r.status_code == 201, r.text
        addr = r.json()
        assert addr["id"].startswith("addr_")
        assert addr["label"] == "TEST_Home"
        assert addr["country"] == "NZ"
        cleanup_addresses.append(addr["id"])

        # Confirm persisted via GET
        list_r = requests.get(
            f"{BASE_URL}/api/account/addresses", headers=buyer_headers, timeout=15
        )
        ids = [a["id"] for a in list_r.json()["addresses"]]
        assert addr["id"] in ids

    def test_patch_address(self, buyer_headers, cleanup_addresses):
        # Create a fresh one
        payload = {
            "label": "TEST_Work",
            "full_name": "TEST Buyer Work",
            "line1": "TEST 1 Office Park",
            "city": "Wellington",
            "state": "Wellington",
            "postal_code": "6011",
            "country": "NZ",
        }
        r = requests.post(
            f"{BASE_URL}/api/account/addresses",
            json=payload,
            headers=buyer_headers,
            timeout=15,
        )
        assert r.status_code == 201, r.text
        addr_id = r.json()["id"]
        cleanup_addresses.append(addr_id)

        # Patch label
        pr = requests.patch(
            f"{BASE_URL}/api/account/addresses/{addr_id}",
            json={"label": "TEST_Work_Updated", "phone": "+64211999111"},
            headers=buyer_headers,
            timeout=15,
        )
        assert pr.status_code == 200, pr.text
        updated = pr.json()
        assert updated["label"] == "TEST_Work_Updated"
        assert updated["phone"] == "+64211999111"

    def test_set_default(self, buyer_headers, cleanup_addresses):
        # Need at least one address to flip — create one.
        payload = {
            "label": "TEST_DefaultTarget",
            "full_name": "TEST Default",
            "line1": "TEST 99 Lambton Quay",
            "city": "Wellington",
            "state": "Wellington",
            "postal_code": "6011",
            "country": "NZ",
        }
        r = requests.post(
            f"{BASE_URL}/api/account/addresses",
            json=payload,
            headers=buyer_headers,
            timeout=15,
        )
        assert r.status_code == 201
        addr_id = r.json()["id"]
        cleanup_addresses.append(addr_id)

        flip = requests.post(
            f"{BASE_URL}/api/account/addresses/{addr_id}/default",
            headers=buyer_headers,
            timeout=15,
        )
        assert flip.status_code == 200, flip.text
        assert flip.json()["default_id"] == addr_id

        # Confirm via list — first item should be this id.
        lr = requests.get(
            f"{BASE_URL}/api/account/addresses", headers=buyer_headers, timeout=15
        )
        assert lr.status_code == 200
        addrs = lr.json()["addresses"]
        assert addrs[0]["id"] == addr_id
        assert addrs[0]["is_default"] is True
        # Only one default
        defaults = [a for a in addrs if a.get("is_default")]
        assert len(defaults) == 1

    def test_delete_promotes_default(self, buyer_headers, cleanup_addresses):
        # Create A (default) and B (non-default).
        a = requests.post(
            f"{BASE_URL}/api/account/addresses",
            json={
                "label": "TEST_A",
                "full_name": "A",
                "line1": "TEST A",
                "city": "Auckland",
                "state": "AKL",
                "postal_code": "1010",
                "country": "NZ",
            },
            headers=buyer_headers,
            timeout=15,
        )
        assert a.status_code == 201
        a_id = a.json()["id"]
        cleanup_addresses.append(a_id)

        b = requests.post(
            f"{BASE_URL}/api/account/addresses",
            json={
                "label": "TEST_B",
                "full_name": "B",
                "line1": "TEST B",
                "city": "Auckland",
                "state": "AKL",
                "postal_code": "1010",
                "country": "NZ",
            },
            headers=buyer_headers,
            timeout=15,
        )
        assert b.status_code == 201
        b_id = b.json()["id"]
        cleanup_addresses.append(b_id)

        # Make A default
        requests.post(
            f"{BASE_URL}/api/account/addresses/{a_id}/default",
            headers=buyer_headers,
            timeout=15,
        )

        # Delete A
        dr = requests.delete(
            f"{BASE_URL}/api/account/addresses/{a_id}",
            headers=buyer_headers,
            timeout=15,
        )
        assert dr.status_code == 204
        if a_id in cleanup_addresses:
            cleanup_addresses.remove(a_id)

        # Verify default got promoted to some other address.
        lr = requests.get(
            f"{BASE_URL}/api/account/addresses", headers=buyer_headers, timeout=15
        )
        addrs = lr.json()["addresses"]
        # A should be gone
        assert all(x["id"] != a_id for x in addrs)
        # Exactly one default remains
        defaults = [x for x in addrs if x.get("is_default")]
        assert len(defaults) == 1


# ---------------------------------------------------------------------------
# Points balance + cart redemption
# ---------------------------------------------------------------------------
class TestPointsOnCart:
    def test_balance_shape(self, buyer_headers):
        r = requests.get(
            f"{BASE_URL}/api/points/balance", headers=buyer_headers, timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for field in (
            "balance",
            "monetary_value_nzd",
            "redeem_rate_per_nzd",
            "earn_rate_per_nzd",
        ):
            assert field in data, f"missing {field}"
        assert isinstance(data["balance"], int)
        assert data["redeem_rate_per_nzd"] == 100

    def _ensure_cart_with_item(self, buyer_headers):
        """Return cart dict; add a product if empty."""
        r = requests.get(f"{BASE_URL}/api/cart", headers=buyer_headers, timeout=15)
        assert r.status_code == 200, r.text
        cart = r.json()
        if cart.get("items"):
            return cart

        pr = requests.get(
            f"{BASE_URL}/api/products", params={"limit": 5}, timeout=15
        )
        assert pr.status_code == 200, pr.text
        products = pr.json().get("items") or pr.json().get("products") or []
        if not products and isinstance(pr.json(), list):
            products = pr.json()
        assert products, "No products available to seed cart"
        prod_id = products[0]["id"]
        add = requests.post(
            f"{BASE_URL}/api/cart",
            json={"product_id": prod_id, "quantity": 1},
            headers=buyer_headers,
            timeout=15,
        )
        assert add.status_code == 200, add.text
        return add.json()

    def test_apply_and_remove_points(self, buyer_headers):
        # Need positive balance to redeem
        bal = requests.get(
            f"{BASE_URL}/api/points/balance", headers=buyer_headers, timeout=15
        ).json()
        if bal["balance"] < 100:
            pytest.skip(
                f"Buyer has {bal['balance']} pts — needs ≥100 to redeem. Seed not run?"
            )

        cart = self._ensure_cart_with_item(buyer_headers)
        if cart["subtotal_nzd"] < 2.0:
            pytest.skip(
                f"Cart subtotal {cart['subtotal_nzd']} too low to redeem 100 pts"
            )

        # Apply 100 pts
        ap = requests.post(
            f"{BASE_URL}/api/cart/points",
            json={"points": 100},
            headers=buyer_headers,
            timeout=15,
        )
        assert ap.status_code == 200, ap.text
        applied = ap.json()
        assert applied.get("points_used", 0) >= 100
        assert applied.get("points_discount_nzd", 0) >= 1.0

        # Confirm via GET /cart
        gc = requests.get(f"{BASE_URL}/api/cart", headers=buyer_headers, timeout=15)
        assert gc.status_code == 200
        gcart = gc.json()
        assert gcart["points_used"] == applied["points_used"]
        assert (
            abs(gcart["points_discount_nzd"] - applied["points_discount_nzd"]) < 0.01
        )

        # Remove
        rm = requests.delete(
            f"{BASE_URL}/api/cart/points", headers=buyer_headers, timeout=15
        )
        assert rm.status_code == 200, rm.text
        removed = rm.json()
        assert (removed.get("points_used") or 0) == 0
        assert (removed.get("points_discount_nzd") or 0) == 0
