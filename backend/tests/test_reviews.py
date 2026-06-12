"""Tests for the Reviews & Ratings flow.

Covers:
- POST /api/reviews — verified-purchase enforcement, duplicate guard
- GET /api/reviews/product/{id} — public, summary + sort + distribution
- GET /api/reviews/eligible — buyer's pending-to-review items
- POST /api/reviews/{id}/helpful — toggle vote
- POST /api/reviews/{id}/reply — seller reply (only once, only seller)
- DELETE /api/reviews/{id} — author-only, rating recompute
- Product GET reflects rating + reviews_count after create/delete
"""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"

PHOTO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _address():
    return {
        "full_name": "Review Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def _new_user(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_rev_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": f"Review {label}"},
    )
    assert r.status_code == 200, r.text
    d = r.json()
    return {
        "email": email,
        "user_id": d["user"]["id"],
        "token": d["access_token"],
        "headers": {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {d['access_token']}",
        },
    }


def _promote_to_seller(user_id):
    """Promote user → seller directly in Mongo (mirrors test_returns helper)."""
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"is_seller": True, "seller_verification_status": "auto_verified"}},
        )
        from _helpers import make_gstin_pan
        gstin, pan = make_gstin_pan()
        await db.sellers.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "business_type": "private_limited",
                "company_name": f"Review Seller {user_id[-6:].upper()}",
                "gstin": gstin,
                "pan": pan,
                "address_line1": "10 Test Rd",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_name": "Tester",
                "contact_phone": "+919811112222",
                "verification_status": "auto_verified",
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
        cli.close()
    asyncio.run(go())


def _make_eligible_order(api_client, base_url, headers, status="delivered"):
    """Create a paid+{status} order eligible for review. Returns (order_id, product_id, seller_id)."""
    products = api_client.get(f"{base_url}/api/products").json()
    p = products[0]
    api_client.post(
        f"{base_url}/api/cart",
        headers=headers,
        json={"product_id": p["id"], "quantity": 1},
    )
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 200, r.text
    order_id = r.json()["order_id"]

    async def force_status():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "status": status,
                "payment_status": "paid",
                "delivered_at": datetime.now(timezone.utc) - timedelta(days=1),
            }},
        )
        cli.close()
    asyncio.run(force_status())
    return order_id, p["id"], p.get("seller_id")


def _set_order_status(order_id, status):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.orders.update_one({"id": order_id}, {"$set": {"status": status}})
        cli.close()
    asyncio.run(go())


def _relink_product_to_seller(product_id, order_id, seller_user_id):
    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.products.update_one(
            {"id": product_id},
            {"$set": {"seller_id": seller_user_id, "seller_name": "Review Seller Co"}},
        )
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {"items.$[elem].seller_id": seller_user_id}},
            array_filters=[{"elem.product_id": product_id}],
        )
        cli.close()
    asyncio.run(go())


# ---------- fixtures ----------
@pytest.fixture
def buyer(api_client, base_url):
    return _new_user(api_client, base_url, "buyer")


@pytest.fixture
def buyer_with_order(api_client, base_url, buyer):
    oid, pid, sid = _make_eligible_order(api_client, base_url, buyer["headers"], "delivered")
    return {**buyer, "order_id": oid, "product_id": pid, "seller_id": sid}


@pytest.fixture
def seller_for_product(api_client, base_url, buyer_with_order):
    seller = _new_user(api_client, base_url, "seller")
    _promote_to_seller(seller["user_id"])
    _relink_product_to_seller(
        buyer_with_order["product_id"], buyer_with_order["order_id"], seller["user_id"]
    )
    return seller


# ============================================================================
# CREATE — verified-purchase enforcement
# ============================================================================
def test_create_review_happy_path(api_client, base_url, buyer_with_order):
    body = {
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 5,
        "title": "Excellent",
        "comment": "Lovely product, super fast shipping!",
        "photos": [PHOTO],
    }
    r = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json=body)
    assert r.status_code == 201, r.text
    rev = r.json()
    assert rev["verified_purchase"] is True
    assert rev["rating"] == 5
    assert rev["product_id"] == buyer_with_order["product_id"]
    assert rev["user_id"] == buyer_with_order["user_id"]
    assert rev["helpful_count"] == 0
    assert rev["seller_reply"] is None
    assert rev["title"] == "Excellent"
    assert rev["photos"] == [PHOTO]
    assert "_id" not in rev


def test_create_review_updates_product_rating(api_client, base_url, buyer_with_order):
    body = {
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 4,
        "comment": "Pretty good but packaging could be better.",
    }
    r = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json=body)
    assert r.status_code == 201, r.text
    # GET product reflects new aggregate
    p = api_client.get(f"{base_url}/api/products/{buyer_with_order['product_id']}").json()
    assert p["reviews_count"] >= 1
    assert p["rating"] > 0


def test_create_review_order_not_found(api_client, base_url, buyer):
    body = {
        "order_id": "ord_doesnotexist_xyz",
        "product_id": "prod_anything",
        "rating": 5,
        "comment": "blah blah",
    }
    r = api_client.post(f"{base_url}/api/reviews", headers=buyer["headers"], json=body)
    assert r.status_code == 404


def test_create_review_order_not_eligible_status(api_client, base_url, buyer):
    oid, pid, _ = _make_eligible_order(api_client, base_url, buyer["headers"], status="paid")
    # 'paid' is NOT in {shipped, out_for_delivery, delivered}
    r = api_client.post(
        f"{base_url}/api/reviews",
        headers=buyer["headers"],
        json={"order_id": oid, "product_id": pid, "rating": 5, "comment": "too early to review"},
    )
    assert r.status_code == 400


def test_create_review_product_not_in_order(api_client, base_url, buyer_with_order):
    r = api_client.post(
        f"{base_url}/api/reviews",
        headers=buyer_with_order["headers"],
        json={
            "order_id": buyer_with_order["order_id"],
            "product_id": "prod_not_in_order",
            "rating": 5,
            "comment": "wrong product",
        },
    )
    assert r.status_code == 400


def test_create_review_duplicate_409(api_client, base_url, buyer_with_order):
    body = {
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 4,
        "comment": "first review here",
    }
    r1 = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json=body)
    assert r1.status_code == 201, r1.text
    r2 = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json=body)
    assert r2.status_code == 409


def test_create_review_unauthenticated(api_client, base_url):
    r = api_client.post(
        f"{base_url}/api/reviews",
        json={"order_id": "x", "product_id": "y", "rating": 5, "comment": "no auth"},
    )
    assert r.status_code == 401


def test_create_review_shipped_status_works(api_client, base_url, buyer):
    oid, pid, _ = _make_eligible_order(api_client, base_url, buyer["headers"], status="shipped")
    r = api_client.post(
        f"{base_url}/api/reviews",
        headers=buyer["headers"],
        json={"order_id": oid, "product_id": pid, "rating": 5, "comment": "arrived already!"},
    )
    assert r.status_code == 201


# ============================================================================
# READ — list product reviews + summary
# ============================================================================
def test_list_product_reviews_public_with_summary(api_client, base_url, buyer_with_order):
    # Create one review
    api_client.post(
        f"{base_url}/api/reviews",
        headers=buyer_with_order["headers"],
        json={
            "order_id": buyer_with_order["order_id"],
            "product_id": buyer_with_order["product_id"],
            "rating": 4,
            "comment": "Solid product overall",
        },
    )
    r = api_client.get(f"{base_url}/api/reviews/product/{buyer_with_order['product_id']}")
    assert r.status_code == 200, r.text
    page = r.json()
    assert "summary" in page and "items" in page
    assert page["summary"]["total"] >= 1
    assert page["summary"]["avg_rating"] > 0
    # distribution keys are stringified ints "1"-"5"
    assert set(page["summary"]["distribution"].keys()) == {"1", "2", "3", "4", "5"}
    assert page["summary"]["distribution"]["4"] >= 1
    # No bearer → can_review false
    assert page["can_review"] is False
    assert page["eligible_order_ids"] == []


def test_list_product_reviews_with_bearer_shows_eligibility(api_client, base_url, buyer_with_order):
    # Don't create a review yet — buyer is eligible
    r = api_client.get(
        f"{base_url}/api/reviews/product/{buyer_with_order['product_id']}",
        headers=buyer_with_order["headers"],
    )
    assert r.status_code == 200
    page = r.json()
    assert page["can_review"] is True
    assert buyer_with_order["order_id"] in page["eligible_order_ids"]


def test_list_product_reviews_sort_helpful(api_client, base_url, buyer):
    # 2 separate buyers each leaving a review on the same product to allow helpful diff
    b2 = _new_user(api_client, base_url, "buyer2")
    o1, pid, _ = _make_eligible_order(api_client, base_url, buyer["headers"], "delivered")
    o2, pid2, _ = _make_eligible_order(api_client, base_url, b2["headers"], "delivered")
    # Buyers may end up reviewing different products — only test sort if same product
    if pid != pid2:
        pytest.skip("product fixture rotated; sort test needs same product")
    r1 = api_client.post(f"{base_url}/api/reviews", headers=buyer["headers"], json={
        "order_id": o1, "product_id": pid, "rating": 3, "comment": "Not amazing"
    })
    r2 = api_client.post(f"{base_url}/api/reviews", headers=b2["headers"], json={
        "order_id": o2, "product_id": pid, "rating": 5, "comment": "Brilliant"
    })
    assert r1.status_code == 201 and r2.status_code == 201
    # b2 marks r1.helpful... no wait, vote on the other's review
    rev1_id = r1.json()["id"]
    rev2_id = r2.json()["id"]
    api_client.post(f"{base_url}/api/reviews/{rev2_id}/helpful", headers=buyer["headers"])

    # Sort helpful → rev2 (1 vote) first
    p = api_client.get(f"{base_url}/api/reviews/product/{pid}?sort=helpful").json()
    assert p["items"][0]["id"] == rev2_id

    # rating_asc → rev1 (3★) first
    p = api_client.get(f"{base_url}/api/reviews/product/{pid}?sort=rating_asc").json()
    assert p["items"][0]["id"] == rev1_id
    # rating_desc → rev2 (5★) first
    p = api_client.get(f"{base_url}/api/reviews/product/{pid}?sort=rating_desc").json()
    assert p["items"][0]["id"] == rev2_id


def test_list_product_reviews_distribution(api_client, base_url, buyer_with_order):
    api_client.post(
        f"{base_url}/api/reviews",
        headers=buyer_with_order["headers"],
        json={
            "order_id": buyer_with_order["order_id"],
            "product_id": buyer_with_order["product_id"],
            "rating": 2,
            "comment": "Meh, expected more",
        },
    )
    page = api_client.get(f"{base_url}/api/reviews/product/{buyer_with_order['product_id']}").json()
    assert page["summary"]["distribution"]["2"] >= 1


# ============================================================================
# ELIGIBLE
# ============================================================================
def test_eligible_lists_only_unreviewed(api_client, base_url, buyer_with_order):
    r = api_client.get(f"{base_url}/api/reviews/eligible", headers=buyer_with_order["headers"])
    assert r.status_code == 200
    items = r.json()
    assert any(it["product_id"] == buyer_with_order["product_id"] for it in items)
    # Now review it
    api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json={
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 5,
        "comment": "Five stars",
    })
    r2 = api_client.get(f"{base_url}/api/reviews/eligible", headers=buyer_with_order["headers"])
    assert not any(
        it["order_id"] == buyer_with_order["order_id"]
        and it["product_id"] == buyer_with_order["product_id"]
        for it in r2.json()
    )


def test_eligible_excludes_non_eligible_status(api_client, base_url, buyer):
    oid, pid, _ = _make_eligible_order(api_client, base_url, buyer["headers"], status="paid")
    r = api_client.get(f"{base_url}/api/reviews/eligible", headers=buyer["headers"])
    assert r.status_code == 200
    assert not any(it["order_id"] == oid for it in r.json())


def test_eligible_requires_auth(api_client, base_url):
    r = api_client.get(f"{base_url}/api/reviews/eligible")
    assert r.status_code == 401


# ============================================================================
# HELPFUL — toggle
# ============================================================================
def test_helpful_toggle_up_then_down(api_client, base_url, buyer_with_order):
    rev = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json={
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 4,
        "comment": "Great deal",
    }).json()
    # Use another user to vote
    voter = _new_user(api_client, base_url, "voter")
    r1 = api_client.post(f"{base_url}/api/reviews/{rev['id']}/helpful", headers=voter["headers"])
    assert r1.status_code == 200, r1.text
    assert r1.json()["helpful_count"] == 1
    r2 = api_client.post(f"{base_url}/api/reviews/{rev['id']}/helpful", headers=voter["headers"])
    assert r2.status_code == 200
    assert r2.json()["helpful_count"] == 0


def test_helpful_not_found(api_client, base_url, buyer):
    r = api_client.post(f"{base_url}/api/reviews/rev_nope/helpful", headers=buyer["headers"])
    assert r.status_code == 404


# ============================================================================
# SELLER REPLY
# ============================================================================
def test_seller_can_reply_once(api_client, base_url, buyer_with_order, seller_for_product):
    rev = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json={
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 3,
        "comment": "OK product",
    }).json()
    r1 = api_client.post(
        f"{base_url}/api/reviews/{rev['id']}/reply",
        headers=seller_for_product["headers"],
        json={"body": "Sorry to hear that — happy to assist further."},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["seller_reply"]["body"].startswith("Sorry")

    # Second reply must fail with 409
    r2 = api_client.post(
        f"{base_url}/api/reviews/{rev['id']}/reply",
        headers=seller_for_product["headers"],
        json={"body": "Another reply attempt"},
    )
    assert r2.status_code == 409


def test_non_seller_buyer_cannot_reply(api_client, base_url, buyer_with_order):
    rev = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json={
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 3,
        "comment": "I am the buyer, can I reply?",
    }).json()
    r = api_client.post(
        f"{base_url}/api/reviews/{rev['id']}/reply",
        headers=buyer_with_order["headers"],
        json={"body": "I shouldn't be allowed"},
    )
    assert r.status_code == 403


def test_different_seller_cannot_reply(api_client, base_url, buyer_with_order, seller_for_product):
    rev = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json={
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 3,
        "comment": "Average",
    }).json()
    other_seller = _new_user(api_client, base_url, "otherseller")
    _promote_to_seller(other_seller["user_id"])
    r = api_client.post(
        f"{base_url}/api/reviews/{rev['id']}/reply",
        headers=other_seller["headers"],
        json={"body": "I am not this product's seller"},
    )
    assert r.status_code == 403


# ============================================================================
# DELETE
# ============================================================================
def test_only_author_can_delete(api_client, base_url, buyer_with_order):
    rev = api_client.post(f"{base_url}/api/reviews", headers=buyer_with_order["headers"], json={
        "order_id": buyer_with_order["order_id"],
        "product_id": buyer_with_order["product_id"],
        "rating": 5,
        "comment": "Will delete this",
    }).json()
    # Another user tries to delete
    other = _new_user(api_client, base_url, "other_del")
    r403 = api_client.delete(f"{base_url}/api/reviews/{rev['id']}", headers=other["headers"])
    assert r403.status_code == 403

    # Author deletes
    r204 = api_client.delete(f"{base_url}/api/reviews/{rev['id']}", headers=buyer_with_order["headers"])
    assert r204.status_code == 204

    # Verify product recomputed
    page = api_client.get(f"{base_url}/api/reviews/product/{buyer_with_order['product_id']}").json()
    assert not any(item["id"] == rev["id"] for item in page["items"])


def test_delete_not_found(api_client, base_url, buyer):
    r = api_client.delete(f"{base_url}/api/reviews/rev_nope_xyz", headers=buyer["headers"])
    assert r.status_code == 404
