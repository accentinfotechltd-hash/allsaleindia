"""Shared pytest fixtures for Allsale backend tests."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # Fallback to frontend/.env
    from pathlib import Path
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def test_user(api_client):
    """Register or login a deterministic test user."""
    # Use unique email per session run to avoid stale-state issues
    suffix = int(time.time())
    email = f"TEST_user_{suffix}@allsale.co.nz"
    password = "Test1234!"
    full_name = "Allsale Tester"
    r = api_client.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "full_name": full_name},
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email,
        "password": password,
        "full_name": full_name,
        "user": data["user"],
        "token": data["access_token"],
    }


@pytest.fixture(scope="session")
def auth_headers(test_user):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {test_user['token']}",
    }
