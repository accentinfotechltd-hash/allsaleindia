"""Tests for the order delivery-rating + ships-well badge.

Covers:
  - POST /orders/{id}/delivery-rating requires auth.
  - 404 if not the buyer's order.
  - 400 if order not yet delivered.
  - Valid 1-5 star submission writes to order doc and increments per-seller
    aggregates.
  - Resubmit updates rating without double-counting (sum delta correct).
  - Stars outside [1,5] → 422.
  - GET /sellers/{id}/delivery-score is public, hides ships_well until
    count>=5 and avg>=4.0.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from tests.conftest import run_async


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _seed_order(
    *,
    user_id: str,
    seller_id: str,
    status: str = "delivered",
    payment_status: str = "paid",
) -> str:
    oid = f"order_rate_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc)

    async def go():
        cli, db = await _db()
        await db.orders.insert_one(
            {
                "id": oid,
                "user_id": user_id,
                "items": [
                    {
                        "product_id": f"prod_{uuid.uuid4().hex[:8]}",
                        "name": "x",
                        "seller_id": seller_id,
                        "quantity": 1,
                        "price_nzd": 25.0,
                    }
                ],
                "total_nzd": 25.0,
                "payment_status": payment_status,
                "status": status,
                "paid_at": now,
                "created_at": now,
                "delivered_at": now if status == "delivered" else None,
            }
        )
        cli.close()

    run_async(go())
    return oid


def _seed_seller(*, score_sum: int = 0, count: int = 0) -> str:
    sid = f"seller_rate_{uuid.uuid4().hex[:10]}"

    async def go():
        cli, db = await _db()
        await db.sellers.insert_one(
            {
                "id": sid,
                "user_id": sid,
                "company_name": "Rate Test Co",
                "delivery_score_sum": score_sum,
                "delivery_score_count": count,
            }
        )
        cli.close()

    run_async(go())
    return sid


def _cleanup_order(oid: str):
    async def go():
        cli, db = await _db()
        await db.orders.delete_many({"id": oid})
        cli.close()

    run_async(go())


def _cleanup_seller(sid: str):
    async def go():
        cli, db = await _db()
        await db.sellers.delete_many({"user_id": sid})
        cli.close()

    run_async(go())


def _get_uid(api_client, base_url, headers):
    return api_client.get(f"{base_url}/api/auth/me", headers=headers).json()["id"]


class TestAuth:
    def test_requires_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/orders/fake/delivery-rating",
            json={"stars": 5},
        )
        assert r.status_code in (401, 403)

    def test_other_users_order_404(self, api_client, base_url, auth_headers):
        seller = _seed_seller()
        oid = _seed_order(user_id="not_me", seller_id=seller)
        try:
            r = api_client.post(
                f"{base_url}/api/orders/{oid}/delivery-rating",
                json={"stars": 5},
                headers=auth_headers,
            )
            assert r.status_code == 404
        finally:
            _cleanup_order(oid)
            _cleanup_seller(seller)


class TestStateGate:
    def test_pending_order_returns_400(
        self, api_client, base_url, auth_headers
    ):
        uid = _get_uid(api_client, base_url, auth_headers)
        seller = _seed_seller()
        oid = _seed_order(user_id=uid, seller_id=seller, status="paid")
        try:
            r = api_client.post(
                f"{base_url}/api/orders/{oid}/delivery-rating",
                json={"stars": 5},
                headers=auth_headers,
            )
            assert r.status_code == 400
        finally:
            _cleanup_order(oid)
            _cleanup_seller(seller)


class TestStarsRange:
    def test_stars_zero_rejected(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/orders/whatever/delivery-rating",
            json={"stars": 0},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_stars_six_rejected(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/orders/whatever/delivery-rating",
            json={"stars": 6},
            headers=auth_headers,
        )
        assert r.status_code == 422


class TestSubmit:
    def test_submit_increments_seller_aggregates(
        self, api_client, base_url, auth_headers
    ):
        uid = _get_uid(api_client, base_url, auth_headers)
        seller = _seed_seller()
        oid = _seed_order(user_id=uid, seller_id=seller)
        try:
            r = api_client.post(
                f"{base_url}/api/orders/{oid}/delivery-rating",
                json={"stars": 5, "comment": "Fast & well packed!"},
                headers=auth_headers,
            )
            assert r.status_code == 200
            body = r.json()
            assert body["delivery_rating"]["stars"] == 5

            score = api_client.get(
                f"{base_url}/api/sellers/{seller}/delivery-score"
            ).json()
            assert score["ratings_count"] == 1
            assert score["avg_stars"] == 5.0
            assert score["ships_well"] is False  # need 5+ ratings
        finally:
            _cleanup_order(oid)
            _cleanup_seller(seller)

    def test_resubmit_updates_without_double_counting(
        self, api_client, base_url, auth_headers
    ):
        uid = _get_uid(api_client, base_url, auth_headers)
        seller = _seed_seller()
        oid = _seed_order(user_id=uid, seller_id=seller)
        try:
            api_client.post(
                f"{base_url}/api/orders/{oid}/delivery-rating",
                json={"stars": 3},
                headers=auth_headers,
            )
            api_client.post(
                f"{base_url}/api/orders/{oid}/delivery-rating",
                json={"stars": 5},
                headers=auth_headers,
            )
            score = api_client.get(
                f"{base_url}/api/sellers/{seller}/delivery-score"
            ).json()
            # Still 1 rating, but the stars updated 3 → 5
            assert score["ratings_count"] == 1
            assert score["avg_stars"] == 5.0
        finally:
            _cleanup_order(oid)
            _cleanup_seller(seller)


class TestShipsWellBadge:
    def test_under_five_ratings_no_badge(self, api_client, base_url):
        seller = _seed_seller(score_sum=20, count=4)  # 5.0 avg but only 4 ratings
        try:
            score = api_client.get(
                f"{base_url}/api/sellers/{seller}/delivery-score"
            ).json()
            assert score["ships_well"] is False
        finally:
            _cleanup_seller(seller)

    def test_low_avg_no_badge(self, api_client, base_url):
        # 6 ratings averaging 3.5 → no badge
        seller = _seed_seller(score_sum=21, count=6)
        try:
            score = api_client.get(
                f"{base_url}/api/sellers/{seller}/delivery-score"
            ).json()
            assert score["avg_stars"] == 3.5
            assert score["ships_well"] is False
        finally:
            _cleanup_seller(seller)

    def test_qualified_seller_has_badge(self, api_client, base_url):
        # 6 ratings averaging 4.5 → ships_well=True
        seller = _seed_seller(score_sum=27, count=6)
        try:
            score = api_client.get(
                f"{base_url}/api/sellers/{seller}/delivery-score"
            ).json()
            assert score["avg_stars"] == 4.5
            assert score["ships_well"] is True
        finally:
            _cleanup_seller(seller)

    def test_unknown_seller_returns_empty(self, api_client, base_url):
        r = api_client.get(
            f"{base_url}/api/sellers/no_such_seller/delivery-score"
        )
        assert r.status_code == 200
        body = r.json()
        assert body["avg_stars"] is None
        assert body["ratings_count"] == 0
        assert body["ships_well"] is False
