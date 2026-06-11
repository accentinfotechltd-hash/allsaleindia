"""Tests for PATCH /api/seller/products/{id} — edit-existing-listing flow."""
import asyncio
import time
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def _addr():
    return {
        "address_line1": "Shop 12",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411001",
        "contact_name": "Edit Op",
        "contact_phone": "+919900000111",
    }


def _setup_seller_with_product(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_edit_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Edit Tester"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    api_client.post(
        f"{base_url}/api/seller/upgrade",
        headers=headers,
        json={
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "Edit Sole",
                "pan": "AAAPA1234B",
                **_addr(),
            }
        },
    )
    r = api_client.post(
        f"{base_url}/api/seller/products",
        headers=headers,
        json={
            "name": "TEST edit base product",
            "description": "An editable test product for patch endpoint.",
            "category": "Home & Decor",
            "price_nzd": 50.0,
            "images": ["https://images.example.com/edit.jpg"],
            "stock_count": 30,
            "colors": ["Red", "Blue"],
        },
    )
    assert r.status_code == 200, r.text
    return headers, r.json()


def test_edit_listing_partial_fields(api_client, base_url):
    headers, p = _setup_seller_with_product(api_client, base_url, "partial")
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={"name": "TEST edited name", "price_nzd": 75.0},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["name"] == "TEST edited name"
    assert out["price_nzd"] == 75.0
    # Unchanged fields preserved
    assert out["category"] == "Home & Decor"
    assert out["colors"] == ["Red", "Blue"]
    assert out["stock_count"] == 30


def test_edit_listing_stock_flips_in_stock(api_client, base_url):
    headers, p = _setup_seller_with_product(api_client, base_url, "stock")
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={"stock_count": 0},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["stock_count"] == 0
    assert out["in_stock"] is False
    # Set it back
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={"stock_count": 5},
    )
    out = r.json()
    assert out["stock_count"] == 5
    assert out["in_stock"] is True


def test_edit_listing_replace_images(api_client, base_url):
    headers, p = _setup_seller_with_product(api_client, base_url, "imgs")
    new_imgs = [f"https://images.example.com/new{i}.jpg" for i in range(3)]
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={"images": new_imgs},
    )
    assert r.status_code == 200, r.text
    assert r.json()["images"] == new_imgs
    assert r.json()["image"] == new_imgs[0]


def test_edit_listing_requires_at_least_one_image(api_client, base_url):
    headers, p = _setup_seller_with_product(api_client, base_url, "noimg")
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={"images": []},
    )
    assert r.status_code == 400
    assert "photo" in r.json()["detail"].lower()


def test_edit_listing_other_seller_404(api_client, base_url):
    headers_a, p = _setup_seller_with_product(api_client, base_url, "ownerA")
    headers_b, _ = _setup_seller_with_product(api_client, base_url, "ownerB")
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers_b,
        json={"name": "should-not-update"},
    )
    assert r.status_code == 404


def test_edit_listing_empty_body_is_noop(api_client, base_url):
    headers, p = _setup_seller_with_product(api_client, base_url, "noop")
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={},
    )
    assert r.status_code == 200
    # Returns the existing product unchanged
    assert r.json()["name"] == p["name"]
    assert r.json()["price_nzd"] == p["price_nzd"]


def test_edit_listing_clean_colors_dedupe_cap(api_client, base_url):
    headers, p = _setup_seller_with_product(api_client, base_url, "colors")
    r = api_client.patch(
        f"{base_url}/api/seller/products/{p['id']}",
        headers=headers,
        json={"colors": ["Indigo", " indigo ", "Maroon", "", "Saffron"] + [f"C{i}" for i in range(20)]},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["colors"]) == 10
    # First three preserved & deduped (case-insensitive)
    assert out["colors"][0] == "Indigo"
    assert out["colors"][1] == "Maroon"
    assert out["colors"][2] == "Saffron"


def test_edit_listing_unauth(api_client, base_url):
    r = api_client.patch(f"{base_url}/api/seller/products/nope", json={"name": "x"})
    assert r.status_code == 401
