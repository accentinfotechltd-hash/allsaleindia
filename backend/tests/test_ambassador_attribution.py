"""Integration sanity test for ambassador attribution + scheduler.

Verifies:
  1. POST /ambassadors/join creates a canonical coupon doc
  2. The coupon validates via services.coupons.validate_for_cart
  3. credit_pending_for_order writes ambassador_id + bumps pending
  4. release_due_ambassador_commission promotes pending -> unpaid
"""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DISABLE_SCHEDULER", "1")

from db import db
from services.coupons import validate_for_cart
from services.ambassador_attribution import (
    credit_pending_for_order,
    release_due_ambassador_commission,
)
import httpx


async def main():
    suffix = uuid.uuid4().hex[:6].upper()
    name = f"Test Amb {suffix}"
    email = f"amb_{suffix.lower()}@test.allsale"

    # 1. Join the programme
    async with httpx.AsyncClient(base_url="http://localhost:8001", timeout=15) as c:
        r = await c.post("/api/ambassadors/join", json={
            "name": name,
            "email": email,
            "country": "NZ",
            "social_handle": f"@{suffix.lower()}",
            "primary_platform": "instagram",
        })
        assert r.status_code == 201, f"join failed: {r.status_code} {r.text}"
        body = r.json()
        # New response shape includes access_token + needs_password_setup + me
        assert "access_token" in body and body["access_token"], "join must return JWT"
        assert body.get("needs_password_setup") is True, "stub user should need password"
        me = body["me"]
        code = me["code"]
        amb_id = me["id"]
        print(f"OK joined as {amb_id} code={code} (token issued: {bool(body['access_token'])})")

    # 2. Validate the coupon directly against the cart validator
    cart_items = [{
        "product_id": "p1", "name": "Mango Pickle", "image": "",
        "price_nzd": 50.0, "quantity": 2, "seller_id": "s1",
    }]
    coupon, result = await validate_for_cart(code, cart_items, 100.0,
                                              {"id": "u1", "country": "NZ"})
    assert result["ok"], f"validator rejected ambassador code: {result}"
    assert result["discount_nzd"] == 5.0, f"expected 5% off 100 = 5.0; got {result}"
    print(f"OK validator approved code, discount={result['discount_nzd']}")

    # 3. Create a paid order with this coupon and run attribution
    order_id = f"order_{uuid.uuid4().hex[:12]}"
    paid_at = datetime.now(timezone.utc)
    await db.orders.insert_one({
        "id": order_id,
        "user_id": "buyer_test",
        "items": cart_items,
        "subtotal_nzd": 100.0,
        "shipping_nzd": 0.0,
        "discount_nzd": 5.0,
        "total_nzd": 95.0,
        "coupon_code": code,
        "status": "paid",
        "payment_status": "paid",
        "buyer_country": "NZ",
        "paid_at": paid_at,
        "created_at": paid_at,
    })
    await credit_pending_for_order(order_id)
    fresh_order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    assert fresh_order.get("ambassador_id") == amb_id, "ambassador not attributed"
    expected_minor = int(round(100.0 * 5 / 100 * 100))   # starter tier = 5% of 100 = 5.00 = 500 minor
    assert fresh_order.get("ambassador_commission_minor") == expected_minor, \
        f"commission_minor mismatch: {fresh_order.get('ambassador_commission_minor')} vs {expected_minor}"
    user_doc = await db.users.find_one({"id": amb_id}, {"_id": 0, "ambassador_profile": 1})
    prof = user_doc["ambassador_profile"]
    assert prof["pending_commission_minor"] == expected_minor, \
        f"pending mismatch: {prof['pending_commission_minor']}"
    assert prof["lifetime_orders"] == 1
    assert prof["revenue_driven_minor"] == 10000  # 100.00 NZD = 10000 minor
    print(f"OK attribution wrote {expected_minor} minor to pending")

    # Idempotency check
    await credit_pending_for_order(order_id)
    user_doc = await db.users.find_one({"id": amb_id}, {"_id": 0, "ambassador_profile": 1})
    assert user_doc["ambassador_profile"]["pending_commission_minor"] == expected_minor, \
        "attribution was not idempotent"
    print("OK attribution is idempotent")

    # 4. Force-expire the 7-day hold and run the release job
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"ambassador_release_at": paid_at - timedelta(seconds=1)}},
    )
    res = await release_due_ambassador_commission()
    assert res["released"] == 1, f"release failed: {res}"
    user_doc = await db.users.find_one({"id": amb_id}, {"_id": 0, "ambassador_profile": 1})
    prof = user_doc["ambassador_profile"]
    assert prof["pending_commission_minor"] == 0, "pending didn't decrement"
    assert prof["unpaid_balance_minor"] == expected_minor, "unpaid didn't increment"
    assert prof["lifetime_commission_minor"] == expected_minor
    print(f"OK released {expected_minor} minor pending -> unpaid")

    # Cleanup
    await db.orders.delete_one({"id": order_id})
    await db.users.delete_one({"id": amb_id})
    await db.coupons.delete_one({"code": code})
    print("\nALL TESTS PASSED ✅")


if __name__ == "__main__":
    # Direct invocation: `PYTHONPATH=/app/backend python tests/test_ambassador_attribution.py`.
    # When pytest collects this file, it skips the module-scope run (so the
    # broader suite stays green); the same coverage is provided by
    # tests/test_ambassador_phase2.py::TestAttribution.
    asyncio.run(main())
