"""Checkout (Stripe), orders, webhook signature handling."""
import pytest


@pytest.fixture(scope="module")
def cart_with_item(api_client, base_url, auth_headers):
    # ensure cart is empty
    cur = api_client.get(f"{base_url}/api/cart", headers=auth_headers).json()
    for it in cur["items"]:
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=auth_headers)
    products = api_client.get(f"{base_url}/api/products").json()
    p = products[0]
    api_client.post(
        f"{base_url}/api/cart",
        headers=auth_headers,
        json={"product_id": p["id"], "quantity": 2},
    )
    yield p


def _address():
    return {
        "full_name": "Allsale Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "line2": "Apt 5",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def test_checkout_empty_cart_400(api_client, base_url, auth_headers):
    # ensure empty
    cur = api_client.get(f"{base_url}/api/cart", headers=auth_headers).json()
    for it in cur["items"]:
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=auth_headers)
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=auth_headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 400


def test_checkout_creates_session_and_order(api_client, base_url, auth_headers, cart_with_item):
    r = api_client.post(
        f"{base_url}/api/checkout/session",
        headers=auth_headers,
        json={"address": _address(), "origin_url": base_url},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("url", "").startswith("https://")
    assert "stripe.com" in body["url"]
    assert body.get("session_id")
    assert body.get("order_id", "").startswith("order_")

    # Order should be listed and pending/initiated
    orders = api_client.get(f"{base_url}/api/orders", headers=auth_headers).json()
    assert any(o["id"] == body["order_id"] for o in orders)
    order = next(o for o in orders if o["id"] == body["order_id"])
    assert order["status"] == "pending"
    assert order["payment_status"] == "initiated"
    assert order["session_id"] == body["session_id"]

    # GET single order
    r2 = api_client.get(f"{base_url}/api/orders/{body['order_id']}", headers=auth_headers)
    assert r2.status_code == 200
    assert r2.json()["id"] == body["order_id"]


def test_orders_isolated_across_users(api_client, base_url, auth_headers, test_user):
    # Register a second user
    import time
    email2 = f"TEST_other_{int(time.time()*1000)}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email2, "password": "Test1234!", "full_name": "Other"},
    )
    assert r.status_code == 200
    other_token = r.json()["access_token"]
    other_headers = {"Content-Type": "application/json", "Authorization": f"Bearer {other_token}"}

    # Other user's order list should be empty
    r2 = api_client.get(f"{base_url}/api/orders", headers=other_headers)
    assert r2.status_code == 200
    assert r2.json() == []

    # Try to fetch a known foreign order id (use first user's orders)
    first_orders = api_client.get(f"{base_url}/api/orders", headers=auth_headers).json()
    if first_orders:
        oid = first_orders[0]["id"]
        r3 = api_client.get(f"{base_url}/api/orders/{oid}", headers=other_headers)
        assert r3.status_code == 404


def test_webhook_invalid_signature_400(api_client, base_url):
    import os
    r = api_client.post(
        f"{base_url}/api/webhooks/stripe",
        data=b"{}",
        headers={"Stripe-Signature": "invalid"},
    )
    # When STRIPE_WEBHOOK_SECRET is set → 400 (signature mismatch).
    # When not set (dev / CI) → 200 with `received: True` (no-op event).
    if os.getenv("STRIPE_WEBHOOK_SECRET"):
        assert r.status_code in (400, 422), r.text
    else:
        assert r.status_code == 200, r.text
        assert r.json().get("received") is True
