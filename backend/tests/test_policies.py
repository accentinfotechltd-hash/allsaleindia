"""Tests for the public Legal & Policy endpoints.

Covers:
  - GET /api/policies returns metadata for every shipped policy.
  - Every slug resolves via GET /api/policies/{slug}.
  - The new Shipping Policy is present and well-formed.
  - Unknown slugs 404 cleanly.
  - Markdown shape is non-empty (web renders this directly).
"""
from __future__ import annotations

import requests

BASE = "http://localhost:8001/api"

EXPECTED_SLUGS = {
    "terms", "privacy", "return", "payment", "cancellation",
    "shipping", "seller", "prohibited", "cookies",
}


def test_list_returns_all_policies():
    r = requests.get(f"{BASE}/policies", timeout=5)
    assert r.status_code == 200
    data = r.json()
    slugs = {p["slug"] for p in data}
    # All expected slugs are present (forward-compatible with future additions).
    assert EXPECTED_SLUGS.issubset(slugs), f"Missing: {EXPECTED_SLUGS - slugs}"
    # Every row has the canonical fields the hub renders.
    for p in data:
        assert p["title"]
        assert p["effective"]
        assert p["last_updated"]
        assert p["description"]


def test_every_slug_resolves_to_full_policy():
    for slug in EXPECTED_SLUGS:
        r = requests.get(f"{BASE}/policies/{slug}", timeout=5)
        assert r.status_code == 200, f"{slug}: {r.text}"
        d = r.json()
        assert d["slug"] == slug
        assert d["title"]
        assert d["sections"] and len(d["sections"]) >= 3
        # markdown helper should produce non-empty text
        assert d["markdown"] and "##" in d["markdown"]


def test_shipping_policy_contents():
    r = requests.get(f"{BASE}/policies/shipping", timeout=5)
    assert r.status_code == 200
    d = r.json()
    assert d["title"] == "Shipping Policy"
    text = " ".join(
        (s.get("paragraph") or "") + " " + " ".join(s.get("bullets") or [])
        for s in d["sections"]
    ).lower()
    # The policy must cover the topics App Store reviewers look for.
    for must_have in (
        "transit", "customs", "tracking", "shiprocket", "lost", "damaged",
    ):
        assert must_have in text, f"shipping policy missing keyword: {must_have}"


def test_unknown_slug_returns_404():
    r = requests.get(f"{BASE}/policies/nonexistent", timeout=5)
    assert r.status_code == 404


def test_aliases_resolve():
    """The router exposes a few seller-facing aliases like
    'seller-agreement' and 'cookie-policy'. They should 200 too."""
    aliases = ["seller-agreement", "cookie-policy", "terms-and-conditions"]
    for slug in aliases:
        r = requests.get(f"{BASE}/policies/{slug}", timeout=5)
        # Either resolves directly or is gracefully redirected. 404 means
        # the alias was dropped — fail loudly so we notice.
        assert r.status_code in (200, 301, 302, 307, 308), (
            f"alias {slug} returned {r.status_code}"
        )
