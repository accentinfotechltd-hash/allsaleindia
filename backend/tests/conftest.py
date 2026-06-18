"""Shared pytest fixtures for Allsale backend tests."""
import asyncio
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


# ---------------------------------------------------------------------------
# Session-wide event loop + thin sync-from-async helper.
#
# Why: most of our legacy tests touch motor (async MongoDB) inline from sync
# pytest functions. The old idiom ``asyncio.get_event_loop().run_until_complete(…)``
# was removed in Python 3.12 + pytest 9 (raises DeprecationWarning →
# RuntimeError at collection time). ``run_async()`` reuses a single
# session-wide loop, so 100s of test cases share one loop without
# leaking motor clients per call.
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def event_loop():
    """Session-wide event loop. Yielded so any other ``run_async()`` calls
    inside tests reuse the same loop."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    try:
        loop.close()
    except Exception:
        pass


def _get_or_create_loop():
    """Get the current loop or create one if none exists in this thread.
    Safe to call from sync test bodies."""
    try:
        loop = asyncio.get_event_loop_policy().get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
        return loop
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        return loop


def run_async(coro):
    """Run an async coroutine to completion from a sync test body. Drop-in
    replacement for the legacy ``asyncio.get_event_loop().run_until_complete(…)``
    pattern that broke under Python 3.12+ / pytest 9."""
    return _get_or_create_loop().run_until_complete(coro)


# Export ``run_async`` so legacy tests can ``from conftest import run_async``.
__all__ = ["run_async"]
