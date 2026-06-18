"""Resend-activation endpoint integration tests."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import requests
from conftest import run_async

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "http://localhost:8001")


def _new_email() -> str:
    return f"resend_{uuid.uuid4().hex[:8]}@allsale.dev"


def _bearer(t): return {"Authorization": f"Bearer {t}"}


def _join_with_token(email: str) -> tuple[dict, str]:
    """Join the programme and return (me, access_token)."""
    r = requests.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": f"Resend Test {email[:8]}",
        "email": email, "country": "NZ", "primary_platform": "instagram",
    }, timeout=10)
    assert r.status_code == 201, r.text
    body = r.json()
    return body["me"], body["access_token"]


def test_resend_activation_pending_path_then_rate_limited():
    """Pending user → application_received email re-sent; second call within
    the cool-down → 429 with Retry-After header."""
    email = _new_email()
    me, token = _join_with_token(email)

    # First call → 200 + kind="application_received"
    r1 = requests.post(f"{BASE_URL}/api/ambassadors/resend-activation",
                       headers=_bearer(token), timeout=5)
    assert r1.status_code == 200, r1.text
    assert r1.json()["kind"] == "application_received"
    assert r1.json()["next_allowed_at"] is not None

    # Immediate second call → 429
    r2 = requests.post(f"{BASE_URL}/api/ambassadors/resend-activation",
                       headers=_bearer(token), timeout=5)
    assert r2.status_code == 429
    assert "Retry-After" in r2.headers
    assert int(r2.headers["Retry-After"]) > 0

    # Cleanup
    async def _wipe():
        from db import db
        await db.users.delete_one({"id": me["id"]})
        await db.coupons.delete_many({"ambassador_user_id": me["id"]})
    run_async(_wipe())


def test_resend_activation_active_path_sends_welcome():
    """Active user → welcome email re-sent (kind='welcome')."""
    email = _new_email()
    me, token = _join_with_token(email)

    # Flip directly to active (skip terms+approve dance via DB write).
    async def _activate():
        from db import db
        await db.users.update_one(
            {"id": me["id"]},
            {"$set": {
                "ambassador_profile.status": "active",
                "ambassador_profile.terms_accepted_at": datetime.now(timezone.utc),
                "ambassador_profile.terms_accepted_version": "v1",
            }},
        )
    run_async(_activate())

    r = requests.post(f"{BASE_URL}/api/ambassadors/resend-activation",
                      headers=_bearer(token), timeout=5)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "welcome"

    # Cleanup
    async def _wipe():
        from db import db
        await db.users.delete_one({"id": me["id"]})
        await db.coupons.delete_many({"ambassador_user_id": me["id"]})
    run_async(_wipe())


def test_resend_activation_rejected_returns_400():
    email = _new_email()
    me, token = _join_with_token(email)

    async def _reject():
        from db import db
        await db.users.update_one(
            {"id": me["id"]},
            {"$set": {
                "ambassador_profile.status": "rejected",
                "ambassador_profile.rejected_reason": "test",
                "ambassador_profile.can_reapply_at":
                    datetime.now(timezone.utc) + timedelta(days=30),
            }},
        )
    run_async(_reject())

    r = requests.post(f"{BASE_URL}/api/ambassadors/resend-activation",
                      headers=_bearer(token), timeout=5)
    assert r.status_code == 400, r.text

    async def _wipe():
        from db import db
        await db.users.delete_one({"id": me["id"]})
        await db.coupons.delete_many({"ambassador_user_id": me["id"]})
    run_async(_wipe())


def test_resend_activation_unauthenticated_returns_401():
    r = requests.post(f"{BASE_URL}/api/ambassadors/resend-activation", timeout=5)
    assert r.status_code in (401, 403)
