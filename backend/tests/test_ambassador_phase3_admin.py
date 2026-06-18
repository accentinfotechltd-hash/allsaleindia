"""Phase-3 Ambassador Programme — admin endpoints tests.

Covers NEW endpoints:
  • POST /api/admin/ambassadors/{id}/unsuspend  (manager)
  • GET  /api/admin/ambassadors/{id}/content    (manager+support)

Regression:
  • POST /api/ambassadors/me/withdraw still works
  • POST /api/admin/ambassadors/{id}/mark-paid
  • POST /api/admin/ambassadors/{id}/suspend
  • POST /api/admin/ambassadors/{id}/content/{cid}/review
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
import requests
import pytest

sys.path.insert(0, "/app/backend")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL")
            or os.environ.get("EXPO_BACKEND_URL"))
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL=") or line.startswith("EXPO_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = (BASE_URL or "").rstrip("/")

OWNER_EMAIL = "owner@allsale.co.nz"
OWNER_PASSWORD = "AllsaleOwner2026!"


def _new_email(prefix="amb"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@allsale.co.nz"


def _new_name(prefix="Tester"):
    return f"{prefix} {uuid.uuid4().hex[:6].upper()}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(session):
    r = session.post(f"{BASE_URL}/api/admin/login",
                     json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def ambassador(session):
    """Create an NZ ambassador, set a password, login, and return identity+token."""
    email = _new_email("ph3")
    name = _new_name("NZ Phase3")
    r = session.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": name, "email": email, "country": "NZ",
        "social_handle": "@ph3test", "primary_platform": "instagram",
    })
    assert r.status_code == 201, f"join failed: {r.status_code} {r.text}"
    j = r.json()
    me = j["me"] if "me" in j else j
    password = "AmbPass2026!"
    from db import db
    from utils import hash_password

    async def _setup():
        await db.users.update_one(
            {"id": me["id"]},
            {"$set": {"password_hash": hash_password(password)}},
        )
    asyncio.get_event_loop().run_until_complete(_setup())

    rl = session.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password})
    assert rl.status_code == 200
    return {**me, "email": email, "password": password,
            "token": rl.json()["access_token"]}


# ---------------------------------------------------------------------------
# 1. Regression: POST /api/ambassadors/me/withdraw
# ---------------------------------------------------------------------------
class TestWithdrawRegression:
    def test_withdraw_blocked_when_below_min(self, session, ambassador):
        r = session.post(
            f"{BASE_URL}/api/ambassadors/me/withdraw",
            headers={"Authorization": f"Bearer {ambassador['token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "blocked"
        assert body["currency"] == "NZD"
        assert body["payout_method"] == "stripe_connect"
        assert "minimum" in (body.get("reason") or "").lower()

    def test_withdraw_queued_when_above_min(self, session, ambassador):
        """Set unpaid balance large enough, withdraw should queue."""
        from db import db

        async def _seed():
            await db.users.update_one(
                {"id": ambassador["id"]},
                {"$set": {"ambassador_profile.unpaid_balance_minor": 5000}},  # NZD 50
            )
        asyncio.get_event_loop().run_until_complete(_seed())

        r = session.post(
            f"{BASE_URL}/api/ambassadors/me/withdraw",
            headers={"Authorization": f"Bearer {ambassador['token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "queued"
        assert body["currency"] == "NZD"
        assert body["requested_amount"] == 50.0

        # cleanup
        async def _reset():
            await db.users.update_one(
                {"id": ambassador["id"]},
                {"$set": {"ambassador_profile.unpaid_balance_minor": 0}},
            )
        asyncio.get_event_loop().run_until_complete(_reset())


# ---------------------------------------------------------------------------
# 2. NEW: POST /api/admin/ambassadors/{id}/unsuspend
# ---------------------------------------------------------------------------
class TestUnsuspend:
    def test_unsuspend_404_when_not_suspended(self, session, admin_headers, ambassador):
        """Active ambassador → unsuspend returns 404."""
        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/unsuspend",
            headers=admin_headers,
        )
        assert r.status_code == 404, r.text

    def test_suspend_then_unsuspend_clears_fields(self, session, admin_headers, ambassador):
        # First suspend
        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/suspend"
            f"?reason=Testing+unsuspend+flow",
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "suspended"

        # Verify the suspension via DB
        from db import db

        async def _read():
            u = await db.users.find_one({"id": ambassador["id"]},
                                          {"_id": 0, "ambassador_profile": 1})
            return u["ambassador_profile"]
        prof = asyncio.get_event_loop().run_until_complete(_read())
        assert prof["status"] == "suspended"
        assert prof.get("suspended_at") is not None
        assert "unsuspend" in (prof.get("suspended_reason") or "").lower()

        # Unsuspend
        r2 = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/unsuspend",
            headers=admin_headers,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "active"

        prof2 = asyncio.get_event_loop().run_until_complete(_read())
        assert prof2["status"] == "active"
        # Fields cleared
        assert "suspended_at" not in prof2
        assert "suspended_reason" not in prof2

    def test_unsuspend_404_when_id_unknown(self, session, admin_headers):
        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/user_does_not_exist/unsuspend",
            headers=admin_headers,
        )
        assert r.status_code == 404, r.text


# ---------------------------------------------------------------------------
# 3. NEW: GET /api/admin/ambassadors/{id}/content
# ---------------------------------------------------------------------------
class TestAdminListContent:
    @pytest.fixture(scope="class")
    def submissions(self, session, ambassador):
        """Submit 3 content items for the ambassador."""
        out = []
        urls = [
            "https://instagram.com/p/abc1",
            "https://tiktok.com/@u/video/abc2",
            "https://youtu.be/abc3",
        ]
        for u in urls:
            r = session.post(
                f"{BASE_URL}/api/ambassadors/me/content",
                headers={"Authorization": f"Bearer {ambassador['token']}"},
                json={"post_url": u},
            )
            assert r.status_code == 201, r.text
            out.append(r.json())
        return out

    def test_list_pending_newest_first(self, session, admin_headers, ambassador, submissions):
        r = session.get(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content?status=pending",
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 3
        # All pending
        assert all(i["status"] == "pending" for i in items)
        # Newest first
        dates = [i["submitted_at"] for i in items]
        assert dates == sorted(dates, reverse=True)
        # Shape matches ContentSubmission
        first = items[0]
        for k in ("id", "submitted_at", "post_url", "platform",
                  "status", "has_required_tag"):
            assert k in first

    def test_list_filters_by_verified_status(self, session, admin_headers, ambassador, submissions):
        # Verify the first submission
        cid = submissions[0]["id"]
        rv = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content/{cid}/review"
            f"?action=verify",
            headers=admin_headers,
        )
        assert rv.status_code == 200, rv.text

        r = session.get(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content?status=verified",
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        items = r.json()
        assert len(items) >= 1
        assert all(i["status"] == "verified" for i in items)
        assert any(i["id"] == cid for i in items)

    def test_list_filters_by_rejected_status(self, session, admin_headers, ambassador, submissions):
        cid = submissions[1]["id"]
        rj = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content/{cid}/review"
            f"?action=reject&reason=spam",
            headers=admin_headers,
        )
        assert rj.status_code == 200, rj.text

        r = session.get(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content?status=rejected",
            headers=admin_headers,
        )
        assert r.status_code == 200
        items = r.json()
        assert all(i["status"] == "rejected" for i in items)
        rec = next((i for i in items if i["id"] == cid), None)
        assert rec is not None
        assert rec["reject_reason"] == "spam"

    def test_list_no_status_returns_all(self, session, admin_headers, ambassador, submissions):
        r = session.get(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content",
            headers=admin_headers,
        )
        assert r.status_code == 200
        items = r.json()
        # Should include verified+rejected+pending
        statuses = {i["status"] for i in items}
        assert "pending" in statuses
        assert "verified" in statuses or "rejected" in statuses

    def test_list_requires_admin_auth(self, session, ambassador):
        r = session.get(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/content",
        )
        # 401 unauthenticated
        assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# 4. Regression: mark-paid + suspend + content review
# ---------------------------------------------------------------------------
class TestRegressionAdminActions:
    def test_mark_paid_zero_balance_idempotent(self, session, admin_headers, ambassador):
        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/mark-paid",
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Zero-balance case returns {ok, paid_amount=0, note=…}
        assert body["ok"] is True
        assert body.get("paid_amount", 0) == 0

    def test_mark_paid_zeros_out_balance(self, session, admin_headers, ambassador):
        from db import db

        async def _seed():
            await db.users.update_one(
                {"id": ambassador["id"]},
                {"$set": {"ambassador_profile.unpaid_balance_minor": 7500}},  # NZD 75
            )
        asyncio.get_event_loop().run_until_complete(_seed())

        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/mark-paid",
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["paid_amount"] == 75.0
        assert body["currency"] == "NZD"

        async def _verify():
            u = await db.users.find_one({"id": ambassador["id"]},
                                          {"_id": 0, "ambassador_profile": 1})
            return u["ambassador_profile"]
        prof = asyncio.get_event_loop().run_until_complete(_verify())
        assert prof["unpaid_balance_minor"] == 0
        assert prof.get("last_paid_at") is not None

    def test_suspend_validates_reason_min_length(self, session, admin_headers, ambassador):
        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}/suspend?reason=ab",
            headers=admin_headers,
        )
        assert r.status_code in (400, 422), r.text

    def test_content_review_404_unknown(self, session, admin_headers, ambassador):
        r = session.post(
            f"{BASE_URL}/api/admin/ambassadors/{ambassador['id']}"
            f"/content/cont_doesnotexist/review?action=verify",
            headers=admin_headers,
        )
        assert r.status_code == 404, r.text
