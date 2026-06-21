"""Tests for the strict B2B / B2C separation on ambassador codes.

The economics of the Ambassador Programme rely on a clean split:
  * B2C codes are customer-discount coupons (5% off shopper's order)
  * B2B codes are seller-recruit identifiers (bounty + rev-share)

Mixing them would distort both incentives, so the platform must reject
cross-use in both directions.
"""
from __future__ import annotations

import asyncio

import pytest

from db import db
from routers.seller.onboarding import _link_ambassador_referral
from services.coupons import is_ambassador_b2b_code


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

async def _make_ambassador(user_id: str, b2c: str, b2b: str) -> None:
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "id": user_id,
                "email": f"{user_id}@example.com",
                "ambassador_profile": {
                    "code": b2c,
                    "code_b2b": b2b,
                    "status": "active",
                    "referred_sellers_count": 0,
                },
            }
        },
        upsert=True,
    )


async def _make_seller(user_id: str) -> None:
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"id": user_id, "email": f"{user_id}@example.com", "is_seller": True}},
        upsert=True,
    )


@pytest.fixture
async def amb_and_seller():
    """Provision an ambassador with both codes + a fresh seller user."""
    amb_id = "amb_test_strict_split"
    seller_id = "seller_test_strict_split"
    await _make_ambassador(amb_id, "SARAH-NZ", "SARAH-RECRUIT-IN")
    await _make_seller(seller_id)
    yield amb_id, seller_id
    # cleanup
    await db.users.delete_one({"id": amb_id})
    await db.users.delete_one({"id": seller_id})


# ---------------------------------------------------------------------------
# Seller-side: only B2B codes attribute. B2C codes should be REJECTED.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_b2b_code_attributes_seller(amb_and_seller):
    """The happy path — B2B code on seller signup links them to the ambassador."""
    amb_id, seller_id = amb_and_seller
    await _link_ambassador_referral(seller_id, "SARAH-RECRUIT-IN")
    seller = await db.users.find_one({"id": seller_id}, {"_id": 0})
    assert seller["referred_by_ambassador_id"] == amb_id
    amb = await db.users.find_one({"id": amb_id}, {"_id": 0})
    assert amb["ambassador_profile"]["referred_sellers_count"] == 1


@pytest.mark.asyncio
async def test_b2c_code_at_seller_signup_raises_400(amb_and_seller):
    """Pasting a B2C customer-discount code on seller signup must raise 400
    with a clear, actionable message — not silently attribute, not crash."""
    from fastapi import HTTPException

    amb_id, seller_id = amb_and_seller
    with pytest.raises(HTTPException) as exc:
        await _link_ambassador_referral(seller_id, "SARAH-NZ")
    assert exc.value.status_code == 400
    assert "customer-discount" in exc.value.detail.lower()
    # ...and crucially: NO attribution happened
    seller = await db.users.find_one({"id": seller_id}, {"_id": 0})
    assert "referred_by_ambassador_id" not in seller
    amb = await db.users.find_one({"id": amb_id}, {"_id": 0})
    assert amb["ambassador_profile"]["referred_sellers_count"] == 0


@pytest.mark.asyncio
async def test_unknown_code_at_seller_signup_silent_noop(amb_and_seller):
    """Unknown codes don't block signup — just no attribution."""
    _, seller_id = amb_and_seller
    await _link_ambassador_referral(seller_id, "NOT-A-REAL-CODE")
    seller = await db.users.find_one({"id": seller_id}, {"_id": 0})
    assert "referred_by_ambassador_id" not in seller


@pytest.mark.asyncio
async def test_attribution_is_idempotent(amb_and_seller):
    """Re-running with the same code doesn't double-count."""
    amb_id, seller_id = amb_and_seller
    await _link_ambassador_referral(seller_id, "SARAH-RECRUIT-IN")
    await _link_ambassador_referral(seller_id, "SARAH-RECRUIT-IN")
    amb = await db.users.find_one({"id": amb_id}, {"_id": 0})
    assert amb["ambassador_profile"]["referred_sellers_count"] == 1


@pytest.mark.asyncio
async def test_suspended_ambassador_no_attribution():
    """A suspended ambassador's code must not work."""
    amb_id = "amb_suspended_test"
    seller_id = "seller_suspended_test"
    await db.users.update_one(
        {"id": amb_id},
        {"$set": {
            "id": amb_id,
            "email": f"{amb_id}@example.com",
            "ambassador_profile": {
                "code": "BANNED-NZ", "code_b2b": "BANNED-RECRUIT",
                "status": "suspended", "referred_sellers_count": 0,
            },
        }},
        upsert=True,
    )
    await _make_seller(seller_id)
    try:
        await _link_ambassador_referral(seller_id, "BANNED-RECRUIT")
        seller = await db.users.find_one({"id": seller_id}, {"_id": 0})
        assert "referred_by_ambassador_id" not in seller
    finally:
        await db.users.delete_one({"id": amb_id})
        await db.users.delete_one({"id": seller_id})


# ---------------------------------------------------------------------------
# Buyer-side: B2B codes must NOT be acceptable as coupons
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_b2b_code_detected_for_checkout(amb_and_seller):
    """``is_ambassador_b2b_code`` powers the checkout defensive check."""
    assert await is_ambassador_b2b_code("SARAH-RECRUIT-IN") is True
    # Case-insensitive match
    assert await is_ambassador_b2b_code("sarah-recruit-in") is True
    # B2C code shouldn't trigger the B2B helper
    assert await is_ambassador_b2b_code("SARAH-NZ") is False
    # Random string
    assert await is_ambassador_b2b_code("XYZ") is False
    # Empty / None
    assert await is_ambassador_b2b_code("") is False
    assert await is_ambassador_b2b_code(None) is False
