"""Tests for /admin/users/{id}/(suspend|reactivate|reset-2fa|points-adjust).

These cover the iter40 admin user-actions router.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

OWNER_EMAIL = "owner@allsale.co.nz"
OWNER_PASSWORD = "AllsaleOwner2026!"


# ---------------------------------------------------------------------------
# Session fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/admin/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def throwaway_user():
    """Create a fresh buyer to operate on (won't disturb seed buyer)."""
    suffix = uuid.uuid4().hex[:10]
    email = f"TEST_actions_{suffix}@allsale.co.nz"
    password = "Test1234!"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "full_name": "TEST Actions User"},
        timeout=30,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {
        "email": email,
        "password": password,
        "user_id": data["user"]["id"],
        "token": data["access_token"],
    }


# ---------------------------------------------------------------------------
# GET /admin/users/{id}
# ---------------------------------------------------------------------------
def test_get_user_returns_safe_fields(owner_headers, throwaway_user):
    r = requests.get(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}",
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["id"] == throwaway_user["user_id"]
    assert "points_balance" in data
    assert isinstance(data["points_balance"], int)
    assert "orders_count" in data
    assert isinstance(data["orders_count"], int)
    # No sensitive fields
    assert "password_hash" not in data
    assert "two_factor_secret_hash" not in data
    assert "_id" not in data


def test_get_user_404(owner_headers):
    r = requests.get(f"{BASE_URL}/api/admin/users/user_nonexistent_xyz", headers=owner_headers, timeout=30)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Suspend / Reactivate (+ JWT invalidation)
# ---------------------------------------------------------------------------
def test_suspend_invalidates_old_jwt_and_blocks_login(owner_headers, throwaway_user):
    user_id = throwaway_user["user_id"]
    old_token = throwaway_user["token"]

    # Verify /auth/me works first
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {old_token}"}, timeout=30)
    assert r.status_code == 200

    # Suspend
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{user_id}/suspend",
        json={"reason": "spam"},
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("is_suspended") is True

    # Old JWT now invalid → 401 (token_version bumped)
    r2 = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {old_token}"}, timeout=30)
    assert r2.status_code == 401, f"expected 401 got {r2.status_code} {r2.text}"

    # Fresh login: either blocked at login OR returns a token that /auth/me rejects with 403
    r3 = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": throwaway_user["email"], "password": throwaway_user["password"]},
        timeout=30,
    )
    if r3.status_code == 200 and r3.json().get("access_token"):
        new_tok = r3.json()["access_token"]
        r4 = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {new_tok}"}, timeout=30)
        assert r4.status_code == 403, f"suspended /auth/me expected 403, got {r4.status_code} {r4.text}"
        assert "suspend" in r4.text.lower()
    else:
        # Acceptable: login itself was blocked
        assert r3.status_code in (401, 403)


def test_reactivate_clears_suspension(owner_headers, throwaway_user):
    user_id = throwaway_user["user_id"]
    r = requests.post(f"{BASE_URL}/api/admin/users/{user_id}/reactivate", headers=owner_headers, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("is_suspended") is False

    # Verify field
    r2 = requests.get(f"{BASE_URL}/api/admin/users/{user_id}", headers=owner_headers, timeout=30)
    assert r2.status_code == 200
    assert r2.json().get("is_suspended") in (False, None)


def test_suspend_short_reason_422(owner_headers, throwaway_user):
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}/suspend",
        json={"reason": "no"},
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Reset 2FA
# ---------------------------------------------------------------------------
def test_reset_2fa(owner_headers, throwaway_user):
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}/reset-2fa",
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("two_factor_enabled") is False

    # Confirm via GET
    r2 = requests.get(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}",
        headers=owner_headers,
        timeout=30,
    )
    assert r2.json().get("two_factor_enabled") in (False, None)


# ---------------------------------------------------------------------------
# Points adjustment
# ---------------------------------------------------------------------------
def test_points_adjust_credit(owner_headers, throwaway_user):
    user_id = throwaway_user["user_id"]

    # Initial balance
    r0 = requests.get(f"{BASE_URL}/api/admin/users/{user_id}", headers=owner_headers, timeout=30)
    starting = int(r0.json().get("points_balance") or 0)

    r = requests.post(
        f"{BASE_URL}/api/admin/users/{user_id}/points-adjust",
        json={"delta": 500, "reason": "Goodwill credit"},
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("delta") == 500
    assert body.get("balance") == starting + 500

    # Confirm reflected on GET
    r2 = requests.get(f"{BASE_URL}/api/admin/users/{user_id}", headers=owner_headers, timeout=30)
    assert r2.json().get("points_balance") == starting + 500


def test_points_adjust_zero_delta_400(owner_headers, throwaway_user):
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}/points-adjust",
        json={"delta": 0, "reason": "noop test"},
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 400


def test_points_adjust_negative_below_zero_400(owner_headers, throwaway_user):
    # debit far more than balance to force 400
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}/points-adjust",
        json={"delta": -9999999, "reason": "force underflow"},
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 400


def test_points_adjust_short_reason_422(owner_headers, throwaway_user):
    r = requests.post(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}/points-adjust",
        json={"delta": 50, "reason": "no"},
        headers=owner_headers,
        timeout=30,
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------
def test_activity_log_captures_actions(owner_headers, throwaway_user):
    # Use the same throwaway user — by now we've suspended, reactivated, reset-2fa, points-adjust.
    r = requests.get(
        f"{BASE_URL}/api/admin/activity-log?limit=200",
        headers=owner_headers,
        timeout=30,
    )
    if r.status_code != 200:
        pytest.skip(f"activity-log endpoint not accessible: {r.status_code}")
    items = r.json()
    if isinstance(items, dict):
        items = items.get("events") or items.get("items") or items.get("logs") or []
    target_id = throwaway_user["user_id"]
    actions = {row.get("action") for row in items if row.get("target") == target_id}
    expected = {"user.suspend", "user.reactivate", "user.reset_2fa", "user.points_adjust"}
    missing = expected - actions
    assert not missing, f"missing actions for user {target_id}: {missing}; have {actions}"


# ---------------------------------------------------------------------------
# RBAC — support cannot suspend
# ---------------------------------------------------------------------------
def test_support_role_cannot_suspend(owner_headers, throwaway_user):
    """Create a support admin via /api/admin/team, then attempt suspend."""
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_support_{suffix}@allsale.co.nz"
    create = requests.post(
        f"{BASE_URL}/api/admin/team",
        json={"email": email, "full_name": "Support Tester", "role": "support"},
        headers=owner_headers,
        timeout=30,
    )
    if create.status_code not in (200, 201):
        pytest.skip(f"could not create support admin: {create.status_code} {create.text}")

    payload = create.json()
    # Endpoint may return temporary password OR require explicit pwd set; handle both
    temp_pwd = payload.get("_initial_password") or payload.get("temp_password") or payload.get("password")
    if not temp_pwd:
        pytest.skip("admin/team endpoint did not return a usable temp password")

    login = requests.post(
        f"{BASE_URL}/api/admin/login",
        json={"email": email, "password": temp_pwd},
        timeout=30,
    )
    if login.status_code != 200:
        pytest.skip(f"support admin login failed: {login.status_code} {login.text}")
    support_token = login.json().get("access_token") or login.json().get("token")

    r = requests.post(
        f"{BASE_URL}/api/admin/users/{throwaway_user['user_id']}/suspend",
        json={"reason": "should be blocked"},
        headers={"Authorization": f"Bearer {support_token}", "Content-Type": "application/json"},
        timeout=30,
    )
    assert r.status_code == 403, f"support must NOT suspend; got {r.status_code} {r.text}"
