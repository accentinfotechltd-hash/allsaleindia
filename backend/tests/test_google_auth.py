"""Google OAuth session-exchange endpoint tests (iteration 2)."""
import time


# /api/auth/google-session: invalid session -> 401 with specific detail
def test_google_session_invalid_session_id_401(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/auth/google-session",
        json={"session_id": "totally-bogus-session-id-xyz-12345"},
    )
    assert r.status_code == 401, r.text
    detail = r.json().get("detail", "")
    assert "invalid" in detail.lower() or "expired" in detail.lower()


# Missing session_id -> 422 validation error
def test_google_session_missing_field_422(api_client, base_url):
    r = api_client.post(f"{base_url}/api/auth/google-session", json={})
    assert r.status_code == 422


# Empty session_id string is still accepted by Pydantic but should 401 from provider
def test_google_session_empty_session_id_401(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/auth/google-session",
        json={"session_id": ""},
    )
    # Provider returns non-200 for empty -> our code maps to 401
    assert r.status_code in (401, 422)


# Register: returned UserPublic now exposes provider='email' and picture=null
def test_register_includes_provider_and_picture(api_client, base_url):
    email = f"TEST_iter2_reg_{int(time.time()*1000)}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Iter2 Reg"},
    )
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u.get("provider") == "email"
    assert u.get("picture") in (None, "")


# /auth/me now includes picture + provider fields
def test_me_includes_provider_and_picture(api_client, base_url, auth_headers):
    r = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "provider" in body
    assert "picture" in body
    assert body["provider"] == "email"


# Regression: /auth/login still works and returns provider='email'
def test_login_returns_provider_email(api_client, base_url, test_user):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": test_user["email"], "password": test_user["password"]},
    )
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    assert u.get("provider") == "email"
