"""Tests for the conversion-attribution drill-down on /me/link-sources.

The aggregation rolls up paid orders by `attribution_source` (set on the
cart at /cart/coupon time and copied to the order at checkout). This file
verifies:
  • Paid orders with attribution_source="instagram" surface as
    `conversions=N` on the matching channel row.
  • Orders that never went through a UTM-tagged smart-link fall into the
    "direct" bucket via `$ifNull`.
  • Non-paid orders (status=initiated / failed) are excluded.
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
    await db.orders.delete_many({"ambassador_user_id": uid})


async def test_conversions_attributed_per_channel(transport):
    """Paid orders bucketed by attribution_source should surface on /me/link-sources."""
    code = f"CONV{uuid.uuid4().hex[:5].upper()}"
    uid = await _seed_ambassador(name="Conv Tester", code=code)
    now = datetime.now(timezone.utc)
    # Seed clicks: 5 IG, 3 WA, 2 direct
    click_rows = []
    for ip in ("ipA", "ipB", "ipC", "ipD", "ipE"):
        click_rows.append({"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": ip, "user_agent": "", "source": "instagram"})
    for ip in ("ipF", "ipG", "ipH"):
        click_rows.append({"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": ip, "user_agent": "", "source": "whatsapp"})
    for ip in ("ipI", "ipJ"):
        click_rows.append({"user_id": uid, "code": code, "type": "b2c", "ts": now, "ip_hash": ip, "user_agent": "", "source": "direct"})
    await db.ambassador_link_clicks.insert_many(click_rows)

    # Seed orders:
    #   2 paid IG conversions, 1 paid WA conversion, 1 paid direct (legacy / no source),
    #   1 unpaid IG (must NOT count).
    order_rows = [
        # IG paid #1
        {"id": f"ord_{uuid.uuid4().hex[:8]}", "user_id": "buyer_x", "ambassador_user_id": uid,
         "attribution_source": "instagram", "payment_status": "paid",
         "created_at": now, "total_nzd": 100.0},
        # IG paid #2 — uses "succeeded" as alt-status to verify the $in match.
        {"id": f"ord_{uuid.uuid4().hex[:8]}", "user_id": "buyer_y", "ambassador_user_id": uid,
         "attribution_source": "instagram", "payment_status": "succeeded",
         "created_at": now, "total_nzd": 80.0},
        # WA paid
        {"id": f"ord_{uuid.uuid4().hex[:8]}", "user_id": "buyer_z", "ambassador_user_id": uid,
         "attribution_source": "whatsapp", "payment_status": "paid",
         "created_at": now, "total_nzd": 60.0},
        # Legacy paid order — no attribution_source → buckets to "direct".
        {"id": f"ord_{uuid.uuid4().hex[:8]}", "user_id": "buyer_w", "ambassador_user_id": uid,
         "payment_status": "paid", "created_at": now, "total_nzd": 40.0},
        # Unpaid IG — must NOT be counted.
        {"id": f"ord_{uuid.uuid4().hex[:8]}", "user_id": "buyer_v", "ambassador_user_id": uid,
         "attribution_source": "instagram", "payment_status": "initiated",
         "created_at": now, "total_nzd": 999.0},
    ]
    await db.orders.insert_many(order_rows)

    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(
                "/api/ambassadors/me/link-sources?days=7",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200, r.text
        out = {row["source"]: row for row in r.json()}
        assert out["instagram"]["clicks"] == 5
        assert out["instagram"]["uniques"] == 5
        assert out["instagram"]["conversions"] == 2  # 2 paid, 1 unpaid excluded
        assert out["whatsapp"]["clicks"] == 3
        assert out["whatsapp"]["conversions"] == 1
        # The legacy "no-attribution_source" paid order should fall into "direct".
        assert out["direct"]["clicks"] == 2
        assert out["direct"]["conversions"] == 1
    finally:
        await _cleanup(uid)


async def test_conversions_with_no_clicks_still_show(transport):
    """A paid order with attribution_source set, but no matching clicks in
    the window (edge case after click table cleanup) should still appear so
    the ambassador sees the channel's revenue history.
    """
    code = f"NCLK{uuid.uuid4().hex[:5].upper()}"
    uid = await _seed_ambassador(name="NoClicks Tester", code=code)
    now = datetime.now(timezone.utc)
    await db.orders.insert_one({
        "id": f"ord_{uuid.uuid4().hex[:8]}",
        "user_id": "buyer_orphan",
        "ambassador_user_id": uid,
        "attribution_source": "tiktok",
        "payment_status": "paid",
        "created_at": now,
        "total_nzd": 50.0,
    })
    try:
        token = _token_for(uid)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(
                "/api/ambassadors/me/link-sources?days=7",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200
        out = {row["source"]: row for row in r.json()}
        assert "tiktok" in out
        assert out["tiktok"]["clicks"] == 0
        assert out["tiktok"]["uniques"] == 0
        assert out["tiktok"]["conversions"] == 1
    finally:
        await _cleanup(uid)
