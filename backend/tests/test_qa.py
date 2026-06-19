"""Tests for Product Q&A — `/api/products/{id}/questions` + answers.

Covers:
  - Auth: ask/answer/vote require login (401); list is public.
  - Question validation: min_length=5, max_length=500.
  - Answer validation: min_length=2, max_length=1000.
  - 404 when product / question / answer doesn't exist.
  - Listing schema: question carries top_answer + answer_count.
  - Sort: helpful (upvotes desc) vs recent (created_at desc).
  - Upvote toggle is idempotent (up then up = still 1; clear removes).
  - Helpful vote toggle on answers behaves the same way.
  - Seller answering own listing gets is_seller=True.
  - Verified-purchase buyer gets is_verified_purchase=True on their answer.
  - answer_count increments when a new answer is posted.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from tests._helpers import make_gstin_pan
from tests.conftest import run_async


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _seed_product(seller_id: str | None = None) -> str:
    pid = f"prod_qa_{uuid.uuid4().hex[:10]}"

    async def go():
        cli, db = await _db()
        await db.products.insert_one(
            {
                "id": pid,
                "name": "QA Test Product",
                "description": "Just a test product for Q&A",
                "category": "Electronics",
                "subcategory": "Audio",
                "price_nzd": 25.0,
                "price_inr": 1250,
                "image": "https://placehold.co/200",
                "rating": 4.5,
                "reviews_count": 0,
                "in_stock": True,
                "stock_count": 50,
                "seller_id": seller_id,
                "seller_name": "QA Co",
            }
        )
        cli.close()

    run_async(go())
    return pid


def _cleanup(pids: list[str]):
    async def go():
        cli, db = await _db()
        if pids:
            await db.products.delete_many({"id": {"$in": pids}})
            await db.product_questions.delete_many({"product_id": {"$in": pids}})
            await db.product_answers.delete_many({"product_id": {"$in": pids}})
            await db.orders.delete_many({"items.product_id": {"$in": pids}})
        cli.close()

    run_async(go())


def _seller_headers(api_client, base_url):
    email = f"qa_seller_{uuid.uuid4().hex[:10]}@allsale.co.nz"
    gstin, pan = make_gstin_pan()
    r = api_client.post(
        f"{base_url}/api/seller/register",
        json={
            "email": email,
            "password": "Test1234!",
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "QA Sellers",
                "gstin": gstin,
                "pan": pan,
                "address_line1": "1 MG Road",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_name": "QA Tester",
                "contact_phone": "+919999999999",
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    return {
        "user_id": body["user"]["id"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
    }


# ===========================================================================
# Auth
# ===========================================================================
class TestAuth:
    def test_list_is_public(self, api_client, base_url):
        pid = _seed_product()
        try:
            r = api_client.get(
                f"{base_url}/api/products/{pid}/questions"
            )
            assert r.status_code == 200
        finally:
            _cleanup([pid])

    def test_ask_requires_auth(self, api_client, base_url):
        pid = _seed_product()
        try:
            r = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Is this real silk?"},
            )
            assert r.status_code in (401, 403)
        finally:
            _cleanup([pid])

    def test_answer_requires_auth(self, api_client, base_url):
        r = api_client.post(
            f"{base_url}/api/questions/qst_nonexistent/answers",
            json={"text": "yes"},
        )
        assert r.status_code in (401, 403)


# ===========================================================================
# Validation
# ===========================================================================
class TestValidation:
    def test_ask_too_short(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            r = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "hi"},  # 2 chars
                headers=auth_headers,
            )
            assert r.status_code == 422
        finally:
            _cleanup([pid])

    def test_ask_too_long(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            r = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "x" * 600},
                headers=auth_headers,
            )
            assert r.status_code == 422
        finally:
            _cleanup([pid])

    def test_answer_too_short(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            ask = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Does this come in red?"},
                headers=auth_headers,
            )
            qid = ask.json()["id"]
            r = api_client.post(
                f"{base_url}/api/questions/{qid}/answers",
                json={"text": "y"},  # 1 char
                headers=auth_headers,
            )
            assert r.status_code == 422
        finally:
            _cleanup([pid])


# ===========================================================================
# 404 paths
# ===========================================================================
class TestNotFound:
    def test_ask_on_unknown_product(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/products/totally-not-real/questions",
            json={"text": "Will this ship to NZ?"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_answer_unknown_question(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/questions/qst_does_not_exist/answers",
            json={"text": "yes"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_vote_unknown_question(self, api_client, base_url, auth_headers):
        r = api_client.post(
            f"{base_url}/api/questions/qst_nope/vote",
            json={"direction": "up"},
            headers=auth_headers,
        )
        assert r.status_code == 404


# ===========================================================================
# Listing schema + ordering
# ===========================================================================
class TestListingShape:
    def test_question_carries_top_answer_and_count(
        self, api_client, base_url, auth_headers
    ):
        pid = _seed_product()
        try:
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Does this run small?"},
                headers=auth_headers,
            ).json()
            api_client.post(
                f"{base_url}/api/questions/{q['id']}/answers",
                json={"text": "Yes, order one size up."},
                headers=auth_headers,
            )
            api_client.post(
                f"{base_url}/api/questions/{q['id']}/answers",
                json={"text": "Fits true to size for me."},
                headers=auth_headers,
            )
            r = api_client.get(
                f"{base_url}/api/products/{pid}/questions"
            )
            row = r.json()["items"][0]
            assert row["answer_count"] == 2
            assert row["top_answer"] is not None
            assert "is_seller" in row["top_answer"]
            assert "is_verified_purchase" in row["top_answer"]
        finally:
            _cleanup([pid])

    def test_sort_helpful_vs_recent(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            q1 = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "First question — old"},
                headers=auth_headers,
            ).json()
            q2 = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Second question — newer but unvoted"},
                headers=auth_headers,
            ).json()
            # Upvote q1
            api_client.post(
                f"{base_url}/api/questions/{q1['id']}/vote",
                json={"direction": "up"},
                headers=auth_headers,
            )

            # helpful sort → q1 first
            helpful = api_client.get(
                f"{base_url}/api/products/{pid}/questions?sort=helpful"
            ).json()
            assert helpful["items"][0]["id"] == q1["id"]

            # recent sort → q2 first
            recent = api_client.get(
                f"{base_url}/api/products/{pid}/questions?sort=recent"
            ).json()
            assert recent["items"][0]["id"] == q2["id"]
        finally:
            _cleanup([pid])


# ===========================================================================
# Voting toggles
# ===========================================================================
class TestVoting:
    def test_upvote_is_idempotent(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Repeatable vote?"},
                headers=auth_headers,
            ).json()
            api_client.post(
                f"{base_url}/api/questions/{q['id']}/vote",
                json={"direction": "up"},
                headers=auth_headers,
            )
            api_client.post(
                f"{base_url}/api/questions/{q['id']}/vote",
                json={"direction": "up"},
                headers=auth_headers,
            )
            r = api_client.get(
                f"{base_url}/api/products/{pid}/questions",
                headers=auth_headers,
            )
            row = r.json()["items"][0]
            assert row["upvotes"] == 1
            assert row["is_upvoted_by_me"] is True
        finally:
            _cleanup([pid])

    def test_clear_undoes_upvote(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Toggle test"},
                headers=auth_headers,
            ).json()
            api_client.post(
                f"{base_url}/api/questions/{q['id']}/vote",
                json={"direction": "up"},
                headers=auth_headers,
            )
            api_client.post(
                f"{base_url}/api/questions/{q['id']}/vote",
                json={"direction": "clear"},
                headers=auth_headers,
            )
            r = api_client.get(
                f"{base_url}/api/products/{pid}/questions",
                headers=auth_headers,
            )
            row = r.json()["items"][0]
            assert row["upvotes"] == 0
            assert row["is_upvoted_by_me"] is False
        finally:
            _cleanup([pid])

    def test_helpful_vote_on_answer(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Answer voting test"},
                headers=auth_headers,
            ).json()
            a = api_client.post(
                f"{base_url}/api/questions/{q['id']}/answers",
                json={"text": "Sure, here's an answer."},
                headers=auth_headers,
            ).json()
            api_client.post(
                f"{base_url}/api/answers/{a['id']}/helpful",
                json={"direction": "up"},
                headers=auth_headers,
            )
            answers = api_client.get(
                f"{base_url}/api/questions/{q['id']}/answers",
                headers=auth_headers,
            ).json()["items"]
            assert answers[0]["helpful_count"] == 1
            assert answers[0]["is_helpful_to_me"] is True
        finally:
            _cleanup([pid])


# ===========================================================================
# Seller badge
# ===========================================================================
class TestSellerBadge:
    def test_seller_answering_own_listing(self, api_client, base_url, auth_headers):
        seller = _seller_headers(api_client, base_url)
        pid = _seed_product(seller_id=seller["user_id"])
        try:
            # Buyer asks
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "Hi seller, is this authentic?"},
                headers=auth_headers,
            ).json()
            # Seller answers
            a = api_client.post(
                f"{base_url}/api/questions/{q['id']}/answers",
                json={"text": "Yes, 100% authentic."},
                headers=seller["headers"],
            ).json()
            assert a["is_seller"] is True
            assert a["is_verified_purchase"] is False
        finally:
            _cleanup([pid])

    def test_verified_purchase_badge_when_buyer_has_paid_order(
        self, api_client, base_url, auth_headers, test_user
    ):
        """Seed a paid order containing the product for the buyer, then have
        the buyer answer their own question — is_verified_purchase must be True."""
        pid = _seed_product()
        buyer_id = test_user["user"]["id"]

        async def seed_paid_order():
            cli, db = await _db()
            await db.orders.insert_one(
                {
                    "id": f"ord_qa_{uuid.uuid4().hex[:10]}",
                    "user_id": buyer_id,
                    "items": [
                        {
                            "product_id": pid,
                            "name": "QA Test Product",
                            "qty": 1,
                            "price_inr": 1250,
                        }
                    ],
                    "payment_status": "paid",
                    "status": "delivered",
                    "created_at": datetime.now(timezone.utc),
                }
            )
            cli.close()

        run_async(seed_paid_order())

        try:
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "How is the build quality?"},
                headers=auth_headers,
            ).json()
            a = api_client.post(
                f"{base_url}/api/questions/{q['id']}/answers",
                json={"text": "Build is solid, very happy with it."},
                headers=auth_headers,
            ).json()
            assert a["is_seller"] is False
            assert a["is_verified_purchase"] is True
        finally:
            _cleanup([pid])

    def test_answer_count_increments(self, api_client, base_url, auth_headers):
        pid = _seed_product()
        try:
            q = api_client.post(
                f"{base_url}/api/products/{pid}/questions",
                json={"text": "How many answers can this get?"},
                headers=auth_headers,
            ).json()
            assert q["answer_count"] == 0
            for i in range(3):
                api_client.post(
                    f"{base_url}/api/questions/{q['id']}/answers",
                    json={"text": f"Answer number {i}"},
                    headers=auth_headers,
                )
            r = api_client.get(f"{base_url}/api/products/{pid}/questions").json()
            assert r["items"][0]["answer_count"] == 3
        finally:
            _cleanup([pid])
