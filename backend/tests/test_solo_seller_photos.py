"""Tests for sole-proprietorship sellers (no GSTIN required) +
multi-photo listing."""
import time

import pytest


def _addr(email_label):
    return {
        "address_line1": "Shop 12, MG Road",
        "city": "Pune",
        "state": "Maharashtra",
        "pincode": "411001",
        "contact_name": "Sole Op",
        "contact_phone": "+919900000000",
    }


def test_sole_prop_register_without_gstin(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_solo_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Solo Tester"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # Upgrade to seller with NO GSTIN — should succeed
    r = api_client.post(
        f"{base_url}/api/seller/upgrade",
        headers=headers,
        json={
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "Aarti's Handicrafts",
                "pan": "AAAPA1234B",
                "gstin": None,
                **_addr(email),
            }
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Endpoint returns public_user shape directly — verify seller flag.
    assert body.get("is_seller") is True
    # Now read the seller profile and check the GSTIN is None.
    r2 = api_client.get(f"{base_url}/api/seller/me", headers=headers)
    assert r2.status_code == 200, r2.text
    prof = r2.json()
    assert prof.get("business_type") == "sole_proprietorship"
    assert prof.get("gstin") in (None, "")


def test_private_limited_still_requires_gstin(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_pvt_no_gstin_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "PvtLtd Tester"},
    )
    headers = {
        "Authorization": f"Bearer {r.json()['access_token']}",
        "Content-Type": "application/json",
    }
    r = api_client.post(
        f"{base_url}/api/seller/upgrade",
        headers=headers,
        json={
            "business": {
                "business_type": "private_limited",
                "company_name": "Acme Crafts Pvt Ltd",
                "pan": "AAAPA1234B",
                "cin": "U72200DL2015PTC123456",
                "gstin": None,
                **_addr(email),
            }
        },
    )
    assert r.status_code == 400
    assert "gstin" in r.json()["detail"].lower()


def test_multi_photo_listing_via_images_field(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_multi_photo_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Photo Tester"},
    )
    headers = {
        "Authorization": f"Bearer {r.json()['access_token']}",
        "Content-Type": "application/json",
    }
    r = api_client.post(
        f"{base_url}/api/seller/upgrade",
        headers=headers,
        json={
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "Photo Sole",
                "pan": "AAAPA1234C",
                **_addr(email),
            }
        },
    )
    assert r.status_code == 200, r.text

    # Create a listing with 4 photos in `images` list — no `image` URL field
    photos = [
        f"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAA{i}=={i}" for i in range(4)
    ]
    r = api_client.post(
        f"{base_url}/api/seller/products",
        headers=headers,
        json={
            "name": "TEST multi photo product",
            "description": "A great test product with multiple photos.",
            "category": "Home & Decor",
            "price_nzd": 25.0,
            "images": photos,
        },
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert len(p["images"]) == 4
    # First image becomes the cover
    assert p["image"] == photos[0]


def test_listing_must_have_at_least_one_photo(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_no_photo_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "NoPhoto Tester"},
    )
    headers = {
        "Authorization": f"Bearer {r.json()['access_token']}",
        "Content-Type": "application/json",
    }
    api_client.post(
        f"{base_url}/api/seller/upgrade",
        headers=headers,
        json={
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "No Photo Sole",
                "pan": "AAAPA1234D",
                **_addr(email),
            }
        },
    )
    r = api_client.post(
        f"{base_url}/api/seller/products",
        headers=headers,
        json={
            "name": "TEST no photo",
            "description": "A product without any photos at all.",
            "category": "Home & Decor",
            "price_nzd": 10.0,
        },
    )
    assert r.status_code == 400
    assert "photo" in r.json()["detail"].lower()


def test_listing_capped_at_10_photos(api_client, base_url):
    suffix = int(time.time() * 1000)
    email = f"TEST_cap10_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Cap10 Tester"},
    )
    headers = {
        "Authorization": f"Bearer {r.json()['access_token']}",
        "Content-Type": "application/json",
    }
    api_client.post(
        f"{base_url}/api/seller/upgrade",
        headers=headers,
        json={
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "Cap10 Sole",
                "pan": "AAAPA1234E",
                **_addr(email),
            }
        },
    )
    photos = [
        f"https://images.example.com/p{i}.jpg" for i in range(15)
    ]
    r = api_client.post(
        f"{base_url}/api/seller/products",
        headers=headers,
        json={
            "name": "TEST capped photos",
            "description": "A product capped at 10 photos by the server.",
            "category": "Home & Decor",
            "price_nzd": 19.0,
            "images": photos,
        },
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["images"]) == 10
