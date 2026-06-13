"""Seller (business onboarding, listings, admin approval) tests."""
import os
import random
import string
import time
import requests
import pytest


def _gstin():
    """Unique GSTIN that satisfies the regex AND PAN==GSTIN[2:12]."""
    from _helpers import make_gstin_pan

    gstin, _ = make_gstin_pan()
    return gstin


def _gstin_pan():
    from _helpers import make_gstin_pan

    return make_gstin_pan()

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
    g, p = _gstin_pan()
    b = {
        "business_type": "private_limited",
        "company_name": "TEST Allsale Crafts Pvt Ltd",
        "gstin": g,
        "pan": p,
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
    def test_register_starts_pending_documents(self, api_client):
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
        # New flow: seller starts as pending_documents (NOT auto-verified).
        assert u["seller_verified"] is False

        headers = {"Authorization": f"Bearer {data['access_token']}"}
        me = api_client.get(f"{BASE_URL}/api/seller/me", headers=headers)
        assert me.status_code == 200
        prof = me.json()
        assert prof["verification_status"] == "pending_documents"
        assert prof["gstin"] == biz["gstin"]
        assert prof["pan"] == biz["pan"]
        assert prof["company_name"] == "TEST Allsale Crafts Pvt Ltd"

        # Status endpoint exposes lifecycle fields.
        status = api_client.get(
            f"{BASE_URL}/api/seller/me/status", headers=headers
        ).json()
        assert status["status"] == "pending_documents"
        assert status["has_id_proof"] is False
        assert status["has_business_proof"] is False

        # Cannot list products until approved.
        listing_attempt = api_client.post(
            f"{BASE_URL}/api/seller/products",
            headers=headers,
            json={
                "name": "Pre-approval saree",
                "description": "x",
                "category": "Sarees",
                "price_nzd": 50,
                "images": ["data:image/png;base64,iVBORw0KGgo="],
                "stock_count": 10,
                "shipping_days_min": 7,
                "shipping_days_max": 14,
            },
        )
        assert listing_attempt.status_code == 403
        assert "ID proof" in listing_attempt.json()["detail"]

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

    def test_duplicate_gstin_returns_409(self, api_client):
        """Registering a 2nd seller with the same GSTIN returns 409, not 500."""
        biz = _valid_business()
        # First registration succeeds
        r1 = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": f"TEST_dup1_{_ts()}@allsale.co.nz", "password": "Test1234!", "business": biz},
        )
        assert r1.status_code == 200, r1.text
        # Second registration with the same GSTIN should be a clean 409
        r2 = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": f"TEST_dup2_{_ts()}@allsale.co.nz", "password": "Test1234!", "business": biz},
        )
        assert r2.status_code == 409, r2.text
        assert "GSTIN" in r2.json()["detail"]

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
        # New flow: upgraded sellers also start at pending_documents (not auto-verified).
        assert u["seller_verified"] is False

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
def _approve_seller_via_db(user_id: str) -> None:
    """Test helper: bypass the 7-day review by directly marking the seller approved.

    The full register → upload docs → admin approve flow is exercised by
    `TestSellerRegister` and `TestSellerApprovalFlow`. Listing/CRUD tests just
    need a working seller, so we shortcut here using sync pymongo.
    """
    import os
    from dotenv import load_dotenv
    from pymongo import MongoClient

    load_dotenv("/app/backend/.env", override=True)
    cli = MongoClient(os.environ["MONGO_URL"])
    db_ = cli[os.environ.get("DB_NAME", "allsale_database")]
    db_.users.update_one({"id": user_id}, {"$set": {"seller_verification_status": "approved"}})
    db_.sellers.update_one(
        {"user_id": user_id},
        {"$set": {
            "verification_status": "approved",
            "id_proof_url": "https://test.local/id.jpg",
            "business_proof_url": "https://test.local/biz.jpg",
        }},
    )
    cli.close()


@pytest.fixture(scope="module")
def seller_token(api_client):
    email = f"TEST_listing_seller_{_ts()}@allsale.co.nz"
    r = api_client.post(
        f"{BASE_URL}/api/seller/register",
        json={"email": email, "password": "Test1234!", "business": _valid_business()},
    )
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["id"]
    _approve_seller_via_db(uid)
    return {"token": r.json()["access_token"], "user_id": uid}


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
        g, p = _gstin_pan()
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": email, "password": "Test1234!",
                  "business": _valid_business({"gstin": g, "pan": p})},
        )
        assert r.status_code == 200
        b_token = r.json()["access_token"]
        _approve_seller_via_db(r.json()["user"]["id"])

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
        g, p = _gstin_pan()
        r = api_client.post(
            f"{BASE_URL}/api/seller/register",
            json={"email": email, "password": "Test1234!",
                  "business": _valid_business({"gstin": g, "pan": p})},
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
