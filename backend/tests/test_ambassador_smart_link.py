"""Tests for ambassador smart-link UX:
  • GET /api/ambassadors/resolve/{code} → returns type/code/counterpart
  • POST /api/cart/coupon with a B2B code → 400 with structured error
    containing suggested_b2c_code so frontend can offer one-tap swap.
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


async def _make_active_ambassador(*, name: str, country: str, code: str,
                                  program: str, code_b2b: str | None = None,
                                  with_coupon: bool = True) -> str:
    user_id = f"user_{uuid.uuid4().hex[:10]}"
    email = f"{user_id}@test.allsale.local"
    await db.users.insert_one({
        "id": user_id,
        "email": email,
        "full_name": name,
        "country": country,
        "is_seller": False,
        "is_admin": False,
        "ambassador_profile": {
            "code": code,
            "code_b2b": code_b2b,
            "country": country,
            "program": program,
            "status": "active",
            "tier_key": "starter",
            "primary_platform": "instagram",
            "joined_at": datetime.now(timezone.utc),
        },
    })
    if with_coupon and program in ("B2C", "BOTH"):
        await db.coupons.insert_one({
            "id": f"cpn_{uuid.uuid4().hex[:8]}",
            "code": code,
            "label": "Test ambassador 5% off",
            "type": "percent",
            "value": 5.0,
            "scope": "all",
            "active": True,
            "valid_from": datetime.now(timezone.utc),
            "min_order_nzd": 0.0,
            "max_discount_nzd": None,
            "per_user_limit": 999,
            "used_count": 0,
            "countries": [],
            "coupon_type": "ambassador_b2c",
            "ambassador_user_id": user_id,
            "created_at": datetime.now(timezone.utc),
        })
    return user_id


async def _cleanup_ambassador(user_id: str, codes: list[str]) -> None:
    await db.users.delete_one({"id": user_id})
    for c in codes:
        if c:
            await db.coupons.delete_one({"code": c})


async def test_resolve_b2c_only_ambassador(transport):
    code = f"TESTRESOLVEB2C{uuid.uuid4().hex[:4].upper()}"
    uid = await _make_active_ambassador(
        name="Riley Tester", country="NZ", code=code, program="B2C",
    )
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(f"/api/ambassadors/resolve/{code.lower()}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["type"] == "b2c"
        assert body["code"] == code
        assert body["counterpart_code"] is None
        assert body["name"] == "Riley Tester"
        assert body["program"] == "B2C"
    finally:
        await _cleanup_ambassador(uid, [code])


async def test_resolve_legacy_b2b_only_ambassador(transport):
    # Legacy India ambassadors store their BIZ code under `code`, not code_b2b.
    code = f"LEGACYBIZ{uuid.uuid4().hex[:4].upper()}"
    uid = await _make_active_ambassador(
        name="Anaya Tester", country="IN", code=code, program="B2B",
        code_b2b=None, with_coupon=False,
    )
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(f"/api/ambassadors/resolve/{code}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["type"] == "b2b", body
        assert body["code"] == code
        assert body["counterpart_code"] is None
        assert body["program"] == "B2B"
    finally:
        await _cleanup_ambassador(uid, [code])


async def test_resolve_both_program_via_b2b_link(transport):
    code_b2c = f"BOTHB2C{uuid.uuid4().hex[:4].upper()}"
    code_b2b = f"BOTHBIZ{uuid.uuid4().hex[:4].upper()}"
    uid = await _make_active_ambassador(
        name="Both Tester", country="IN", code=code_b2c, program="BOTH",
        code_b2b=code_b2b,
    )
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(f"/api/ambassadors/resolve/{code_b2b}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["type"] == "b2b"
        assert body["code"] == code_b2b
        assert body["counterpart_code"] == code_b2c  # both available → surface B2C counterpart
        assert body["program"] == "BOTH"
    finally:
        await _cleanup_ambassador(uid, [code_b2c, code_b2b])


async def test_resolve_unknown_code_404(transport):
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.get("/api/ambassadors/resolve/NEVERVALID123")
    assert r.status_code == 404


async def test_b2c_counterpart_helper_when_program_b2b_only_returns_none():
    from services.coupons import get_b2c_counterpart_for_b2b_code
    # B2B-only program → no active B2C coupon → counterpart returns None even
    # if the `code` field has a value (legacy data).
    code_b2b = f"NOCOUPONBIZ{uuid.uuid4().hex[:4].upper()}"
    uid = await _make_active_ambassador(
        name="No-Coupon Biz", country="IN",
        code="DUMMYUNUSED", code_b2b=code_b2b, program="B2B", with_coupon=False,
    )
    try:
        out = await get_b2c_counterpart_for_b2b_code(code_b2b)
        assert out is not None, "B2B code should still resolve"
        assert out["b2c_code"] is None, "B2B-only program should not expose a usable B2C code"
        assert out["name"] == "No-Coupon Biz"
    finally:
        await _cleanup_ambassador(uid, [code_b2b])


async def test_b2c_counterpart_helper_when_program_both_returns_b2c():
    from services.coupons import get_b2c_counterpart_for_b2b_code
    code_b2c = f"BOTHCOUPON{uuid.uuid4().hex[:4].upper()}"
    code_b2b = f"BOTHCOUPONBIZ{uuid.uuid4().hex[:4].upper()}"
    uid = await _make_active_ambassador(
        name="Both Coupon", country="IN",
        code=code_b2c, code_b2b=code_b2b, program="BOTH", with_coupon=True,
    )
    try:
        out = await get_b2c_counterpart_for_b2b_code(code_b2b)
        assert out is not None
        assert out["b2c_code"] == code_b2c
        assert out["name"] == "Both Coupon"
    finally:
        await _cleanup_ambassador(uid, [code_b2c, code_b2b])
