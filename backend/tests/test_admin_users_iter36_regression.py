"""Iteration 36 — Admin users list regression.

Targeted regression checks specifically for the mobile UI screen ship:
  - `?q=` alias works exactly like `?search=`.
  - `has_more` flips to false on the last page.
  - `role + q` combine via $and (role isn't OR'd away).
  - Default limit = 50, max clamped to 200.
"""
import os
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = (BASE_URL or "").rstrip("/")

OWNER_EMAIL = "owner@allsale.co.nz"
OWNER_PASSWORD = "AllsaleOwner2026!"


@pytest.fixture(scope="module")
def owner_headers():
    sess = requests.Session()
    r = sess.post(
        f"{BASE_URL}/api/admin/login",
        json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
    )
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {r.json()['access_token']}",
    }


def test_q_alias_matches_search(owner_headers):
    r_search = requests.get(
        f"{BASE_URL}/api/admin/users?search=allsale&limit=10",
        headers=owner_headers,
    )
    r_q = requests.get(
        f"{BASE_URL}/api/admin/users?q=allsale&limit=10",
        headers=owner_headers,
    )
    assert r_search.status_code == 200 and r_q.status_code == 200
    assert r_search.json()["total"] == r_q.json()["total"], (
        "?q= alias must return same total as ?search="
    )


def test_role_plus_q_combined_not_ord_away(owner_headers):
    r = requests.get(
        f"{BASE_URL}/api/admin/users?role=seller&q=allsale&limit=20",
        headers=owner_headers,
    )
    assert r.status_code == 200
    for u in r.json()["users"]:
        assert u.get("is_seller") is True, (
            f"buyer leaked into role=seller&q=… result: {u}"
        )


def test_has_more_flips_false_on_last_page(owner_headers):
    # Get total
    r0 = requests.get(
        f"{BASE_URL}/api/admin/users?limit=1", headers=owner_headers
    )
    assert r0.status_code == 200
    total = r0.json()["total"]
    assert total >= 1

    # Page big enough to include the LAST row.
    big = max(total, 1)
    r = requests.get(
        f"{BASE_URL}/api/admin/users?limit={min(big, 200)}",
        headers=owner_headers,
    )
    assert r.status_code == 200
    d = r.json()
    if total <= 200:
        assert d["has_more"] is False, (
            f"has_more must be False when all rows fit one page; total={total} returned={len(d['users'])}"
        )
    # Now skip past total -> empty page, has_more False
    r2 = requests.get(
        f"{BASE_URL}/api/admin/users?limit=10&skip={total + 1000}",
        headers=owner_headers,
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["users"] == []
    assert d2["has_more"] is False


def test_default_limit_50_and_cap_200(owner_headers):
    r = requests.get(f"{BASE_URL}/api/admin/users", headers=owner_headers)
    assert r.status_code == 200
    assert r.json()["limit"] == 50

    r2 = requests.get(
        f"{BASE_URL}/api/admin/users?limit=10000", headers=owner_headers
    )
    assert r2.status_code == 200
    assert r2.json()["limit"] == 200
