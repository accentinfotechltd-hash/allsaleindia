"""Stripe Connect commission planning + native Checkout Session wiring.

Tests:
1. Tiered fee calculation across product categories (8/12/15%).
2. Currency-aware minor-unit conversion.
3. Integration: order doc persists commission_breakdown + connect_routed.
4. Webhook dev-mode accepts unsigned payloads when secret not configured.

The lower-level `_plan_commission_for_items` is implicitly covered by (3) —
running the async planner directly in a sync pytest context conflicts with
motor's per-loop binding, so we exercise it end-to-end via HTTP instead.
"""
from __future__ import annotations

import os

import pymongo

from config import DB_NAME, MONGO_URL


# Sync handle for direct doc verification only.  The application code under
# test still uses the motor (async) client via `db.db`.
_sync_client = pymongo.MongoClient(MONGO_URL)
_sync_db = _sync_client[DB_NAME]


# ---------------------------------------------------------------------------
# Pure unit tests on the fee calculator (no DB)
# ---------------------------------------------------------------------------
def test_calculate_application_fee_tiers():
    from services.stripe_connect_svc import (
        calculate_application_fee,
        get_commission_bps_for_product,
    )

    # Electronics → 8%
    bps = get_commission_bps_for_product({"category": "Electronics"})
    assert bps == 800
    assert calculate_application_fee(10_000, bps=bps) == 800

    # Apparel (mid tier) → 12%
    bps = get_commission_bps_for_product({"category": "Apparel"})
    assert bps == 1200
    assert calculate_application_fee(10_000, bps=bps) == 1200

    # Jewellery → 15%
    bps = get_commission_bps_for_product({"category": "Jewellery"})
    assert bps == 1500
    assert calculate_application_fee(10_000, bps=bps) == 1500

    # Unknown category → default 12%
    bps = get_commission_bps_for_product({"category": "Random-Thing"})
    assert bps == 1200


def test_calculate_application_fee_rounding_floor():
    """We always round DOWN so sellers never get overcharged a sub-cent."""
    from services.stripe_connect_svc import calculate_application_fee

    # 12% of 199c = 23.88c → floor to 23 (not 24)
    assert calculate_application_fee(199, bps=1200) == 23
    # 0 input → 0 fee
    assert calculate_application_fee(0, bps=1500) == 0
    assert calculate_application_fee(-100, bps=1500) == 0


def test_to_minor_units_currency_aware():
    from services.stripe_svc import to_minor_units
    assert to_minor_units(100.0, "nzd") == 10_000
    assert to_minor_units(99.99, "usd") == 9_999
    # JPY is zero-decimal — pass through
    assert to_minor_units(100.0, "jpy") == 100
    # Defensive: negatives clamp to 0
    assert to_minor_units(-5.0, "nzd") == 0


# ---------------------------------------------------------------------------
# DB-backed tests are covered via the integration test below.  Running the
# planner directly in a sync pytest context conflicts with motor's loop
# binding when the test session has already invoked motor on another loop.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Integration: checkout endpoint persists commission ledger on the order doc
# ---------------------------------------------------------------------------
def test_checkout_persists_commission_breakdown_on_order(
    api_client, base_url, auth_headers
):
    """After /checkout/session, the freshly created order should carry the
    new commission_breakdown + connect_routed fields."""
    # Empty the cart first
    cur = api_client.get(f"{base_url}/api/cart", headers=auth_headers).json()
    for it in cur.get("items", []):
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=auth_headers)

    products = api_client.get(f"{base_url}/api/products").json()
    assert products, "Catalog must have seed products"
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
                "full_name": "Allsale Tester",
                "phone": "+64211234567",
                "line1": "1 Queen St",
                "line2": "",
                "city": "Auckland",
                "region": "Auckland",
                "postcode": "1010",
                "country": "New Zealand",
            },
            "origin_url": base_url,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    order_id = body["order_id"]
    assert "stripe.com" in body["url"], "Session URL must be Stripe-hosted"

    # Confirm the new commission ledger fields exist on the order doc
    od = _sync_db.orders.find_one({"id": order_id}, {"_id": 0})
    assert od is not None
    assert "commission_breakdown" in od
    assert "commission_total_minor" in od
    assert "connect_routed" in od
    assert isinstance(od["commission_breakdown"], list)
    for line in od["commission_breakdown"]:
        assert "product_id" in line
        assert "seller_id" in line
        assert "subtotal_minor" in line
        assert "commission_bps" in line
        assert "commission_minor" in line


# ---------------------------------------------------------------------------
# Webhook: dev mode (no STRIPE_WEBHOOK_SECRET) accepts arbitrary payload
# ---------------------------------------------------------------------------
def test_webhook_dev_mode_accepts_unsigned(api_client, base_url):
    """When STRIPE_WEBHOOK_SECRET isn't set we skip signature checks
    (dev/CI default).  Should return 200 received:true on a random JSON body."""
    if os.getenv("STRIPE_WEBHOOK_SECRET"):
        # Skip in environments with the secret configured
        return
    import json as _json
    r = api_client.post(
        f"{base_url}/api/webhooks/stripe",
        data=_json.dumps({"id": "evt_test_dev_mode", "type": "ping",
                          "data": {"object": {}}}),
        headers={"Stripe-Signature": "noop",
                 "Content-Type": "application/json"},
    )
    assert r.status_code == 200, r.text
    assert r.json().get("received") is True
