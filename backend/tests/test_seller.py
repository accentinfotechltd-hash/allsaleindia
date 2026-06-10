"""Seller (business onboarding, listings, admin approval) tests."""
import os
import random
import string
import time
import requests
import pytest


def _gstin():
    """Unique GSTIN that still satisfies the regex AND PAN==GSTIN[2:12]=ABCDE1234F."""
    entity = random.choice(string.ascii_uppercase + "123456789")
    check = random.choice(string.ascii_uppercase + string.digits)
    return f"27ABCDE1234F{entity}Z{check}"

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

ADMIN_SECRET = "allsale-admin-dev-secret"


def _ts():
    return int(time.time() * 1000)


def _valid_business(overrides=None):
    b = {
        "company_name": "TEST Allsale Crafts Pvt Ltd",
        "gstin": _gstin(),
        "pan": "ABCDE1234F",
        "cin": "U74999MH2020PTC123456",
        "address_line1": "12 Test Lane",
        "address_line2": "Andheri East",
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001",
        "contact_name": "Test Contact",
        "contact_phone": "+919999999999",
    }
    if overrides:
        b.update(overrides)
    return b


# --- /seller/register --------------------------------------------------------
class TestSellerRegister:
    def test_register_auto_verifies(self, api_client):
        email = f"TEST_seller_{_ts()}@allsale.co.nz"
        biz = _valid_business()
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": email, "password": "Test1234!", "business": biz},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data and data["access_token"]
        u = data["user"]
        assert u["email"] == email.lower()
        assert u["is_seller"] is True
        assert u["seller_verified"] is True

        # /seller/me returns profile
        headers = {"Authorization": f"Bearer {data['access_token']}"}
        me = api_client.get(f"{BASE_URL}/api/seller/me", headers=headers)
        assert me.status_code == 200
        prof = me.json()
        assert prof["verification_status"] == "auto_verified"
        assert prof["gstin"] == biz["gstin"]
        assert prof["pan"] == "ABCDE1234F"
        assert prof["company_name"] == "TEST Allsale Crafts Pvt Ltd"

    def test_invalid_gstin_400(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={
                "email": f"TEST_bad_gstin_{_ts()}@allsale.co.nz",
                "password": "Test1234!",
                "business": _valid_business({"gstin": "INVALIDGSTIN123"}),
            },
        )
        assert r.status_code == 400
        assert "GSTIN" in r.json()["detail"]

    def test_invalid_pan_400(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={
                "email": f"TEST_bad_pan_{_ts()}@allsale.co.nz",
                "password": "Test1234!",
                "business": _valid_business({"pan": "BADPAN1234"}),
            },
        )
        assert r.status_code == 400
        assert "PAN" in r.json()["detail"]

    def test_pan_must_match_gstin(self, api_client):
        # GSTIN has PAN at positions 2:12 → use mismatching PAN
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={
                "email": f"TEST_mismatch_{_ts()}@allsale.co.nz",
                "password": "Test1234!",
                "business": _valid_business({"pan": "XYZAB1234C"}),
            },
        )
        assert r.status_code == 400
        assert "PAN" in r.json()["detail"]

    def test_missing_required_fields_422(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={
                "email": f"TEST_missing_{_ts()}@allsale.co.nz",
                "password": "Test1234!",
                "business": {"gstin": "27ABCDE1234F1Z5", "pan": "ABCDE1234F"},
            },
        )
        assert r.status_code == 422


# --- /seller/upgrade --------------------------------------------------------
class TestSellerUpgrade:
    def test_upgrade_buyer_to_seller(self, api_client):
        # Create buyer first
        email = f"TEST_buyer_up_{_ts()}@allsale.co.nz"
        reg = api_client.post(
            f"{BASE_URL}/api/auth/register",
            json={"email": email, "password": "Test1234!", "full_name": "Buyer To Seller"},
        )
        assert reg.status_code == 200
        token = reg.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        up = api_client.post(
            f"{BASE_URL}/api/seller/upgrade",
            json={"business": _valid_business()},
            headers=headers,
        )
        assert up.status_code == 200, up.text
        u = up.json()
        assert u["is_seller"] is True
        assert u["seller_verified"] is True

        # /auth/me reflects change
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["is_seller"] is True

        # Second upgrade → 400
        up2 = api_client.post(
            f"{BASE_URL}/api/seller/upgrade",
            json={"business": _valid_business()},
            headers=headers,
        )
        assert up2.status_code == 400

    def test_upgrade_requires_token(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/seller/upgrade",
            json={"business": _valid_business()},
        )
        assert r.status_code == 401


# --- /seller/me -------------------------------------------------------------
class TestSellerMe:
    def test_non_seller_returns_404(self, api_client, auth_headers):
        # auth_headers is a buyer user from conftest
        r = api_client.get(f"{BASE_URL}/api/seller/me", headers=auth_headers)
        assert r.status_code == 404


# --- /seller/products -------------------------------------------------------
@pytest.fixture(scope="module")
def seller_token(api_client):
    email = f"TEST_listing_seller_{_ts()}@allsale.co.nz"
    r = api_client.post(
        f"{BASE_URL}/api/seller/register",
        json={"email": email, "password": "Test1234!", "business": _valid_business()},
    )
    assert r.status_code == 200, r.text
    return {"token": r.json()["access_token"], "user_id": r.json()["user"]["id"]}


class TestListings:
    def test_create_listing_appears_in_catalog(self, api_client, seller_token):
        headers = {"Authorization": f"Bearer {seller_token['token']}"}
        payload = {
            "name": "TEST Brass Lamp",
            "description": "A lovely test brass lamp from Moradabad.",
            "category": "Home & Decor",
            "price_nzd": 39.99,
            "image": "https://example.com/lamp.jpg",
        }
        r = api_client.post(f"{BASE_URL}/api/seller/products", json=payload, headers=headers)
        assert r.status_code == 200, r.text
        product = r.json()
        assert product["seller_id"] == seller_token["user_id"]
        assert product["seller_name"]
        assert product["price_nzd"] == 39.99
        pid = product["id"]

        # Appears in main catalog
        cat = api_client.get(f"{BASE_URL}/api/products")
        assert cat.status_code == 200
        ids = [p["id"] for p in cat.json()]
        assert pid in ids

        # Appears in /seller/products
        mine = api_client.get(f"{BASE_URL}/api/seller/products", headers=headers)
        assert mine.status_code == 200
        assert any(p["id"] == pid for p in mine.json())

        # Delete own
        d = api_client.delete(f"{BASE_URL}/api/seller/products/{pid}", headers=headers)
        assert d.status_code == 200
        assert d.json()["deleted"] is True

        # Delete again → 404
        d2 = api_client.delete(f"{BASE_URL}/api/seller/products/{pid}", headers=headers)
        assert d2.status_code == 404

    def test_create_listing_forbidden_for_non_seller(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/seller/products",
            json={
                "name": "Should Fail",
                "description": "A test description over 10 chars.",
                "category": "Misc",
                "price_nzd": 10.0,
                "image": "https://example.com/x.jpg",
            },
            headers=auth_headers,
        )
        assert r.status_code == 403

    def test_list_my_listings_isolated(self, api_client, seller_token):
        # Create second seller and verify isolation
        email = f"TEST_seller_b_{_ts()}@allsale.co.nz"
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": email, "password": "Test1234!",
                  "business": _valid_business({"gstin": "29ABCDE1234F" + random.choice(string.ascii_uppercase + "123456789") + "Z" + random.choice(string.ascii_uppercase + string.digits)})},
        )
        assert r.status_code == 200
        b_token = r.json()["access_token"]

        # Seller A creates a listing
        ha = {"Authorization": f"Bearer {seller_token['token']}"}
        a_listing = api_client.post(
            f"{BASE_URL}/api/seller/products",
            json={
                "name": "TEST_A_only",
                "description": "Only seller A should see this.",
                "category": "Home & Decor",
                "price_nzd": 22.0,
                "image": "https://example.com/a.jpg",
            },
            headers=ha,
        )
        assert a_listing.status_code == 200
        a_pid = a_listing.json()["id"]

        # Seller B's listings should NOT include A's listing
        hb = {"Authorization": f"Bearer {b_token}"}
        mine_b = api_client.get(f"{BASE_URL}/api/seller/products", headers=hb)
        assert mine_b.status_code == 200
        assert all(p["id"] != a_pid for p in mine_b.json())

        # B can't delete A's listing
        bad = api_client.delete(f"{BASE_URL}/api/seller/products/{a_pid}", headers=hb)
        assert bad.status_code == 404

        # Cleanup: A deletes
        api_client.delete(f"{BASE_URL}/api/seller/products/{a_pid}", headers=ha)


# --- /admin/sellers/{id}/approve --------------------------------------------
class TestAdminApprove:
    def test_admin_forbidden_without_header(self, api_client):
        # Create a seller first to have a target id
        email = f"TEST_admin_target_{_ts()}@allsale.co.nz"
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": email, "password": "Test1234!",
                  "business": _valid_business({"gstin": "07ABCDE1234F" + random.choice(string.ascii_uppercase + "123456789") + "Z" + random.choice(string.ascii_uppercase + string.digits)})},
        )
        assert r.status_code == 200
        uid = r.json()["user"]["id"]

        r1 = api_client.post(f"{BASE_URL}/api/admin/sellers/{uid}/approve")
        assert r1.status_code == 403

        r2 = api_client.post(
            f"{BASE_URL}/api/admin/sellers/{uid}/approve",
            headers={"X-Admin-Secret": "wrong"},
        )
        assert r2.status_code == 403

        r3 = api_client.post(
            f"{BASE_URL}/api/admin/sellers/{uid}/approve",
            headers={"X-Admin-Secret": ADMIN_SECRET},
        )
        assert r3.status_code == 200
        assert r3.json()["approved"] is True

    def test_admin_approve_unknown_user(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/admin/sellers/nope_unknown_id/approve",
            headers={"X-Admin-Secret": ADMIN_SECRET},
        )
        assert r.status_code == 404
