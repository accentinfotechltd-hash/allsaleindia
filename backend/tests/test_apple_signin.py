"""Apple Sign-In integration tests.

We don't have access to real Apple identity tokens in CI, so we monkey-patch
`verify_apple_identity_token` to return synthetic claims. The router tests
focus on the user-finding / linking / creation logic and the public response
shape — which is the part most likely to regress on us.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient

# Allow `from server import app, db` when tests run from repo root.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import app  # noqa: E402
from routers import auth as auth_router  # noqa: E402

# Sync Mongo client for setup/teardown — TestClient closes the asyncio event
# loop after each request, which makes motor unusable. PyMongo is sync and
# stays valid for the whole test session.
_MONGO = MongoClient(os.environ.get("MONGO_URL") or "mongodb://localhost:27017")
_DB_NAME = os.environ.get("DB_NAME") or "allsale_database"
_users = _MONGO[_DB_NAME]["users"]


@pytest.fixture(scope="module")
def client():
    """Session-wide TestClient inside a ``with`` block so the underlying
    portal/event-loop stays alive for ALL tests in this module. This avoids
    motor (async Mongo) binding to a loop that the next test would close."""
    original_verify = auth_router.verify_apple_identity_token
    with TestClient(app) as c:
        yield c
    # Restore the real verifier so other test modules / processes aren't
    # left with a stub that always succeeds.
    auth_router.verify_apple_identity_token = original_verify  # type: ignore[assignment]


def _stub_verify(claims: dict):
    """Replace verify_apple_identity_token with a stub that returns `claims`."""
    async def _fake(token: str):
        return claims

    auth_router.verify_apple_identity_token = _fake  # type: ignore[assignment]


def _ip_headers() -> dict:
    """Return a unique X-Forwarded-For header so each test maps to a fresh
    rate-limit bucket. The /auth/apple-session route is capped at 10
    requests per IP per 60s — without this, parallel test cases collide."""
    return {"X-Forwarded-For": f"10.{uuid.uuid4().int % 255}.{uuid.uuid4().int % 255}.{uuid.uuid4().int % 255}"}


def test_apple_signin_creates_new_user(client: TestClient):
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    email = f"apple-test-{uuid.uuid4().hex[:6]}@privaterelay.appleid.com"
    _stub_verify({"sub": sub, "email": email, "is_private_email": True})

    res = client.post(
        "/api/auth/apple-session",
        json={"identity_token": "stub", "full_name": "Apple Tester"},
        headers=_ip_headers(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "access_token" in body and body["access_token"]
    assert body["user"]["email"] == email
    assert body["user"]["provider"] == "apple"
    assert body["user"]["email_verified"] is True
    assert body["user"]["full_name"] == "Apple Tester"

    # Cleanup
    _users.delete_one({"apple_sub": sub})


def test_apple_signin_reuses_user_on_second_call(client: TestClient):
    """Second sign-in with the same `sub` must return the same user id and
    not crash even when Apple omits the email claim (re-auth scenario).
    """
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    email = f"apple-test-{uuid.uuid4().hex[:6]}@privaterelay.appleid.com"

    _stub_verify({"sub": sub, "email": email, "is_private_email": True})
    first = client.post("/api/auth/apple-session", json={"identity_token": "stub"}, headers=_ip_headers())
    assert first.status_code == 200, first.text
    first_uid = first.json()["user"]["id"]

    # Apple often omits `email` on subsequent re-auths — make sure we don't
    # crash and we look up the existing user purely via `sub`.
    _stub_verify({"sub": sub})
    second = client.post("/api/auth/apple-session", json={"identity_token": "stub"}, headers=_ip_headers())
    assert second.status_code == 200, second.text
    assert second.json()["user"]["id"] == first_uid

    _users.delete_one({"apple_sub": sub})


def test_apple_signin_email_omitted_creates_synthetic_email(client: TestClient):
    """When Apple omits `email` on a FIRST sign-in (rare but possible after
    user revoked + re-granted), we must still create a valid user record.
    """
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    _stub_verify({"sub": sub})  # no email at all

    res = client.post("/api/auth/apple-session", json={"identity_token": "stub"}, headers=_ip_headers())
    assert res.status_code == 200, res.text
    body = res.json()
    # synthetic relay-style email derived from sub
    assert body["user"]["email"].startswith(sub)
    assert body["user"]["email"].endswith("@privaterelay.appleid.com")

    _users.delete_one({"apple_sub": sub})


def test_apple_signin_links_to_existing_email_user(client: TestClient):
    """If a verified, non-private Apple email matches an existing user record
    (e.g. created via Google or email/password), we should LINK them rather
    than create a duplicate account.
    """
    real_email = f"link-test-{uuid.uuid4().hex[:6]}@example.com"
    pre_uid = f"user_{uuid.uuid4().hex[:12]}"
    _users.insert_one(
        {
            "id": pre_uid,
            "email": real_email,
            "full_name": "Pre-existing User",
            "provider": "google",
            "providers": ["google"],
            "country": "NZ",
        }
    )

    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    _stub_verify({"sub": sub, "email": real_email, "is_private_email": False})
    res = client.post("/api/auth/apple-session", json={"identity_token": "stub"}, headers=_ip_headers())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["id"] == pre_uid  # linked, not duplicated

    linked = _users.find_one({"id": pre_uid})
    assert linked["apple_sub"] == sub
    assert "apple" in (linked.get("providers") or [])

    _users.delete_one({"id": pre_uid})


def test_apple_signin_rejects_invalid_token(client: TestClient):
    """When token verification fails, the endpoint should return 401."""
    from fastapi import HTTPException

    async def _fail(token: str):
        raise HTTPException(status_code=401, detail="Bad token")

    auth_router.verify_apple_identity_token = _fail  # type: ignore[assignment]
    res = client.post("/api/auth/apple-session", json={"identity_token": "bad"}, headers=_ip_headers())
    assert res.status_code == 401


def test_apple_audience_env_override(monkeypatch):
    """`APPLE_BUNDLE_ID` env var should control allowed audiences."""
    monkeypatch.setenv(
        "APPLE_BUNDLE_ID", "com.example.foo, com.example.bar ,com.example.foo"
    )
    # Re-import to pick up the new env
    import importlib
    import services.apple_auth as apple_auth

    importlib.reload(apple_auth)
    assert apple_auth.ALLOWED_APPLE_AUDIENCES == (
        "com.example.foo",
        "com.example.bar",
    )
    assert apple_auth.APPLE_AUDIENCE == "com.example.foo"
