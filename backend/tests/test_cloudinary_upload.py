"""Tests for POST /api/uploads/image (Cloudinary live upload)."""
import os
import time

import pytest


TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=="
)


def _auth(api_client, base_url, label):
    suffix = int(time.time() * 1000)
    email = f"TEST_cdn_{label}_{suffix}@allsale.co.nz"
    r = api_client.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "CDN Tester"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def test_upload_requires_auth(api_client, base_url):
    r = api_client.post(f"{base_url}/api/uploads/image", json={"data": f"data:image/png;base64,{TINY_PNG_B64}"})
    assert r.status_code == 401


def test_upload_rejects_empty(api_client, base_url):
    headers = _auth(api_client, base_url, "empty")
    r = api_client.post(f"{base_url}/api/uploads/image", headers=headers, json={"data": ""})
    assert r.status_code == 400


def test_upload_rejects_bad_base64(api_client, base_url):
    headers = _auth(api_client, base_url, "bad64")
    r = api_client.post(
        f"{base_url}/api/uploads/image",
        headers=headers,
        json={"data": "data:image/png;base64,***not-base64***"},
    )
    assert r.status_code == 400


@pytest.mark.skipif(
    not os.environ.get("CLOUDINARY_CLOUD_NAME"),
    reason="Cloudinary credentials not configured",
)
def test_upload_live_cloudinary(api_client, base_url):
    headers = _auth(api_client, base_url, "live")
    r = api_client.post(
        f"{base_url}/api/uploads/image",
        headers=headers,
        json={"data": f"data:image/png;base64,{TINY_PNG_B64}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "cloudinary"
    assert body["url"].startswith("https://res.cloudinary.com/")
    assert body["public_id"]
    assert body["bytes"] and body["bytes"] > 0


def test_upload_rejects_too_large(api_client, base_url):
    headers = _auth(api_client, base_url, "big")
    # > 8MB string
    huge = "data:image/png;base64," + "A" * 9_000_000
    r = api_client.post(f"{base_url}/api/uploads/image", headers=headers, json={"data": huge})
    assert r.status_code == 413
