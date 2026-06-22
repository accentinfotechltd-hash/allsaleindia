"""Tests that the /api/cart/coupon endpoint persists the optional `source`
field as `attribution_source` on the cart doc. The checkout endpoint then
copies this onto the resulting order so ambassador conversion-attribution
on `/me/link-sources` works correctly.
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


async def _seed_buyer_and_ambassador():
    """Create a buyer + B2C ambassador + product + cart pre-loaded with the
    product. Returns (buyer_id, code_b2c, pid, amb_id) so the caller can
    clean up.
    """
    buyer_id = f"user_{uuid.uuid4().hex[:10]}"
    amb_id = f"user_{uuid.uuid4().hex[:10]}"
    code_b2c = f"SRC{uuid.uuid4().hex[:5].upper()}"
    pid = f"prod_{uuid.uuid4().hex[:8]}"
    sid = f"seller_{uuid.uuid4().hex[:8]}"
    await db.users.insert_one({
        "id": buyer_id,
        "email": f"{buyer_id}@cart.test.local",
        "full_name": "Source Buyer",
        "country": "NZ",
        "is_seller": False,
        "is_admin": False,
        "email_verified": True,
        "password_hash": "x" * 30,
        "created_at": datetime.now(timezone.utc),
    })
    await db.users.insert_one({
        "id": amb_id,
        "email": f"{amb_id}@amb.test.local",
        "full_name": "Source Ambassador",
        "country": "NZ",
        "is_seller": False,
        "is_admin": False,
        "ambassador_profile": {
            "code": code_b2c,
            "code_b2b": None,
            "country": "NZ",
            "program": "B2C",
            "status": "active",
            "primary_platform": "instagram",
            "joined_at": datetime.now(timezone.utc),
        },
    })
    await db.coupons.insert_one({
        "id": f"cpn_{uuid.uuid4().hex[:8]}",
        "code": code_b2c,
        "label": "Source attribution test 5%",
        "type": "percent",
        "value": 5.0,
        "scope": "all",
        "active": True,
        "valid_from": datetime.now(timezone.utc),
        "min_order_nzd": 0.0,
        "max_discount_nzd": None,
        "per_user_limit": 999,
        "used_count": 0,
        "coupon_type": "ambassador_b2c",
        "ambassador_user_id": amb_id,
        "created_at": datetime.now(timezone.utc),
    })
    await db.products.insert_one({
        "id": pid,
        "name": "Test Product",
        "title": "Test Product",
        "image": "https://example.com/p.jpg",
        "price_nzd": 100.0,
        "price_inr": 5000.0,
        "currency_in": "INR",
        "stock": 10,
        "seller_id": sid,
        "is_active": True,
        "is_approved": True,
        "category": "fashion",
        "images": [],
        "created_at": datetime.now(timezone.utc),
    })
    await db.carts.insert_one({
        "user_id": buyer_id,
        "items": [{"product_id": pid, "quantity": 1}],
        "created_at": datetime.now(timezone.utc),
    })
    return buyer_id, code_b2c, pid, amb_id


async def _cleanup(buyer_id, code_b2c, pid, amb_id):
    await db.users.delete_one({"id": buyer_id})
    await db.users.delete_one({"id": amb_id})
    await db.carts.delete_one({"user_id": buyer_id})
    await db.coupons.delete_one({"code": code_b2c})
    await db.products.delete_one({"id": pid})


async def test_coupon_with_source_stores_attribution(transport):
    """POST /api/cart/coupon with `source` should set attribution_source on the cart doc."""
    buyer_id, code, pid, amb_id = await _seed_buyer_and_ambassador()
    try:
        token = _token_for(buyer_id)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                "/api/cart/coupon",
                json={"code": code, "source": "instagram"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200, r.text
        cart_doc = await db.carts.find_one({"user_id": buyer_id})
        assert cart_doc.get("attribution_source") == "instagram"
        assert cart_doc.get("coupon_code") == code
    finally:
        await _cleanup(buyer_id, code, pid, amb_id)


async def test_coupon_without_source_leaves_attribution_unset(transport):
    """POST /api/cart/coupon without `source` should not touch attribution_source."""
    buyer_id, code, pid, amb_id = await _seed_buyer_and_ambassador()
    try:
        token = _token_for(buyer_id)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                "/api/cart/coupon",
                json={"code": code},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200, r.text
        cart_doc = await db.carts.find_one({"user_id": buyer_id})
        # No source supplied — attribution_source remains unset (None / missing).
        assert not cart_doc.get("attribution_source")
        assert cart_doc.get("coupon_code") == code
    finally:
        await _cleanup(buyer_id, code, pid, amb_id)


async def test_coupon_source_rejected_when_too_long(transport):
    """Defensive: the request model enforces max_length=32 so a 100-char
    `source` is rejected with 422 (model-level validation) and never reaches
    the DB — protects against pathological UTM payloads."""
    buyer_id, code, pid, amb_id = await _seed_buyer_and_ambassador()
    try:
        token = _token_for(buyer_id)
        long_src = "A" * 100
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                "/api/cart/coupon",
                json={"code": code, "source": long_src},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 422, r.text
        # And the cart has NOT been mutated with the bogus source.
        cart_doc = await db.carts.find_one({"user_id": buyer_id})
        assert not cart_doc.get("attribution_source")
    finally:
        await _cleanup(buyer_id, code, pid, amb_id)
