"""Tests for ambassador link-impression analytics:
  • POST /api/ambassadors/track-visit/{code} (public, fire-and-forget)
  • GET  /api/ambassadors/me/link-metrics (auth-only)
"""
from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from db import db
from server import app


@pytest.fixture
def transport():
    return ASGITransport(app=app)


def _token_for(user_id: str) -> str:
    from utils import create_token
    return create_token(user_id)


async def _seed_ambassador(*, name: str, code: str, country: str = "NZ",
                           program: str = "B2C", code_b2b: str | None = None) -> str:
    uid = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({
        "id": uid,
        "email": f"{uid}@amb.test.local",
        "full_name": name,
        "country": country,
        "is_seller": False,
        "is_admin": False,
        "ambassador_profile": {
            "code": code,
            "code_b2b": code_b2b,
            "country": country,
            "payout_currency": "NZD" if country == "NZ" else "USD",
            "program": program,
            "status": "active",
            "primary_platform": "instagram",
            "joined_at": datetime.now(timezone.utc),
        },
    })
    return uid


async def _cleanup(uid: str, *, codes: list[str] = ()):
    await db.users.delete_one({"id": uid})
    await db.ambassador_link_clicks.delete_many({"user_id": uid})
    for c in codes:
        await db.coupons.delete_one({"code": c})


async def test_track_visit_increments_b2c_counter(transport):
    code = f"TRACKB2C{uuid.uuid4().hex[:4].upper()}"
    uid = await _seed_ambassador(name="Track Tester", code=code)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r1 = await c.post(f"/api/ambassadors/track-visit/{code}")
            r2 = await c.post(f"/api/ambassadors/track-visit/{code.lower()}")
        assert r1.status_code == 200 and r1.json()["ok"] is True
        assert r2.status_code == 200 and r2.json()["ok"] is True

        rows = [d async for d in db.ambassador_link_clicks.find({"user_id": uid})]
        assert len(rows) == 2
        assert all(r["type"] == "b2c" for r in rows)

        u = await db.users.find_one({"id": uid}, {"_id": 0, "ambassador_profile": 1})
        prof = u["ambassador_profile"]
        assert prof.get("link_clicks_b2c") == 2
        assert prof.get("link_clicks_total") == 2
    finally:
        await _cleanup(uid)


async def test_track_visit_b2b_code_increments_b2b_counter(transport):
    code_b2b = f"TRACKBIZ{uuid.uuid4().hex[:4].upper()}"
    uid = await _seed_ambassador(name="Biz Tester", code="UNUSEDB2C", country="IN",
                                  program="B2B", code_b2b=code_b2b)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(f"/api/ambassadors/track-visit/{code_b2b}")
        assert r.status_code == 200
        rows = [d async for d in db.ambassador_link_clicks.find({"user_id": uid})]
        assert len(rows) == 1
        assert rows[0]["type"] == "b2b"
        u = await db.users.find_one({"id": uid}, {"_id": 0, "ambassador_profile": 1})
        assert u["ambassador_profile"].get("link_clicks_b2b") == 1
    finally:
        await _cleanup(uid)


async def test_track_visit_unknown_code_returns_ok_false(transport):
    """Beacon endpoint should never raise — invalid codes just return ok:false."""
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.post("/api/ambassadors/track-visit/DEFINITELYNOTACODE")
    assert r.status_code == 200
    assert r.json()["ok"] is False


async def test_me_link_metrics(transport):
    code = f"METRICS{uuid.uuid4().hex[:4].upper()}"
    uid = await _seed_ambassador(name="Metric Mike", code=code)
    # Backdate one click to 14d ago (still inside 30d) and one to 40d ago
    # (outside both 7d and 30d windows) to verify the count buckets.
    now = datetime.now(timezone.utc)
    # Three distinct visitors, one of which visits 3 times (so clicks > uniques).
    await db.ambassador_link_clicks.insert_many([
        {"user_id": uid, "code": code, "type": "b2c", "ts": now,                                "ip_hash": "hashA", "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now - timedelta(days=3),            "ip_hash": "hashA", "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now - timedelta(days=14),           "ip_hash": "hashB", "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now - timedelta(days=40),           "ip_hash": "hashC", "user_agent": ""},
    ])
    # Also drop in a paid order so conversions_30d ticks up.
    oid = f"order_{uuid.uuid4().hex[:8]}"
    await db.orders.insert_one({
        "id": oid,
        "ambassador_user_id": uid,
        "payment_status": "paid",
        "created_at": now,
    })
    # And a referred seller signup.
    seller_id = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({
        "id": seller_id,
        "email": f"{seller_id}@x.test.local",
        "full_name": "Referred Seller",
        "country": "IN",
        "is_seller": True,
        "is_admin": False,
        "referred_by_ambassador_id": uid,
        "created_at": now,
    })
    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get("/api/ambassadors/me/link-metrics",
                            headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        m = r.json()
        # 2 clicks in last 7 days (today + 3d ago); 3 in last 30 days; 4 lifetime rows but
        # `clicks_total` only counts the rolling counter which we haven't incremented (we
        # inserted rows directly bypassing the counter), so total may be 0.
        assert m["clicks_7d"] == 2
        assert m["clicks_30d"] == 3
        # Two distinct visitors in last 7d (but hashA appeared twice → 1 unique).
        assert m["uniques_7d"] == 1
        # Three distinct visitors in last 30d (hashA + hashB; hashC is at -40d).
        assert m["uniques_30d"] == 2
        assert m["conversions_30d"] == 1
        assert m["seller_signups_30d"] == 1
        # 1 conversion / 3 clicks_30d → 33.3%
        assert m["conversion_rate_30d"] == 33.3
    finally:
        await db.orders.delete_one({"id": oid})
        await db.users.delete_one({"id": seller_id})
        await _cleanup(uid)


async def test_me_link_metrics_404_for_non_ambassador(transport):
    uid = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({
        "id": uid, "email": f"{uid}@x.test.local", "full_name": "Not Ambassador",
        "country": "NZ", "is_seller": False, "is_admin": False,
        "created_at": datetime.now(timezone.utc),
    })
    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get("/api/ambassadors/me/link-metrics",
                            headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 404
    finally:
        await db.users.delete_one({"id": uid})


async def test_link_clicks_daily_returns_contiguous_series(transport):
    """Daily aggregation endpoint should return one row per day (no gaps)
    even when some days had zero clicks, so the dashboard chart can render
    a flat-baseline bar series without client-side gap-filling."""
    code = f"DAILY{uuid.uuid4().hex[:4].upper()}"
    uid = await _seed_ambassador(name="Daily Tester", code=code)
    now = datetime.now(timezone.utc)
    # Click distribution across the last 6 days, plus an old click far outside the window
    # to ensure it gets filtered.
    rows = [
        {"user_id": uid, "code": code, "type": "b2c", "ts": now,                            "ip_hash": None, "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now,                            "ip_hash": None, "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2b", "ts": now - timedelta(days=1),        "ip_hash": None, "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now - timedelta(days=2),        "ip_hash": None, "user_agent": ""},
        # day -3 intentionally empty
        {"user_id": uid, "code": code, "type": "b2c", "ts": now - timedelta(days=4),        "ip_hash": None, "user_agent": ""},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now - timedelta(days=120),      "ip_hash": None, "user_agent": ""},
    ]
    await db.ambassador_link_clicks.insert_many(rows)
    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(
                "/api/ambassadors/me/link-clicks-daily?days=7",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200, r.text
        series = r.json()
        # 7 contiguous days, each with date/b2c/b2b/total
        assert len(series) == 7
        for row in series:
            assert set(row.keys()) == {"date", "b2c", "b2b", "total"}
        # Total clicks in last 7 days = 5 (excluded the day -120 row)
        assert sum(s["total"] for s in series) == 5
        # Most recent day (last in array) should have 2 b2c clicks
        assert series[-1]["b2c"] == 2
        assert series[-1]["total"] == 2
        # Day -1 had a b2b click
        assert series[-2]["b2b"] == 1
        # Day -3 in the past = index (7-1-3) = 3 should be all zero
        assert series[3]["total"] == 0
    finally:
        await _cleanup(uid)


async def test_link_clicks_daily_caps_at_90(transport):
    """Caller-provided `days` should be clamped to [1, 90] to avoid expensive
    Mongo aggregations on a public-facing dashboard endpoint."""
    code = f"CAP{uuid.uuid4().hex[:4].upper()}"
    uid = await _seed_ambassador(name="Cap Tester", code=code)
    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(
                "/api/ambassadors/me/link-clicks-daily?days=9999",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200
        assert len(r.json()) == 90
    finally:
        await _cleanup(uid)
