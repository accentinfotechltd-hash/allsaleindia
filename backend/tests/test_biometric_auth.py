"""Tests for biometric device-token authentication.

Covers:
  • POST /auth/biometric/pair (auth required) → 201 + raw token
  • POST /auth/biometric/login (no auth)      → JWT exchange
  • Wrong device_token → 401
  • Revoked device → 401
  • token_version bump invalidates pairing
  • Device cap (MAX_DEVICES_PER_USER) enforced
  • Revoke and list endpoints
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from db import db
from server import app
from routers.biometric_auth import MAX_DEVICES_PER_USER


@pytest.fixture
def transport():
    return ASGITransport(app=app)


async def _seed_user() -> tuple[str, str]:
    """Insert a verified user, return (user_id, jwt)."""
    from utils import hash_password, create_token
    uid = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({
        "id": uid,
        "email": f"{uid}@bio.test.local",
        "full_name": "Bio Tester",
        "country": "NZ",
        "email_verified": True,
        "password_hash": hash_password("Bio2026!"),
        "token_version": 0,
        "created_at": datetime.now(timezone.utc),
    })
    return uid, create_token(uid, token_version=0)


async def _cleanup(uid: str):
    await db.users.delete_one({"id": uid})
    await db.biometric_devices.delete_many({"user_id": uid})


async def test_pair_returns_token_and_persists_hash(transport):
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"device_name": "Sarah's iPhone", "platform": "ios"},
            )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["device_id"].startswith("bdev_")
        assert len(body["device_token"]) == 64  # 32 bytes hex
        # Server stores ONLY the hash, never the raw token
        doc = await db.biometric_devices.find_one({"device_id": body["device_id"]})
        assert doc["token_hash"] != body["device_token"]
        assert len(doc["token_hash"]) == 64  # SHA-256 hex
        assert doc["revoked"] is False
    finally:
        await _cleanup(uid)


async def test_biometric_login_returns_jwt(transport):
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            pair = await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"platform": "ios"},
            )
            body = pair.json()
            # Now log in WITHOUT the original JWT — only with device token.
            r = await c.post(
                "/api/auth/biometric/login",
                json={"device_id": body["device_id"], "device_token": body["device_token"]},
            )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["access_token"]
        assert out["user"]["id"] == uid
    finally:
        await _cleanup(uid)


async def test_wrong_token_returns_401(transport):
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            pair = await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"platform": "ios"},
            )
            body = pair.json()
            r = await c.post(
                "/api/auth/biometric/login",
                json={"device_id": body["device_id"], "device_token": "00" * 32},
            )
        assert r.status_code == 401
    finally:
        await _cleanup(uid)


async def test_revoke_blocks_login(transport):
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            pair = await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"platform": "ios"},
            )
            body = pair.json()
            await c.post(
                "/api/auth/biometric/revoke",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"device_id": body["device_id"]},
            )
            r = await c.post(
                "/api/auth/biometric/login",
                json={"device_id": body["device_id"], "device_token": body["device_token"]},
            )
        assert r.status_code == 401
        assert "revoked" in r.json()["detail"].lower()
    finally:
        await _cleanup(uid)


async def test_token_version_bump_invalidates_pairing(transport):
    """Simulate a password reset by bumping the user's token_version. The
    biometric device should be auto-revoked on the next login attempt."""
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            pair = await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"platform": "ios"},
            )
            body = pair.json()
            # Simulate password reset bumping token_version.
            await db.users.update_one({"id": uid}, {"$set": {"token_version": 1}})
            r = await c.post(
                "/api/auth/biometric/login",
                json={"device_id": body["device_id"], "device_token": body["device_token"]},
            )
        assert r.status_code == 401
        assert "invalidated" in r.json()["detail"].lower()
        # Device should now be marked revoked
        doc = await db.biometric_devices.find_one({"device_id": body["device_id"]})
        assert doc["revoked"] is True
    finally:
        await _cleanup(uid)


async def test_device_limit_enforced(transport):
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            # Pair MAX_DEVICES_PER_USER devices successfully
            for i in range(MAX_DEVICES_PER_USER):
                r = await c.post(
                    "/api/auth/biometric/pair",
                    headers={"Authorization": f"Bearer {jwt}"},
                    json={"device_name": f"Device {i}", "platform": "ios"},
                )
                assert r.status_code == 201
            # The next one should fail with 400 + clear error_code
            r = await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"device_name": "Too Many", "platform": "ios"},
            )
        assert r.status_code == 400
        assert r.json()["detail"]["error_code"] == "device_limit_reached"
    finally:
        await _cleanup(uid)


async def test_list_devices_returns_no_secrets(transport):
    uid, jwt = await _seed_user()
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            await c.post(
                "/api/auth/biometric/pair",
                headers={"Authorization": f"Bearer {jwt}"},
                json={"device_name": "iPad", "platform": "ios"},
            )
            r = await c.get(
                "/api/auth/biometric/devices",
                headers={"Authorization": f"Bearer {jwt}"},
            )
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        assert items[0]["device_name"] == "iPad"
        # Critical: response must NOT include the token hash or raw token
        assert "token_hash" not in items[0]
        assert "device_token" not in items[0]
    finally:
        await _cleanup(uid)
