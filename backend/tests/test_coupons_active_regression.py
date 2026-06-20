"""Regression tests for /api/coupons/active filtering.

Specifically guards against the iteration-46 500 bug where ambassador-issued
coupons (with `description=None`) tripped Pydantic validation of CouponPublic.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from tests.conftest import run_async


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _seed_coupon(**overrides) -> str:
    cid = f"cpn_test_{uuid.uuid4().hex[:8]}"
    code = overrides.pop("code", f"TESTGEN{uuid.uuid4().hex[:6].upper()}")
    now = datetime.now(timezone.utc)
    doc = {
        "id": cid,
        "code": code,
        "description": "Standard sitewide promo for regression",
        "type": "percentage",
        "value": 10.0,
        "min_order_nzd": 20.0,
        "max_discount_nzd": 25.0,
        "scope": "all",
        "countries": [],
        "active": True,
        "valid_from": now,
        "valid_to": now + timedelta(days=7),
        "used_count": 0,
        "created_at": now,
    }
    doc.update(overrides)

    async def go():
        cli, db = await _db()
        await db.coupons.delete_one({"code": code})
        await db.coupons.insert_one(doc)
        cli.close()

    run_async(go())
    return code


def _delete_coupon(code: str):
    async def go():
        cli, db = await _db()
        await db.coupons.delete_one({"code": code})
        cli.close()

    run_async(go())


class TestCouponsActiveRegression:
    def test_ambassador_coupons_excluded_from_public_list(
        self, api_client, base_url, auth_headers
    ):
        """`cpn_amb_*` codes should NOT appear in /coupons/active —
        they're personal referral codes, not sitewide promos. Previously
        these crashed the endpoint with a 500 (Pydantic ValidationError
        on `description: str` being None)."""
        amb_id = f"cpn_amb_{uuid.uuid4().hex[:8]}"
        code = f"NZAMBREG{uuid.uuid4().hex[:6].upper()}"
        # Use raw insert to bypass _seed_coupon's default description
        async def insert():
            cli, db = await _db()
            await db.coupons.delete_one({"code": code})
            await db.coupons.insert_one(
                {
                    "id": amb_id,
                    "code": code,
                    "description": None,  # <- the original crasher
                    "type": "percentage",
                    "value": 5.0,
                    "min_order_nzd": 0,
                    "scope": "all",
                    "countries": [],
                    "active": True,
                    "valid_from": datetime.now(timezone.utc),
                    "valid_to": datetime.now(timezone.utc) + timedelta(days=7),
                    "used_count": 0,
                    "created_at": datetime.now(timezone.utc),
                }
            )
            cli.close()

        run_async(insert())
        try:
            r = api_client.get(
                f"{base_url}/api/coupons/active", headers=auth_headers
            )
            assert r.status_code == 200, r.text
            codes = {c["code"] for c in r.json()}
            assert code not in codes
        finally:
            _delete_coupon(code)

    def test_sitewide_promo_appears(
        self, api_client, base_url, auth_headers
    ):
        code = _seed_coupon(
            description="Reg-test promo — sitewide", value=15.0
        )
        try:
            r = api_client.get(
                f"{base_url}/api/coupons/active", headers=auth_headers
            )
            assert r.status_code == 200
            codes = {c["code"] for c in r.json()}
            assert code in codes
        finally:
            _delete_coupon(code)

    def test_inactive_excluded(self, api_client, base_url, auth_headers):
        code = _seed_coupon(active=False)
        try:
            r = api_client.get(
                f"{base_url}/api/coupons/active", headers=auth_headers
            )
            assert r.status_code == 200
            codes = {c["code"] for c in r.json()}
            assert code not in codes
        finally:
            _delete_coupon(code)

    def test_expired_excluded(self, api_client, base_url, auth_headers):
        code = _seed_coupon(
            valid_to=datetime.now(timezone.utc) - timedelta(days=1)
        )
        try:
            r = api_client.get(
                f"{base_url}/api/coupons/active", headers=auth_headers
            )
            codes = {c["code"] for c in r.json()}
            assert code not in codes
        finally:
            _delete_coupon(code)

    def test_endpoint_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/coupons/active")
        assert r.status_code in (401, 403)
