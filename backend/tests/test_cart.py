"""Cart CRUD + totals (auth-gated)."""
import pytest


@pytest.fixture(scope="module")
def product_ids(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products")
    items = r.json()
    return {p["category"]: p for p in items}, items


def test_cart_empty_initial(api_client, base_url, auth_headers):
    r = api_client.get(f"{base_url}/api/cart", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["items"] == []
    assert body["subtotal_nzd"] == 0
    assert body["shipping_nzd"] == 0
    assert body["total_nzd"] == 0


def test_cart_add_update_remove_flow(api_client, base_url, auth_headers, product_ids):
    by_cat, items = product_ids
    cheap = min(items, key=lambda p: p["price_nzd"])  # under 100 -> shipping 12

    # Add 1 cheap item
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=auth_headers,
        json={"product_id": cheap["id"], "quantity": 1},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["product_id"] == cheap["id"]
    assert body["items"][0]["quantity"] == 1
    assert body["subtotal_nzd"] == round(cheap["price_nzd"], 2)
    # shipping = 12 since subtotal < 100
    assert body["shipping_nzd"] == 12.0
    assert body["total_nzd"] == round(cheap["price_nzd"] + 12, 2)

    # GET verifies persistence
    r2 = api_client.get(f"{base_url}/api/cart", headers=auth_headers)
    assert r2.json()["subtotal_nzd"] == body["subtotal_nzd"]

    # Update qty to 3
    r3 = api_client.put(
        f"{base_url}/api/cart/{cheap['id']}",
        headers=auth_headers,
        json={"quantity": 3},
    )
    assert r3.status_code == 200
    body3 = r3.json()
    assert body3["items"][0]["quantity"] == 3
    assert body3["subtotal_nzd"] == round(cheap["price_nzd"] * 3, 2)

    # Delete
    r4 = api_client.delete(f"{base_url}/api/cart/{cheap['id']}", headers=auth_headers)
    assert r4.status_code == 200
    assert r4.json()["items"] == []


def test_cart_free_shipping_over_threshold(api_client, base_url, auth_headers, product_ids):
    by_cat, items = product_ids
    # Add product over $100 (Lehenga is $149)
    expensive = max(items, key=lambda p: p["price_nzd"])
    assert expensive["price_nzd"] >= 100
    # Clear cart first
    r0 = api_client.get(f"{base_url}/api/cart", headers=auth_headers)
    for it in r0.json()["items"]:
        api_client.delete(f"{base_url}/api/cart/{it['product_id']}", headers=auth_headers)

    r = api_client.post(
        f"{base_url}/api/cart",
        headers=auth_headers,
        json={"product_id": expensive["id"], "quantity": 1},
    )
    body = r.json()
    assert body["subtotal_nzd"] >= 100
    assert body["shipping_nzd"] == 0  # free shipping
    assert body["total_nzd"] == body["subtotal_nzd"]
    assert body["subtotal_inr"] > 0

    # cleanup
    api_client.delete(f"{base_url}/api/cart/{expensive['id']}", headers=auth_headers)


def test_cart_requires_auth(api_client, base_url):
    r = api_client.get(f"{base_url}/api/cart")
    assert r.status_code == 401


def test_cart_add_unknown_product_404(api_client, base_url, auth_headers):
    r = api_client.post(
        f"{base_url}/api/cart",
        headers=auth_headers,
        json={"product_id": "nope", "quantity": 1},
    )
    assert r.status_code == 404
