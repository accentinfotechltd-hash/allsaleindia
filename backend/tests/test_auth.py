"""Auth flow tests: register / login / me."""
import time


def test_register_returns_user_and_token(api_client, base_url):
    email = f"TEST_register_{int(time.time()*1000)}@allsale.co.nz"
    payload = {"email": email, "password": "Test1234!", "full_name": "Reg User"}
    r = api_client.post(f"{base_url}/api/auth/register", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and isinstance(data["access_token"], str)
    assert data.get("token_type") == "bearer"
    u = data["user"]
    assert u["email"] == email.lower()
    assert u["full_name"] == "Reg User"
    assert u["id"].startswith("user_")


def test_register_duplicate_email_400(api_client, base_url, test_user):
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={
            "email": test_user["email"],
            "password": "Test1234!",
            "full_name": "Dup",
        },
    )
    assert r.status_code == 400
    assert "already" in r.json().get("detail", "").lower()


def test_login_success(api_client, base_url, test_user):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": test_user["email"], "password": test_user["password"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["user"]["email"] == test_user["email"].lower()


def test_login_invalid_password_401(api_client, base_url, test_user):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": test_user["email"], "password": "wrongpass!"},
    )
    assert r.status_code == 401


def test_login_unknown_user_401(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": "nobody_xyz@allsale.co.nz", "password": "whatever1"},
    )
    assert r.status_code == 401


def test_me_with_token(api_client, base_url, auth_headers, test_user):
    r = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == test_user["email"].lower()
    assert body["full_name"] == test_user["full_name"]


def test_me_missing_token_401(api_client, base_url):
    r = api_client.get(f"{base_url}/api/auth/me")
    assert r.status_code == 401


def test_me_invalid_token_401(api_client, base_url):
    r = api_client.get(
        f"{base_url}/api/auth/me",
        headers={"Authorization": "Bearer not.a.real.jwt"},
    )
    assert r.status_code == 401
