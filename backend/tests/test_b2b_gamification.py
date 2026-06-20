"""Tests for B2B Referral Gamification — tiers, badges, leaderboard."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import requests
from pymongo import MongoClient
from uuid import uuid4


BASE = "http://localhost:8001/api"
SELLER = {"email": "verified-seller@example.com", "password": "VerifiedSeller2026!"}
SELLER_UID = "user_f37c688bce13"  # from /app/memory/test_credentials.md


def _sync_db():
    """Direct pymongo client — avoids Motor's event-loop-closed issue in pytest."""
    cli = MongoClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    return cli[os.getenv("DB_NAME", "allsale_database")]


def _login(creds: dict) -> dict:
    """Cached login — auth router rate-limits per-IP so repeated test logins 429."""
    cache = getattr(_login, "_cache", None)
    if not cache or cache[0] != creds["email"]:
        r = requests.post(f"{BASE}/auth/login", json=creds, timeout=5)
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        _login._cache = (creds["email"], token)  # type: ignore[attr-defined]
        return {"Authorization": f"Bearer {token}"}
    return {"Authorization": f"Bearer {cache[1]}"}


def _wipe_seeds() -> None:
    _sync_db().seller_referrals.delete_many(
        {"_seed": {"$in": ["pytest_b2b_game", "demo_gamification"]}}
    )
    # Also remove any non-seed rows for this seller — tests run against a
    # shared DB so we need a clean slate around the seller user we use.
    _sync_db().seller_referrals.delete_many({"referrer_seller_id": SELLER_UID})


def _seed_n_approved(referrer_id: str, n: int, commission_each: float = 100.0) -> None:
    db_sync = _sync_db()
    _wipe_seeds()
    now = datetime.now(timezone.utc)
    docs = [
        {
            "id": f"ref_{uuid4().hex[:12]}",
            "referrer_seller_id": referrer_id,
            "referee_email": f"test-{i}@b2b.in",
            "referee_seller_id": f"user_{uuid4().hex[:12]}",
            "code": "TEST",
            "status": "approved",
            "invited_at": now - timedelta(days=10),
            "signed_up_at": now - timedelta(days=9),
            "approved_at": now - timedelta(days=2),
            "commission_due_nzd": commission_each,
            "commission_paid_nzd": 0.0,
            "_seed": "pytest_b2b_game",
        }
        for i in range(n)
    ]
    if docs:
        db_sync.seller_referrals.insert_many(docs)


def _cleanup():
    _wipe_seeds()


def test_tiers_endpoint_lists_full_ladder():
    headers = _login(SELLER)
    r = requests.get(f"{BASE}/b2b/gamification/tiers", headers=headers, timeout=5)
    assert r.status_code == 200
    d = r.json()
    keys = [t["key"] for t in d["tiers"]]
    assert keys == ["none", "bronze", "silver", "gold", "platinum"]
    # 9 badges shipped
    assert len(d["badges"]) >= 7


def test_newcomer_tier_when_no_referrals():
    _cleanup()
    headers = _login(SELLER)
    r = requests.get(f"{BASE}/b2b/gamification/me", headers=headers, timeout=5)
    assert r.status_code == 200
    d = r.json()
    assert d["tier"]["key"] == "none"
    assert d["next_tier"]["key"] == "bronze"
    assert d["next_tier"]["needed"] == 1
    assert d["stats"]["approved"] == 0
    assert d["unlocked_count"] == 0


def test_bronze_tier_with_one_approved():
    try:
        _seed_n_approved(SELLER_UID, 1, commission_each=50.0)
        headers = _login(SELLER)
        r = requests.get(f"{BASE}/b2b/gamification/me", headers=headers, timeout=5)
        d = r.json()
        assert d["tier"]["key"] == "bronze"
        assert d["next_tier"]["key"] == "silver"
        assert d["next_tier"]["needed"] == 4
        # First Win badge unlocked, Five Figures not yet.
        unlocked = {b["key"] for b in d["badges"] if b["unlocked"]}
        assert "first_win" in unlocked
        assert "five_figures" not in unlocked
    finally:
        _cleanup()


def test_silver_tier_with_five_approved_and_commission_badge():
    try:
        _seed_n_approved(SELLER_UID, 5, commission_each=250.0)  # $1250 total
        headers = _login(SELLER)
        r = requests.get(f"{BASE}/b2b/gamification/me", headers=headers, timeout=5)
        d = r.json()
        assert d["tier"]["key"] == "silver"
        assert d["next_tier"]["key"] == "gold"
        assert d["next_tier"]["needed"] == 10
        unlocked = {b["key"] for b in d["badges"] if b["unlocked"]}
        assert "hat_trick" in unlocked
        assert "five_figures" in unlocked  # $1000+
    finally:
        _cleanup()


def test_platinum_max_tier_has_no_next():
    try:
        _seed_n_approved(SELLER_UID, 55, commission_each=1.0)
        headers = _login(SELLER)
        r = requests.get(f"{BASE}/b2b/gamification/me", headers=headers, timeout=5)
        d = r.json()
        assert d["tier"]["key"] == "platinum"
        assert d["next_tier"] is None
        assert d["progress_pct"] == 100
    finally:
        _cleanup()


def test_leaderboard_returns_self_at_top_when_seeded():
    try:
        _seed_n_approved(SELLER_UID, 3, commission_each=80.0)
        headers = _login(SELLER)
        r = requests.get(
            f"{BASE}/b2b/gamification/leaderboard?period=all", headers=headers, timeout=5
        )
        d = r.json()
        assert d["count"] >= 1
        # We should appear in the list, likely #1.
        mine = [row for row in d["items"] if row["is_me"]]
        assert len(mine) == 1
        assert mine[0]["approved"] == 3
        assert mine[0]["tier"]["key"] == "bronze"
    finally:
        _cleanup()


def test_auth_required():
    r = requests.get(f"{BASE}/b2b/gamification/me", timeout=5)
    assert r.status_code == 401
