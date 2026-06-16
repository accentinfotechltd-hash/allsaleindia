"""RBAC test suite for the Owner / Sub-Admin admin_team router.

Covers:
- Owner login (JWT)
- /admin/team/roles returns 3 roles
- Create sub-admin (manager + support) — returns `_initial_password`
- Update full_name / role / is_active
- Reset password
- Delete (and last-owner safety)
- Login as manager + support
- RBAC enforcement:
  * support -> 403 on /admin/team
  * support -> 403 on /admin/payouts/{id}/mark-paid
  * manager and support -> allowed on /admin/sellers/{id}/approve and /reject
- Legacy x-admin-secret still works for overview/sellers/orders/payouts
- Cannot demote / deactivate / delete the last active owner
"""
from __future__ import annotations

import os
import time
import uuid
import requests
import pytest

# ---------- config ----------
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    from pathlib import Path
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = BASE_URL.rstrip("/")

OWNER_EMAIL = "owner@allsale.co.nz"
OWNER_PASSWORD = "AllsaleOwner2026!"
ADMIN_SECRET = "allsale-admin-dev-secret"


def _suffix() -> str:
    return f"{int(time.time())}{uuid.uuid4().hex[:4]}"


# ============================================================================
# Fixtures
# ============================================================================
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def owner_token(s):
    r = s.post(f"{BASE_URL}/api/admin/login",
               json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and data["admin"]["role"] == "owner"
    return data["access_token"]


@pytest.fixture(scope="module")
def owner_h(owner_token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def secret_h():
    return {"Content-Type": "application/json", "x-admin-secret": ADMIN_SECRET}


# Shared sub-admins created once for the suite (so tests cross-reference)
@pytest.fixture(scope="module")
def manager_admin(s, owner_h):
    suf = _suffix()
    body = {
        "email": f"TEST_manager_{suf}@allsale.co.nz",
        "full_name": "TEST Manager",
        "role": "manager",
    }
    r = s.post(f"{BASE_URL}/api/admin/team", json=body, headers=owner_h)
    assert r.status_code == 201, f"create manager failed: {r.text}"
    data = r.json()
    assert data["role"] == "manager"
    assert data["_initial_password"], "expected _initial_password in response"
    # login the manager
    rl = s.post(f"{BASE_URL}/api/admin/login",
                json={"email": data["email"], "password": data["_initial_password"]})
    assert rl.status_code == 200, f"manager login failed: {rl.text}"
    token = rl.json()["access_token"]
    yield {"id": data["id"], "email": data["email"], "token": token,
           "password": data["_initial_password"]}
    # teardown
    s.delete(f"{BASE_URL}/api/admin/team/{data['id']}", headers=owner_h)


@pytest.fixture(scope="module")
def support_admin(s, owner_h):
    suf = _suffix()
    body = {
        "email": f"TEST_support_{suf}@allsale.co.nz",
        "full_name": "TEST Support",
        "role": "support",
    }
    r = s.post(f"{BASE_URL}/api/admin/team", json=body, headers=owner_h)
    assert r.status_code == 201, f"create support failed: {r.text}"
    data = r.json()
    assert data["role"] == "support"
    rl = s.post(f"{BASE_URL}/api/admin/login",
                json={"email": data["email"], "password": data["_initial_password"]})
    assert rl.status_code == 200
    token = rl.json()["access_token"]
    yield {"id": data["id"], "email": data["email"], "token": token,
           "password": data["_initial_password"]}
    s.delete(f"{BASE_URL}/api/admin/team/{data['id']}", headers=owner_h)


# ============================================================================
# Tests
# ============================================================================
class TestOwnerLoginAndRoles:
    def test_owner_login_returns_jwt(self, owner_token):
        assert isinstance(owner_token, str) and len(owner_token) > 20

    def test_admin_me(self, s, owner_h):
        r = s.get(f"{BASE_URL}/api/admin/me", headers=owner_h)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == OWNER_EMAIL and body["role"] == "owner"

    def test_roles_endpoint(self, s, owner_h):
        r = s.get(f"{BASE_URL}/api/admin/team/roles", headers=owner_h)
        assert r.status_code == 200
        roles = r.json()["roles"]
        values = {role["value"] for role in roles}
        assert values == {"owner", "manager", "support"}

    def test_owner_login_bad_password_401(self, s):
        r = s.post(f"{BASE_URL}/api/admin/login",
                   json={"email": OWNER_EMAIL, "password": "wrongPwd123!"})
        assert r.status_code == 401


class TestTeamCRUD:
    def test_list_team_owner_ok(self, s, owner_h):
        r = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        # owner must appear
        assert any(a["email"] == OWNER_EMAIL for a in r.json())

    def test_create_and_persist(self, s, owner_h, manager_admin):
        # GET to verify the just-created manager admin actually exists
        r = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h)
        team = r.json()
        match = [a for a in team if a["id"] == manager_admin["id"]]
        assert match and match[0]["role"] == "manager"
        assert match[0]["is_active"] is True

    def test_create_duplicate_email_409(self, s, owner_h, manager_admin):
        body = {"email": manager_admin["email"], "full_name": "dup", "role": "manager"}
        r = s.post(f"{BASE_URL}/api/admin/team", json=body, headers=owner_h)
        assert r.status_code == 409

    def test_create_invalid_role_400(self, s, owner_h):
        suf = _suffix()
        body = {"email": f"TEST_bad_{suf}@allsale.co.nz",
                "full_name": "x", "role": "godmode"}
        r = s.post(f"{BASE_URL}/api/admin/team", json=body, headers=owner_h)
        assert r.status_code == 400

    def test_patch_full_name_and_role(self, s, owner_h, support_admin):
        r = s.patch(f"{BASE_URL}/api/admin/team/{support_admin['id']}",
                    json={"full_name": "TEST Support Renamed", "role": "manager"},
                    headers=owner_h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["full_name"] == "TEST Support Renamed"
        assert body["role"] == "manager"
        # restore
        s.patch(f"{BASE_URL}/api/admin/team/{support_admin['id']}",
                json={"role": "support"}, headers=owner_h)

    def test_reset_password_returns_new(self, s, owner_h, support_admin):
        r = s.post(f"{BASE_URL}/api/admin/team/{support_admin['id']}/reset-password",
                   json={}, headers=owner_h)
        assert r.status_code == 200
        new_pwd = r.json().get("new_password")
        assert isinstance(new_pwd, str) and len(new_pwd) >= 8
        # verify by logging in
        rl = s.post(f"{BASE_URL}/api/admin/login",
                    json={"email": support_admin["email"], "password": new_pwd})
        assert rl.status_code == 200
        # refresh module-scoped token
        support_admin["token"] = rl.json()["access_token"]
        support_admin["password"] = new_pwd

    def test_patch_invalid_role_400(self, s, owner_h, support_admin):
        r = s.patch(f"{BASE_URL}/api/admin/team/{support_admin['id']}",
                    json={"role": "ceo"}, headers=owner_h)
        assert r.status_code == 400

    def test_patch_nothing_400(self, s, owner_h, support_admin):
        r = s.patch(f"{BASE_URL}/api/admin/team/{support_admin['id']}",
                    json={}, headers=owner_h)
        assert r.status_code == 400

    def test_patch_unknown_admin_404(self, s, owner_h):
        r = s.patch(f"{BASE_URL}/api/admin/team/admin_doesnotexist",
                    json={"role": "manager"}, headers=owner_h)
        assert r.status_code == 404

    def test_delete_admin(self, s, owner_h):
        # create a throw-away admin
        suf = _suffix()
        body = {"email": f"TEST_del_{suf}@allsale.co.nz",
                "full_name": "to delete", "role": "support"}
        r = s.post(f"{BASE_URL}/api/admin/team", json=body, headers=owner_h)
        assert r.status_code == 201
        admin_id = r.json()["id"]
        rd = s.delete(f"{BASE_URL}/api/admin/team/{admin_id}", headers=owner_h)
        assert rd.status_code == 204
        # verify gone
        rl = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h)
        assert all(a["id"] != admin_id for a in rl.json())


class TestLastOwnerSafety:
    def _other_owners_count(self, s, owner_h, exclude_id: str) -> int:
        team = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h).json()
        return sum(
            1 for a in team
            if a["role"] == "owner" and a["is_active"] and a["id"] != exclude_id
        )

    def test_cannot_demote_last_active_owner(self, s, owner_h):
        # find the bootstrap owner doc
        team = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h).json()
        owner = next(a for a in team if a["email"] == OWNER_EMAIL)
        # ensure he's the last one (skip if not)
        others = self._other_owners_count(s, owner_h, owner["id"])
        if others > 0:
            pytest.skip("Multiple owners exist — cannot test last-owner safety")
        r = s.patch(f"{BASE_URL}/api/admin/team/{owner['id']}",
                    json={"role": "manager"}, headers=owner_h)
        assert r.status_code == 400
        assert "last active owner" in r.json()["detail"].lower()

    def test_cannot_deactivate_last_active_owner(self, s, owner_h):
        team = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h).json()
        owner = next(a for a in team if a["email"] == OWNER_EMAIL)
        others = self._other_owners_count(s, owner_h, owner["id"])
        if others > 0:
            pytest.skip("Multiple owners exist")
        r = s.patch(f"{BASE_URL}/api/admin/team/{owner['id']}",
                    json={"is_active": False}, headers=owner_h)
        assert r.status_code == 400

    def test_cannot_delete_last_active_owner(self, s, owner_h):
        team = s.get(f"{BASE_URL}/api/admin/team", headers=owner_h).json()
        owner = next(a for a in team if a["email"] == OWNER_EMAIL)
        others = self._other_owners_count(s, owner_h, owner["id"])
        if others > 0:
            pytest.skip("Multiple owners exist")
        r = s.delete(f"{BASE_URL}/api/admin/team/{owner['id']}", headers=owner_h)
        assert r.status_code == 400


class TestSubAdminLogin:
    def test_manager_login(self, manager_admin):
        assert manager_admin["token"]

    def test_support_login(self, support_admin):
        assert support_admin["token"]


class TestRBACEnforcement:
    """Support is restricted; Manager retains seller-mgmt; Owner has full power."""

    def test_support_cannot_list_team(self, s, support_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {support_admin['token']}"}
        r = s.get(f"{BASE_URL}/api/admin/team", headers=h)
        assert r.status_code == 403

    def test_manager_cannot_list_team(self, s, manager_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {manager_admin['token']}"}
        r = s.get(f"{BASE_URL}/api/admin/team", headers=h)
        assert r.status_code == 403

    def test_support_cannot_mark_payout_paid(self, s, support_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {support_admin['token']}"}
        r = s.post(f"{BASE_URL}/api/admin/payouts/payout_doesnotexist/mark-paid",
                   headers=h)
        # 403 required (not 404), because RBAC check happens at dependency time.
        assert r.status_code == 403, f"expected 403 RBAC, got {r.status_code}: {r.text}"

    def test_manager_can_mark_payout_paid_passes_rbac(self, s, manager_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {manager_admin['token']}"}
        r = s.post(f"{BASE_URL}/api/admin/payouts/payout_doesnotexist/mark-paid",
                   headers=h)
        # 404 == passed RBAC, payout doesn't exist
        assert r.status_code == 404, f"expected 404 (passed RBAC), got {r.status_code}: {r.text}"

    def test_support_can_approve_seller_passes_rbac(self, s, support_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {support_admin['token']}"}
        r = s.post(f"{BASE_URL}/api/admin/sellers/user_doesnotexist/approve",
                   headers=h)
        # 404 (user not found) == passed RBAC
        assert r.status_code == 404, f"expected 404 (passed RBAC), got {r.status_code}: {r.text}"

    def test_manager_can_approve_seller(self, s, manager_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {manager_admin['token']}"}
        r = s.post(f"{BASE_URL}/api/admin/sellers/user_doesnotexist/approve",
                   headers=h)
        assert r.status_code == 404

    def test_support_can_reject_seller_passes_rbac(self, s, support_admin):
        h = {"Content-Type": "application/json",
             "Authorization": f"Bearer {support_admin['token']}"}
        r = s.post(f"{BASE_URL}/api/admin/sellers/user_doesnotexist/reject",
                   json={"reason": "test"}, headers=h)
        assert r.status_code == 404

    def test_no_auth_team_401(self, s):
        r = s.get(f"{BASE_URL}/api/admin/team")
        assert r.status_code in (401, 403)

    def test_no_auth_mark_paid_401(self, s):
        r = s.post(f"{BASE_URL}/api/admin/payouts/x/mark-paid",
                   json={"a": 1})
        assert r.status_code in (401, 403)


class TestLegacyAdminSecretBackwardCompat:
    """The legacy x-admin-secret header must still authenticate the old
    dashboard endpoints (overview, sellers, orders, payouts) AND must also
    be accepted as bootstrap-owner for the new RBAC-protected endpoints."""

    def test_overview(self, s, secret_h):
        r = s.get(f"{BASE_URL}/api/admin/overview", headers=secret_h)
        assert r.status_code == 200
        keys = {"users", "sellers", "products", "orders_paid", "revenue_nzd"}
        assert keys.issubset(r.json().keys())

    def test_sellers(self, s, secret_h):
        r = s.get(f"{BASE_URL}/api/admin/sellers", headers=secret_h)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_orders(self, s, secret_h):
        r = s.get(f"{BASE_URL}/api/admin/orders", headers=secret_h)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_payouts(self, s, secret_h):
        r = s.get(f"{BASE_URL}/api/admin/payouts", headers=secret_h)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_legacy_secret_bootstrap_can_mark_payout_paid(self, s, secret_h):
        # 404 passes RBAC via bootstrap-owner — proves x-admin-secret still
        # authenticates RBAC-protected POST endpoints.
        r = s.post(f"{BASE_URL}/api/admin/payouts/payout_doesnotexist/mark-paid",
                   headers=secret_h)
        assert r.status_code == 404, f"expected 404, got {r.status_code} ({r.text})"

    def test_legacy_secret_bootstrap_can_list_team(self, s, secret_h):
        r = s.get(f"{BASE_URL}/api/admin/team", headers=secret_h)
        assert r.status_code == 200

    def test_wrong_secret_401(self, s):
        # After RBAC migration: wrong x-admin-secret is treated as "no valid
        # auth at all" (no JWT either), so the API returns 401 — semantically
        # more correct than the previous flat 403.
        h = {"Content-Type": "application/json", "x-admin-secret": "not-the-secret"}
        r = s.get(f"{BASE_URL}/api/admin/overview", headers=h)
        assert r.status_code == 401
