"""Iter29 — focused validation for the Stripe Connect commission + payouts wiring.

We deliberately AVOID calling motor coroutines directly from sync pytest
(via `asyncio.run`) because motor binds its client to the first loop it
sees and closing that loop poisons every subsequent in-process motor call.
Instead we drive everything through the FastAPI HTTP layer (its own loop)
plus pymongo for direct read-side verification.
"""
from __future__ import annotations

import json as _json
import os
import uuid

import pymongo
import pytest

from config import DB_NAME, MONGO_URL

_sync_client = pymongo.MongoClient(MONGO_URL)
_sync_db = _sync_client[DB_NAME]


# ---------------------------------------------------------------------------
# Tiered commission applied by create_payouts_for_order (driven via webhook)
# ---------------------------------------------------------------------------
def _seed_multi_category_order(order_id: str, seller_id: str, session_id: str,
                                user_id: str) -> None:
    """Insert a fake paid order across 3 categories (8 / 12 / 15%)."""
    products = [
        {"id": f"prod_e_{uuid.uuid4().hex[:8]}", "name": "TEST Phone",
         "category": "Electronics", "tags": [], "seller_id": seller_id,
         "price_nzd": 100.0, "stock": 10, "currency": "NZD"},
        {"id": f"prod_a_{uuid.uuid4().hex[:8]}", "name": "TEST Shirt",
         "category": "Apparel", "tags": [], "seller_id": seller_id,
         "price_nzd": 50.0, "stock": 10, "currency": "NZD"},
        {"id": f"prod_j_{uuid.uuid4().hex[:8]}", "name": "TEST Ring",
         "category": "Jewellery", "tags": [], "seller_id": seller_id,
         "price_nzd": 200.0, "stock": 10, "currency": "NZD"},
    ]
    for p in products:
        _sync_db.products.update_one({"id": p["id"]}, {"$set": p}, upsert=True)

    order = {
        "id": order_id,
        "user_id": user_id,
        "items": [
            {"product_id": products[0]["id"], "name": "TEST Phone", "image": "",
             "price_nzd": 100.0, "quantity": 1,
             "seller_id": seller_id, "seller_name": "TEST Seller"},
            {"product_id": products[1]["id"], "name": "TEST Shirt", "image": "",
             "price_nzd": 50.0,  "quantity": 2,
             "seller_id": seller_id, "seller_name": "TEST Seller"},
            {"product_id": products[2]["id"], "name": "TEST Ring",  "image": "",
             "price_nzd": 200.0, "quantity": 1,
             "seller_id": seller_id, "seller_name": "TEST Seller"},
        ],
        "subtotal_nzd": 400.0,
        "shipping_nzd": 0.0,
        "discount_nzd": 0.0,
        "points_discount_nzd": 0.0,
        "total_nzd": 400.0,
        "status": "pending",
        "payment_status": "initiated",
        "session_id": session_id,
        "buyer_country": "NZ",
        "buyer_currency": "NZD",
        "charge_amount": 400.0,
    }
    _sync_db.orders.update_one({"id": order_id}, {"$set": order}, upsert=True)
    _sync_db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "session_id": session_id, "order_id": order_id,
            "user_id": user_id, "amount": 400.0, "currency": "nzd",
            "payment_status": "initiated", "metadata": {},
        }},
        upsert=True,
    )
    _sync_db.payouts.delete_many({"order_id": order_id})


def test_create_payouts_tiered_commission_via_webhook(api_client, base_url, auth_headers):
    """Drive create_payouts_for_order via the checkout.session.completed
    webhook (server-side loop) and assert payout.commission_nzd is the
    SUM of per-line tiered fees (8/12/15%), not a flat rate.

    Expected: 100*8% + 100*12% + 200*15% = 8 + 12 + 30 = 50.0 NZD.
    """
    if os.getenv("STRIPE_WEBHOOK_SECRET"):
        pytest.skip("webhook signature on — can't drive raw post")

    # Resolve our test user id from the bearer token
    me = api_client.get(f"{base_url}/api/auth/me", headers=auth_headers)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]

    order_id = f"TEST_order_tiered_{uuid.uuid4().hex[:6]}"
    session_id = f"cs_test_tiered_{uuid.uuid4().hex[:10]}"
    seller_id = "TEST_seller_tiered_payout"
    _seed_multi_category_order(order_id, seller_id, session_id, user_id)

    try:
        # Fire a synthetic checkout.session.completed webhook
        event_id = f"evt_test_tiered_{uuid.uuid4().hex[:8]}"
        payload = _json.dumps({
            "id": event_id,
            "type": "checkout.session.completed",
            "data": {"object": {
                "id": session_id,
                "payment_status": "paid",
                "payment_intent": None,
            }},
        })
        r = api_client.post(
            f"{base_url}/api/webhooks/stripe",
            data=payload,
            headers={"Stripe-Signature": "noop",
                     "Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("received") is True

        # Wait briefly then read payouts collection
        import time
        for _ in range(10):
            payouts = list(_sync_db.payouts.find({"order_id": order_id}, {"_id": 0}))
            if payouts:
                break
            time.sleep(0.3)

        assert payouts, "create_payouts_for_order didn't run via webhook"
        assert len(payouts) == 1, f"expected 1 payout, got {payouts}"
        po = payouts[0]
        assert po["seller_id"] == seller_id
        assert po["gross_nzd"] == 400.0
        # Tiered: 8 + 12 + 30 = 50.00 (NOT 60 flat-15%, NOT 48 flat-12%)
        assert po["commission_nzd"] == 50.0, (
            f"expected tiered commission 50.0 (8/12/15%), got {po['commission_nzd']}"
        )
        assert po["net_payable_nzd"] == 350.0

        # Idempotency: re-post the same event → second call should be a no-op
        r2 = api_client.post(
            f"{base_url}/api/webhooks/stripe",
            data=payload,
            headers={"Stripe-Signature": "noop",
                     "Content-Type": "application/json"},
        )
        assert r2.status_code == 200
        assert r2.json().get("idempotent") is True
        payouts_after = list(_sync_db.payouts.find({"order_id": order_id}, {"_id": 0}))
        assert len(payouts_after) == 1, "idempotency broken — extra payouts after replay"
        assert payouts_after[0]["id"] == po["id"]
    finally:
        _sync_db.stripe_events.delete_one({"_id": event_id})
        _sync_db.payouts.delete_many({"order_id": order_id})
        _sync_db.orders.delete_one({"id": order_id})
        _sync_db.payment_transactions.delete_many({"session_id": session_id})


# ---------------------------------------------------------------------------
# /checkout/session: commission ledger lives on the freshly-created order doc
# ---------------------------------------------------------------------------
def test_checkout_populates_commission_ledger_keys(api_client, base_url, auth_headers):
    # Clear cart first
    cur = api_client.get(f"{base_url}/api/cart", headers=auth_headers).json()
    for it in cur.get("items", []):
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=auth_headers)

    products = api_client.get(f"{base_url}/api/products").json()
    assert products
    p = products[0]
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=auth_headers,
        json={"product_id": p["id"], "quantity": 1},
    )
    assert r.status_code == 200, r.text

    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=auth_headers,
        json={
            "address": {
                "full_name": "Tier Tester", "phone": "+64211234567",
                "line1": "1 Queen St", "line2": "",
                "city": "Auckland", "region": "Auckland",
                "postcode": "1010", "country": "New Zealand",
            },
            "origin_url": base_url,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "stripe.com" in body["url"]
    order_id = body["order_id"]

    od = _sync_db.orders.find_one({"id": order_id}, {"_id": 0})
    assert od is not None
    # All new commission ledger keys must be present
    for key in [
        "commission_breakdown", "commission_total_minor",
        "connect_routed", "connect_seller_id",
        "connect_destination_account", "application_fee_minor",
    ]:
        assert key in od, f"missing order field: {key}"
    # Per spec: if connect_routed=False env-wide, application_fee_minor MUST be 0
    if not od["connect_routed"]:
        assert od["application_fee_minor"] == 0
        assert od["connect_destination_account"] is None
    assert isinstance(od["commission_breakdown"], list)
    assert isinstance(od["commission_total_minor"], int)


# ---------------------------------------------------------------------------
# Webhook idempotency for arbitrary event id
# ---------------------------------------------------------------------------
def test_webhook_idempotent_replay(api_client, base_url):
    if os.getenv("STRIPE_WEBHOOK_SECRET"):
        pytest.skip("webhook signature on — can't drive raw post")

    event_id = f"evt_test_idem_{uuid.uuid4().hex[:8]}"
    payload = _json.dumps({
        "id": event_id, "type": "ping",
        "data": {"object": {"id": "cs_test_doesnotexist"}},
    })
    r1 = api_client.post(
        f"{base_url}/api/webhooks/stripe", data=payload,
        headers={"Stripe-Signature": "noop", "Content-Type": "application/json"},
    )
    r2 = api_client.post(
        f"{base_url}/api/webhooks/stripe", data=payload,
        headers={"Stripe-Signature": "noop", "Content-Type": "application/json"},
    )
    try:
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json().get("received") is True
        assert r2.json().get("received") is True
        assert r2.json().get("idempotent") is True
    finally:
        _sync_db.stripe_events.delete_one({"_id": event_id})
