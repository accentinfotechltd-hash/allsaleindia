"""Seller profile / settings endpoint tests."""
import os
import requests

from test_seller import BASE_URL, _valid_business  # noqa: E402


def _register_seller():
    payload = {
        "email": f"profiletest_{os.urandom(4).hex()}@example.com",
        "password": "Allsale1!safe",
        "business": _valid_business(),
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["access_token"], body["user"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


class TestSellerProfileSettings:
    def test_get_settings_default_shape(self):
        token, _user = _register_seller()
        r = requests.get(
            f"{BASE_URL}/api/seller/profile/settings",
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # Required fields
        for k in [
            "email",
            "company_name",
            "verification_status",
            "contact_name",
            "contact_phone",
            "address_line1",
            "city",
            "state",
            "pincode",
            "notification_prefs",
        ]:
            assert k in d, f"missing key {k}"
        assert d["vacation_mode"] is False
        assert d["shipping_handling_days"] == 2
        prefs = d["notification_prefs"]
        assert prefs["new_order_email"] is True
        assert prefs["new_order_inapp"] is True

    def test_patch_basic_fields(self):
        token, _ = _register_seller()
        body = {
            "store_display_name": "Allsale Test Store",
            "store_bio": "Authentic handicrafts from Jaipur.",
            "support_email": "help@example.com",
            "shipping_handling_days": 3,
            "notification_prefs": {
                "new_order_email": False,
                "new_order_inapp": True,
                "return_request_email": True,
                "return_request_inapp": True,
                "payout_email": True,
                "payout_inapp": True,
                "low_stock_email": True,
                "low_stock_inapp": False,
            },
        }
        r = requests.patch(
            f"{BASE_URL}/api/seller/profile/settings",
            json=body,
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["store_display_name"] == "Allsale Test Store"
        assert d["store_bio"].startswith("Authentic")
        assert d["support_email"] == "help@example.com"
        assert d["shipping_handling_days"] == 3
        assert d["notification_prefs"]["new_order_email"] is False
        assert d["notification_prefs"]["low_stock_email"] is True

    def test_bank_account_stores_last4_only(self):
        token, _ = _register_seller()
        body = {
            "bank_holder_name": "Test Holder",
            "bank_name": "State Bank of India",
            "bank_ifsc": "SBIN0001234",
            "bank_account_number": "0123456789",
        }
        r = requests.patch(
            f"{BASE_URL}/api/seller/profile/settings",
            json=body,
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["bank_account_last4"] == "6789"
        assert d["bank_ifsc"] == "SBIN0001234"

    def test_invalid_ifsc_rejected(self):
        token, _ = _register_seller()
        r = requests.patch(
            f"{BASE_URL}/api/seller/profile/settings",
            json={"bank_ifsc": "BADCODE"},
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code in (400, 422)

    def test_vacation_mode_hides_listings(self):
        # Register a seller, but they need approval to list — so we will only
        # exercise the toggle persistence here.
        token, _ = _register_seller()
        r = requests.patch(
            f"{BASE_URL}/api/seller/profile/settings",
            json={
                "vacation_mode": True,
                "vacation_message": "Back next week",
            },
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["vacation_mode"] is True

    def test_change_password_invalidates_old_token(self):
        token, _ = _register_seller()
        # Change password
        r = requests.post(
            f"{BASE_URL}/api/seller/profile/password",
            json={"current_password": "Allsale1!safe", "new_password": "NewPass1234"},
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        new_token = r.json()["access_token"]
        assert new_token

        # Old token should now be rejected
        r2 = requests.get(
            f"{BASE_URL}/api/seller/profile/settings",
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r2.status_code == 401

        # New token should work
        r3 = requests.get(
            f"{BASE_URL}/api/seller/profile/settings",
            headers=_auth_headers(new_token),
            timeout=15,
        )
        assert r3.status_code == 200

    def test_wrong_current_password(self):
        token, _ = _register_seller()
        r = requests.post(
            f"{BASE_URL}/api/seller/profile/password",
            json={"current_password": "WrongPass99", "new_password": "Another1234"},
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 401

    def test_sign_out_all_revokes_other_tokens(self):
        token, _ = _register_seller()
        r = requests.post(
            f"{BASE_URL}/api/seller/profile/sign-out-all",
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        new_token = r.json()["access_token"]
        assert new_token != token

        # Old token rejected
        r_old = requests.get(
            f"{BASE_URL}/api/seller/profile/settings",
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r_old.status_code == 401

        # New token works
        r_new = requests.get(
            f"{BASE_URL}/api/seller/profile/settings",
            headers=_auth_headers(new_token),
            timeout=15,
        )
        assert r_new.status_code == 200

    def test_non_seller_blocked(self):
        # Register plain buyer
        r = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": f"buyer_{os.urandom(4).hex()}@example.com",
                "password": "Buyer12345",
                "full_name": "Buyer Test",
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        r2 = requests.get(
            f"{BASE_URL}/api/seller/profile/settings",
            headers=_auth_headers(token),
            timeout=15,
        )
        assert r2.status_code == 403
