"""Iteration 27 — Admin users pagination + A/B funnel + events.

Covers:
  - GET /api/admin/users: pagination (limit/skip), search, role filter, RBAC
    (manager+support allowed)
  - GET /api/admin/events/funnel: variant breakdown + conversion rate; RBAC
    (manager+owner only — support forbidden)
  - GET /api/admin/events/recent: latest events with `name` filter
  - POST /api/events: anonymous ingestion → 204
"""
import os
import time
import uuid

import pytest
import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = BASE_URL.rstrip("/")

OWNER_EMAIL = "owner@allsale.co.nz"
OWNER_PASSWORD = "AllsaleOwner2026!"


# --------------------------------------------------------------------------
# Fixtures: owner + support sub-admin
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers["Content-Type"] = "application/json"
    return sess


@pytest.fixture(scope="module")
def owner_token(s):
    r = s.post(
        f"{BASE_URL}/api/admin/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
    )
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {owner_token}",
    }


@pytest.fixture(scope="module")
def support_admin(s, owner_headers):
    """Create a fresh support sub-admin so we can validate RBAC."""
    email = f"TEST_support_{uuid.uuid4().hex[:8]}@allsale.co.nz"
    r = s.post(
        f"{BASE_URL}/api/admin/team",
        headers=owner_headers,
        json={
            "email": email,
            "full_name": "TEST Support",
            "role": "support",
            "password": "SupportPass2026!",
        },
    )
    assert r.status_code == 201, f"create support failed: {r.status_code} {r.text}"
    admin_id = r.json()["id"]
    yield {"email": email, "password": "SupportPass2026!", "id": admin_id}
    # teardown
    try:
        s.delete(
            f"{BASE_URL}/api/admin/team/{admin_id}",
            headers=owner_headers,
        )
    except Exception:
        pass


@pytest.fixture(scope="module")
def support_headers(s, support_admin):
    r = s.post(
        f"{BASE_URL}/api/admin/login",
        json={
            "email": support_admin["email"],
            "password": support_admin["password"],
        },
    )
    assert r.status_code == 200, f"support login failed: {r.status_code} {r.text}"
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {r.json()['access_token']}",
    }


# --------------------------------------------------------------------------
# /admin/users pagination + search + role filter
# --------------------------------------------------------------------------
class TestAdminUsersPagination:
    def test_default_response_shape(self, s, owner_headers):
        r = s.get(f"{BASE_URL}/api/admin/users", headers=owner_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        for key in ("users", "total", "limit", "skip", "has_more"):
            assert key in d, f"missing field: {key}"
        assert isinstance(d["users"], list)
        assert isinstance(d["total"], int)
        assert d["skip"] == 0
        assert d["limit"] == 50  # default
        # Page size matches limit (or smaller if dataset tiny)
        assert len(d["users"]) <= 50
        # has_more must be coherent with counts
        assert d["has_more"] == (len(d["users"]) < d["total"])

    def test_limit_clamping_and_pagination(self, s, owner_headers):
        # limit=5
        r = s.get(
            f"{BASE_URL}/api/admin/users?limit=5",
            headers=owner_headers,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["limit"] == 5
        assert len(d["users"]) <= 5

        # over-cap → clamped to 200
        r2 = s.get(
            f"{BASE_URL}/api/admin/users?limit=99999",
            headers=owner_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["limit"] == 200

        # skip=5, limit=5 → different first id from page 1
        r3 = s.get(
            f"{BASE_URL}/api/admin/users?limit=5&skip=5",
            headers=owner_headers,
        )
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["skip"] == 5
        if d3["total"] > 10 and d["users"] and d3["users"]:
            page1_ids = {u["id"] for u in d["users"]}
            page2_ids = {u["id"] for u in d3["users"]}
            # No overlap between page1 (limit=5) and page2 (skip=5,limit=5)
            assert page1_ids.isdisjoint(page2_ids)

    def test_password_hash_never_returned(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/users?limit=10", headers=owner_headers
        )
        assert r.status_code == 200
        for u in r.json()["users"]:
            assert "password_hash" not in u
            assert "_id" not in u

    def test_search_case_insensitive(self, s, owner_headers):
        # Search for "allsale" — should hit owner + seeded users with allsale in
        # email or company. Compare lowercase + uppercase to confirm insensitivity.
        r1 = s.get(
            f"{BASE_URL}/api/admin/users?search=allsale&limit=10",
            headers=owner_headers,
        )
        r2 = s.get(
            f"{BASE_URL}/api/admin/users?search=ALLSALE&limit=10",
            headers=owner_headers,
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["total"] == r2.json()["total"], (
            f"case sensitivity bug: lower={r1.json()['total']} upper={r2.json()['total']}"
        )
        # Each user returned must actually contain the search term somewhere.
        for u in r1.json()["users"]:
            hay = " ".join(
                [
                    (u.get("email") or "").lower(),
                    (u.get("full_name") or "").lower(),
                    (u.get("company_name") or "").lower(),
                ]
            )
            assert "allsale" in hay, f"unexpected user in search results: {u}"

    def test_search_partial_match(self, s, owner_headers):
        # Partial token — pick first 3 chars of the search "allsale" → "all".
        r = s.get(
            f"{BASE_URL}/api/admin/users?search=all&limit=5",
            headers=owner_headers,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["total"] >= 1  # owner email matches at minimum

    def test_role_filter_seller(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/users?role=seller&limit=10",
            headers=owner_headers,
        )
        assert r.status_code == 200
        d = r.json()
        for u in d["users"]:
            assert u.get("is_seller") is True, f"non-seller returned: {u}"

    def test_role_filter_buyer(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/users?role=buyer&limit=10",
            headers=owner_headers,
        )
        assert r.status_code == 200
        d = r.json()
        for u in d["users"]:
            assert not u.get("is_seller"), f"seller returned for buyer filter: {u}"

    def test_role_plus_search_combo(self, s, owner_headers):
        # role=seller AND search=allsale → all returned users must be sellers AND match
        r = s.get(
            f"{BASE_URL}/api/admin/users?role=seller&search=allsale&limit=10",
            headers=owner_headers,
        )
        assert r.status_code == 200
        for u in r.json()["users"]:
            assert u.get("is_seller") is True
            hay = " ".join(
                [
                    (u.get("email") or "").lower(),
                    (u.get("full_name") or "").lower(),
                    (u.get("company_name") or "").lower(),
                ]
            )
            assert "allsale" in hay


# --------------------------------------------------------------------------
# RBAC: /admin/users accessible to support; funnel/recent NOT
# --------------------------------------------------------------------------
class TestRBAC:
    def test_support_can_access_admin_users(self, s, support_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/users?limit=5", headers=support_headers
        )
        assert r.status_code == 200, (
            f"support should access /admin/users: {r.status_code} {r.text}"
        )
        assert "users" in r.json()

    def test_support_blocked_from_funnel(self, s, support_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/funnel?experiment=personalised_rail_v1",
            headers=support_headers,
        )
        assert r.status_code == 403, (
            f"support must NOT access funnel: {r.status_code} {r.text}"
        )

    def test_support_blocked_from_recent(self, s, support_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/recent",
            headers=support_headers,
        )
        assert r.status_code == 403

    def test_unauthorized_request(self, s):
        r = s.get(f"{BASE_URL}/api/admin/users")
        assert r.status_code in (401, 403)


# --------------------------------------------------------------------------
# /admin/events/funnel — variant breakdown + conversion rates
# --------------------------------------------------------------------------
class TestFunnel:
    def test_funnel_shape_with_conversion(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/funnel"
            f"?experiment=personalised_rail_v1&days=30"
            f"&conversion_event=checkout.complete",
            headers=owner_headers,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["experiment"] == "personalised_rail_v1"
        assert d["window_days"] == 30
        assert d["conversion_event"] == "checkout.complete"
        assert "variants" in d
        assert "total_exposures" in d
        assert "total_conversions" in d

        # Seeded 106 exposures (53/53) + 7 conversions per main-agent note.
        # Be defensive: accept any non-zero exposure but cross-check rates.
        if d["total_exposures"] > 0:
            for variant_name, stats in d["variants"].items():
                assert "exposures" in stats
                assert "conversions" in stats
                assert "rate" in stats
                if stats["exposures"] > 0:
                    expected = round(stats["conversions"] / stats["exposures"], 4)
                    assert abs(stats["rate"] - expected) < 1e-3, (
                        f"rate mismatch for {variant_name}: "
                        f"{stats['rate']} vs expected {expected}"
                    )

    def test_funnel_without_conversion_event(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/funnel"
            f"?experiment=personalised_rail_v1&days=30",
            headers=owner_headers,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["conversion_event"] is None
        # conversions should be 0 when no conversion event passed.
        for stats in d["variants"].values():
            assert stats["conversions"] == 0
            assert stats["rate"] == 0.0

    def test_funnel_unknown_experiment_empty(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/funnel"
            f"?experiment=__never_exists__&days=14",
            headers=owner_headers,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["variants"] == {}
        assert d["total_exposures"] == 0


# --------------------------------------------------------------------------
# /admin/events/recent — latest events with name filter
# --------------------------------------------------------------------------
class TestRecent:
    def test_recent_default(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/recent?limit=10",
            headers=owner_headers,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "events" in d
        assert "count" in d
        assert d["count"] == len(d["events"])
        assert len(d["events"]) <= 10
        for ev in d["events"]:
            assert "_id" not in ev

    def test_recent_name_filter(self, s, owner_headers):
        r = s.get(
            f"{BASE_URL}/api/admin/events/recent?name=ab.exposure&limit=10",
            headers=owner_headers,
        )
        assert r.status_code == 200
        for ev in r.json()["events"]:
            assert ev.get("name") == "ab.exposure"


# --------------------------------------------------------------------------
# POST /api/events  — anonymous ingestion → 204
# --------------------------------------------------------------------------
class TestEventIngestion:
    def test_anonymous_event_204(self, s, owner_headers):
        marker = f"TEST_ingest_{uuid.uuid4().hex[:8]}"
        # NOTE: anonymous → no Authorization header.
        r = s.post(
            f"{BASE_URL}/api/events",
            json={
                "name": "test.ping",
                "props": {"marker": marker},
                "session_id": f"sess_{int(time.time())}",
                "page": "/test",
            },
        )
        assert r.status_code == 204, f"expected 204, got {r.status_code} {r.text}"

        # Verify persistence via /admin/events/recent (owner)
        time.sleep(0.3)
        r2 = s.get(
            f"{BASE_URL}/api/admin/events/recent?name=test.ping&limit=10",
            headers=owner_headers,
        )
        assert r2.status_code == 200
        found = any(
            ev.get("props", {}).get("marker") == marker
            for ev in r2.json()["events"]
        )
        assert found, "anonymous event was not persisted"
