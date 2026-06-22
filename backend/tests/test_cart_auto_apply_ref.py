"""Verify that a B2C ambassador code, when applied via /api/cart/coupon,
yields the expected discount. The frontend's CartContext.maybeAutoApplyRef
calls this same endpoint with the cached ref.code on first cart load — so a
healthy 200 + discount here proves the auto-apply path works end-to-end.
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


async def test_b2c_ambassador_code_applies_at_cart(transport):
    buyer_id = f"user_{uuid.uuid4().hex[:10]}"
    pid = f"prod_{uuid.uuid4().hex[:8]}"
    sid = f"seller_{uuid.uuid4().hex[:8]}"
    amb_id = f"user_{uuid.uuid4().hex[:10]}"
    code_b2c = f"AUTO{uuid.uuid4().hex[:5].upper()}"

    await db.users.insert_one({
        "id": buyer_id,
        "email": f"{buyer_id}@cart.test.local",
        "full_name": "Auto Buyer",
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
        "full_name": "Auto Ambassador",
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
        "label": "Auto-apply test 5%",
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
    try:
        token = _token_for(buyer_id)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            # Auto-apply emulates exactly what CartContext.maybeAutoApplyRef does:
            # POST the stored ref.code to /cart/coupon and expect 200 + discount.
            r = await c.post(
                "/api/cart/coupon",
                json={"code": code_b2c},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["coupon_code"] == code_b2c
        # 5% of $100 = $5 discount applied
        assert body["discount_nzd"] == 5.0, body
        assert body["subtotal_nzd"] == 100.0
    finally:
        await db.users.delete_one({"id": buyer_id})
        await db.users.delete_one({"id": amb_id})
        await db.carts.delete_one({"user_id": buyer_id})
        await db.coupons.delete_one({"code": code_b2c})
        await db.products.delete_one({"id": pid})


async def test_b2b_program_skip_auto_apply_is_safe(transport):
    """When the stored ref code is a legacy B2B-only ambassador's code, the
    frontend SHOULD skip the auto-apply call. But if it doesn't, the backend
    must still respond with a structured 400 (not a 500 or generic error)."""
    buyer_id = f"user_{uuid.uuid4().hex[:10]}"
    amb_id = f"user_{uuid.uuid4().hex[:10]}"
    code_b2b = f"BIZAUTO{uuid.uuid4().hex[:4].upper()}"
    pid = f"prod_{uuid.uuid4().hex[:8]}"

    await db.users.insert_one({
        "id": buyer_id,
        "email": f"{buyer_id}@cart.test.local",
        "full_name": "Skip Buyer",
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
        "full_name": "Biz Only",
        "country": "IN",
        "is_seller": False,
        "is_admin": False,
        "ambassador_profile": {
            "code": "UNUSEDB2C",
            "code_b2b": code_b2b,
            "country": "IN",
            "program": "B2B",
            "status": "active",
            "primary_platform": "instagram",
            "joined_at": datetime.now(timezone.utc),
        },
    })
    await db.products.insert_one({
        "id": pid,
        "name": "Test Prod",
        "title": "Test Prod",
        "image": "https://example.com/p.jpg",
        "price_nzd": 50.0,
        "price_inr": 2500.0,
        "currency_in": "INR",
        "stock": 10,
        "seller_id": f"seller_{uuid.uuid4().hex[:8]}",
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
    try:
        token = _token_for(buyer_id)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.post(
                "/api/cart/coupon",
                json={"code": code_b2b},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert r.status_code == 400, r.text
        detail = r.json().get("detail")
        assert isinstance(detail, dict)
        assert detail["error_code"] == "wrong_audience_b2b"
        # No B2C counterpart exists for B2B-only program → suggested_b2c_code is None.
        assert detail["suggested_b2c_code"] is None
    finally:
        await db.users.delete_one({"id": buyer_id})
        await db.users.delete_one({"id": amb_id})
        await db.carts.delete_one({"user_id": buyer_id})
        await db.products.delete_one({"id": pid})
