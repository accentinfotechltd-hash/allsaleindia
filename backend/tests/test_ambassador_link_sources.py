"""Tests for click-source attribution:
  • POST /api/ambassadors/track-visit/{code} with UTM body / Referer header
    → normalized `source` stored on the click row.
  • GET  /api/ambassadors/me/link-sources?days=N → aggregated top channels.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone

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


async def _seed_ambassador(*, name: str, code: str) -> str:
    uid = f"user_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one({
        "id": uid,
        "email": f"{uid}@amb.test.local",
        "full_name": name,
        "country": "NZ",
        "is_seller": False,
        "is_admin": False,
        "ambassador_profile": {
            "code": code,
            "code_b2b": None,
            "country": "NZ",
            "program": "B2C",
            "status": "active",
            "primary_platform": "instagram",
            "joined_at": datetime.now(timezone.utc),
        },
    })
    return uid


async def _cleanup(uid: str):
    await db.users.delete_one({"id": uid})
    await db.ambassador_link_clicks.delete_many({"user_id": uid})


async def test_normalize_source_utm_priority(transport):
    """Explicit utm_source should win over Referer header."""
    code = f"UTM{uuid.uuid4().hex[:5].upper()}"
    uid = await _seed_ambassador(name="UTM Tester", code=code)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                f"/api/ambassadors/track-visit/{code}",
                json={"utm_source": "instagram", "utm_medium": "story"},
                headers={"Referer": "https://example.com/blog"},
            )
        assert r.status_code == 200
        row = await db.ambassador_link_clicks.find_one({"user_id": uid})
        assert row["source"] == "instagram"      # UTM beats referer
        assert row["utm_medium"] == "story"
        assert row["referrer"] == "https://example.com/blog"
    finally:
        await _cleanup(uid)


async def test_normalize_source_from_referer_header(transport):
    """When no UTM is provided, the Referer header host should drive the source."""
    code = f"REF{uuid.uuid4().hex[:5].upper()}"
    uid = await _seed_ambassador(name="Referer Tester", code=code)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r1 = await c.post(
                f"/api/ambassadors/track-visit/{code}",
                headers={"Referer": "https://l.instagram.com/?u=..."},
            )
            r2 = await c.post(
                f"/api/ambassadors/track-visit/{code}",
                headers={"Referer": "https://wa.me/64..."},
            )
            r3 = await c.post(
                f"/api/ambassadors/track-visit/{code}",
                # No referer / no UTM → "direct"
            )
        assert r1.status_code == r2.status_code == r3.status_code == 200
        rows = sorted(
            [d async for d in db.ambassador_link_clicks.find({"user_id": uid})],
            key=lambda d: d["ts"],
        )
        sources = [r["source"] for r in rows]
        assert sources == ["instagram", "whatsapp", "direct"]
    finally:
        await _cleanup(uid)


async def test_normalize_source_unknown_host_buckets_to_other(transport):
    code = f"OTH{uuid.uuid4().hex[:5].upper()}"
    uid = await _seed_ambassador(name="Other Tester", code=code)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                f"/api/ambassadors/track-visit/{code}",
                headers={"Referer": "https://random-blog.example.org/post/1"},
            )
        assert r.status_code == 200
        row = await db.ambassador_link_clicks.find_one({"user_id": uid})
        assert row["source"] == "other"
    finally:
        await _cleanup(uid)


async def test_link_sources_aggregation(transport):
    code = f"AGG{uuid.uuid4().hex[:5].upper()}"
    uid = await _seed_ambassador(name="Agg Tester", code=code)
    now = datetime.now(timezone.utc)
    # 4 Instagram clicks (2 unique IPs), 2 WhatsApp clicks (2 unique IPs),
    # 1 direct (1 unique).
    rows = [
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipA", "user_agent": "", "source": "instagram"},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipA", "user_agent": "", "source": "instagram"},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipB", "user_agent": "", "source": "instagram"},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipB", "user_agent": "", "source": "instagram"},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipC", "user_agent": "", "source": "whatsapp"},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipD", "user_agent": "", "source": "whatsapp"},
        {"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": "ipE", "user_agent": "", "source": "direct"},
    ]
    await db.ambassador_link_clicks.insert_many(rows)
    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(
                "/api/ambassadors/me/link-sources?days=7",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200, r.text
        out = r.json()
        # Sorted desc by clicks.
        assert [row["source"] for row in out] == ["instagram", "whatsapp", "direct"]
        ig = next(row for row in out if row["source"] == "instagram")
        assert ig["clicks"] == 4
        assert ig["uniques"] == 2
        wa = next(row for row in out if row["source"] == "whatsapp")
        assert wa["clicks"] == 2
        assert wa["uniques"] == 2
    finally:
        await _cleanup(uid)
