"""Phase 4 — Ambassador T&C Approval Flow integration tests.

Covers the full lifecycle:

  1. /join now lands the user in ``pending_approval`` (was ``active``)
  2. The coupon doc is created with ``active: false``
  3. /by-code/{code} returns 404 while pending (it's not live yet)
  4. /accept-terms stamps the user + is idempotent
  5. /admin/approve requires terms_accepted (412 otherwise)
  6. /admin/approve flips status -> active AND coupon active=true
  7. /by-code/{code} starts resolving once approved
  8. /admin/reject sets can_reapply_at = now + 30 days
  9. Re-applying before the cool-down is rejected (409)
 10. Re-applying after the cool-down resets status -> pending_approval
 11. permanent=true sets status="permanently_banned" and blocks re-apply forever
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from conftest import run_async

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL")
            or "http://localhost:8001")


def _new_email() -> str:
    return f"approval_{uuid.uuid4().hex[:8]}@allsale.dev"


def _join(email: str, country: str = "NZ") -> dict:
    r = requests.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": f"Approval Test {email[:8]}",
        "email": email,
        "country": country,
        "primary_platform": "instagram",
    }, timeout=10)
    return r.json() if r.status_code in (201, 409, 400, 403) else r.raise_for_status()


def _set_password(user_id: str, password: str = "Approval2026!") -> str:
    """Stamp a password on the stub user, then log in and return the token."""
    async def _do():
        from db import db
        from utils import hash_password
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"password_hash": hash_password(password)}},
        )
    run_async(_do())
    user = run_async((__import__("db").db.users.find_one(
        {"id": user_id}, {"_id": 0, "email": 1})))
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": user["email"], "password": password},
                      timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _admin_token() -> str:
    """Owner admin token — credentials from /app/memory/test_credentials.md.
    Owner admins use the dedicated /api/admin/login endpoint (separate from
    customer /api/auth/login)."""
    r = requests.post(f"{BASE_URL}/api/admin/login", json={
        "email": "owner@allsale.co.nz", "password": "AllsaleOwner2026!",
    }, timeout=10)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _bearer(t): return {"Authorization": f"Bearer {t}"}


# ===========================================================================
# 1–3.  Application lands in pending_approval, coupon inactive, /by-code 404
# ===========================================================================
def test_join_creates_pending_application_with_inactive_coupon():
    email = _new_email()
    r = requests.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": "Pending Pat", "email": email,
        "country": "NZ", "primary_platform": "instagram",
    }, timeout=10)
    assert r.status_code == 201, r.text
    body = r.json()
    me = body["me"]
    assert me["status"] == "pending_approval"
    assert me["terms_accepted_at"] is None
    code = me["code"]

    # Coupon doc exists but active=False
    async def _check():
        from db import db
        c = await db.coupons.find_one({"code": code}, {"_id": 0})
        return c
    coupon = run_async(_check())
    assert coupon is not None, "ambassador coupon doc must be created"
    assert coupon["active"] is False, "coupon must start INACTIVE"

    # Public /by-code returns 404 (not live yet)
    r2 = requests.get(f"{BASE_URL}/api/ambassadors/by-code/{code}", timeout=5)
    assert r2.status_code == 404, "pending codes must NOT publicly resolve"


# ===========================================================================
# 4. /accept-terms stamps the user and is idempotent
# ===========================================================================
def test_accept_terms_is_idempotent():
    email = _new_email()
    body = _join(email)
    me_id = body["me"]["id"]
    token = _set_password(me_id)

    # First accept
    r = requests.post(f"{BASE_URL}/api/ambassadors/accept-terms",
                      headers=_bearer(token), json={"version": "v1"},
                      timeout=5)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["ok"] is True
    assert first["terms_accepted_version"] == "v1"

    # Re-accept same version → idempotent (same timestamp echoed back).
    # Compare at ms precision since MongoDB truncates sub-millisecond.
    r2 = requests.post(f"{BASE_URL}/api/ambassadors/accept-terms",
                       headers=_bearer(token), json={"version": "v1"},
                       timeout=5)
    assert r2.status_code == 200, r2.text
    assert r2.json()["terms_accepted_at"][:23] == first["terms_accepted_at"][:23]

    # Bad version is rejected
    r3 = requests.post(f"{BASE_URL}/api/ambassadors/accept-terms",
                       headers=_bearer(token), json={"version": "v99"},
                       timeout=5)
    assert r3.status_code == 400


# ===========================================================================
# 5–7. /admin/approve requires terms first; flips status + coupon
# ===========================================================================
def test_approve_requires_terms_then_activates():
    email = _new_email()
    body = _join(email)
    me_id = body["me"]["id"]
    code = body["me"]["code"]
    admin = _admin_token()

    # Approve BEFORE terms → 412 precondition failed
    r = requests.post(
        f"{BASE_URL}/api/admin/ambassadors/{me_id}/approve",
        headers=_bearer(admin), timeout=5,
    )
    assert r.status_code == 412, f"expected 412, got {r.status_code}: {r.text}"

    # Accept terms then approve → 200
    token = _set_password(me_id)
    requests.post(f"{BASE_URL}/api/ambassadors/accept-terms",
                  headers=_bearer(token), json={"version": "v1"}, timeout=5)
    r = requests.post(
        f"{BASE_URL}/api/admin/ambassadors/{me_id}/approve",
        headers=_bearer(admin), timeout=5,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    # /by-code now resolves
    r2 = requests.get(f"{BASE_URL}/api/ambassadors/by-code/{code}", timeout=5)
    assert r2.status_code == 200

    # Coupon is now active
    async def _coupon():
        from db import db
        return await db.coupons.find_one({"code": code}, {"_id": 0})
    c = run_async(_coupon())
    assert c["active"] is True

    # Double-approval is a 409 (status is no longer pending_approval)
    r3 = requests.post(
        f"{BASE_URL}/api/admin/ambassadors/{me_id}/approve",
        headers=_bearer(admin), timeout=5,
    )
    assert r3.status_code == 409


# ===========================================================================
# 8–10. Reject + re-apply cool-down behavior
# ===========================================================================
def test_reject_sets_cool_down_and_blocks_early_reapply():
    email = _new_email()
    body = _join(email)
    me_id = body["me"]["id"]
    code = body["me"]["code"]
    admin = _admin_token()

    # Reject (non-permanent)
    r = requests.post(
        f"{BASE_URL}/api/admin/ambassadors/{me_id}/reject",
        headers=_bearer(admin), timeout=5,
        json={"reason": "Insufficient audience for first tier", "permanent": False},
    )
    assert r.status_code == 200, r.text
    body2 = r.json()
    assert body2["status"] == "rejected"
    assert body2["can_reapply_at"] is not None

    # Coupon deactivated
    async def _coupon():
        from db import db
        return await db.coupons.find_one({"code": code}, {"_id": 0})
    c = run_async(_coupon())
    assert c["active"] is False

    # Try re-apply immediately → 409
    r2 = requests.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": "Pending Pat", "email": email,
        "country": "NZ", "primary_platform": "instagram",
    }, timeout=10)
    assert r2.status_code == 409, f"early re-apply should be blocked: {r2.status_code}"

    # Backdate the cool-down to enable re-apply
    async def _backdate():
        from db import db
        await db.users.update_one(
            {"id": me_id},
            {"$set": {"ambassador_profile.can_reapply_at":
                      datetime.now(timezone.utc) - timedelta(days=1)}},
        )
    run_async(_backdate())

    # Re-apply now succeeds → back in pending_approval
    r3 = requests.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": "Pending Pat", "email": email,
        "country": "NZ", "primary_platform": "tiktok",
    }, timeout=10)
    assert r3.status_code == 201, r3.text
    assert r3.json()["me"]["status"] == "pending_approval"


# ===========================================================================
# 11. permanent ban blocks forever
# ===========================================================================
def test_permanent_ban_blocks_reapply_forever():
    email = _new_email()
    body = _join(email)
    me_id = body["me"]["id"]
    admin = _admin_token()

    r = requests.post(
        f"{BASE_URL}/api/admin/ambassadors/{me_id}/reject",
        headers=_bearer(admin), timeout=5,
        json={"reason": "Confirmed fraud", "permanent": True},
    )
    assert r.status_code == 200
    body2 = r.json()
    assert body2["status"] == "permanently_banned"
    assert body2["can_reapply_at"] is None  # no cool-down for fraud

    # Re-apply attempt → 403
    r2 = requests.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": "Banned Bob", "email": email,
        "country": "NZ", "primary_platform": "instagram",
    }, timeout=10)
    assert r2.status_code == 403


# ===========================================================================
# Cleanup hook — wipe all approval_*@allsale.dev users created above
# ===========================================================================
@pytest.fixture(autouse=True, scope="module")
def _cleanup_after_module():
    yield  # run all tests in this module
    async def _wipe():
        from db import db
        # Identify users by the email prefix used in _new_email()
        emails = [u["email"] async for u in db.users.find(
            {"email": {"$regex": "^approval_"}}, {"_id": 0, "email": 1})]
        if not emails:
            return
        coupons_q = {"ambassador_user_id": {"$in":
            [u["id"] async for u in db.users.find(
                {"email": {"$in": emails}}, {"_id": 0, "id": 1})]}}
        await db.coupons.delete_many(coupons_q)
        await db.users.delete_many({"email": {"$in": emails}})
    run_async(_wipe())
