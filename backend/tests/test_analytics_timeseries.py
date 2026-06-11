"""Tests for the new seller analytics time-series endpoint."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from tests._helpers import make_gstin_pan


def _seller(api_client, base_url):
    email = f"chart_{uuid.uuid4().hex[:10]}@allsale.co.nz"
    pwd = "Test1234!"
    gstin, pan = make_gstin_pan()
    r = api_client.post(
        f"{base_url}/api/seller/register",
        json={
            "email": email,
            "password": pwd,
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "Chart Test Co",
                "gstin": gstin,
                "pan": pan,
                "address_line1": "1 MG Road",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_name": "Chart Tester",
                "contact_phone": "+919999999999",
            },
        },
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"headers": {"Authorization": f"Bearer {token}"}, "email": email, "user_id": r.json()["user"]["id"]}


def test_timeseries_default_7_days(api_client, base_url):
    s = _seller(api_client, base_url)
    r = api_client.get(
        f"{base_url}/api/seller/analytics/timeseries", headers=s["headers"]
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["days"] == 7
    assert len(body["buckets"]) == 7
    # Each bucket has the expected keys, zero-filled when there's no data yet.
    for bucket in body["buckets"]:
        assert set(bucket.keys()) == {"date", "views", "cart_adds", "sold", "revenue_nzd"}
        assert bucket["views"] == 0
        assert bucket["sold"] == 0


def test_timeseries_30_days_param(api_client, base_url):
    s = _seller(api_client, base_url)
    r = api_client.get(
        f"{base_url}/api/seller/analytics/timeseries?days=30", headers=s["headers"]
    )
    assert r.status_code == 200
    assert r.json()["days"] == 30
    assert len(r.json()["buckets"]) == 30


def test_timeseries_days_clamped_to_30(api_client, base_url):
    s = _seller(api_client, base_url)
    r = api_client.get(
        f"{base_url}/api/seller/analytics/timeseries?days=999", headers=s["headers"]
    )
    assert r.status_code == 200
    assert r.json()["days"] == 30


def test_timeseries_requires_seller_account(api_client, base_url, auth_headers):
    """Plain buyer accounts should get 403."""
    r = api_client.get(
        f"{base_url}/api/seller/analytics/timeseries",
        headers=auth_headers,
    )
    assert r.status_code == 403


def test_track_view_inserts_event(api_client, base_url):
    """Hitting the public track-view endpoint should:
    - bump `view_count` on the product
    - insert an `analytics_events` row scoped to the seller
    """
    s = _seller(api_client, base_url)
    # Seller publishes a listing.
    listing_resp = api_client.post(
        f"{base_url}/api/seller/products",
        headers=s["headers"],
        json={
            "name": "Chart-test listing",
            "description": "for timeseries test only " * 2,
            "category": "Ethnic Fashion",
            "price_nzd": 25.0,
            "image": "https://example.com/x.jpg",
        },
    )
    assert listing_resp.status_code == 200, listing_resp.text
    pid = listing_resp.json()["id"]

    # Hit track-view 3 times (no auth required).
    for _ in range(3):
        r = api_client.post(f"{base_url}/api/products/{pid}/track-view")
        assert r.status_code == 200

    # Time-series for this seller should now show >=3 views today.
    r = api_client.get(
        f"{base_url}/api/seller/analytics/timeseries?days=7", headers=s["headers"]
    )
    assert r.status_code == 200
    today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_bucket = next(b for b in r.json()["buckets"] if b["date"] == today_key)
    assert today_bucket["views"] >= 3
