"""Tests for sponsored placements — seller campaigns, slot serving, tracking."""
from __future__ import annotations

import requests

BASE = "http://localhost:8001/api"
SELLER = {"email": "verified-seller@example.com", "password": "VerifiedSeller2026!"}


def _login(creds: dict) -> dict:
    r = requests.post(f"{BASE}/auth/login", json=creds, timeout=5)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seller_product_id() -> str:
    headers = _login(SELLER)
    r = requests.get(
        f"{BASE}/seller/products", headers=headers, timeout=5
    )
    assert r.status_code == 200
    items = r.json()
    assert items, "Seller has no products to promote"
    return items[0]["id"]


def test_create_then_lifecycle():
    headers = _login(SELLER)
    pid = _seller_product_id()
    # Clean slate: clear any prior campaigns for this seller-product pair.
    import os
    from pymongo import MongoClient
    cli = MongoClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    cli[os.getenv("DB_NAME", "allsale_database")].sponsored_campaigns.delete_many(
        {"product_id": pid}
    )

    # Create
    r = requests.post(
        f"{BASE}/seller/sponsored/campaigns",
        json={"product_id": pid, "daily_budget_nzd": 5.0, "cpc_nzd": 0.25},
        headers=headers,
        timeout=5,
    )
    assert r.status_code == 200, r.text
    c = r.json()
    cid = c["id"]
    assert c["status"] == "active"
    assert c["cpc_nzd"] == 0.25
    assert c["daily_budget_nzd"] == 5.0

    # Duplicate refused
    r = requests.post(
        f"{BASE}/seller/sponsored/campaigns",
        json={"product_id": pid, "daily_budget_nzd": 5.0},
        headers=headers,
        timeout=5,
    )
    assert r.status_code == 409

    # Slot serving (anonymous)
    r = requests.get(
        f"{BASE}/sponsored/slots?placement=home&limit=4", timeout=5
    )
    assert r.status_code == 200
    slots = r.json()["items"]
    assert any(s["campaign_id"] == cid for s in slots)

    # Impression
    r = requests.post(
        f"{BASE}/sponsored/track/impression",
        json={"campaign_id": cid, "product_id": pid, "placement": "home"},
        timeout=5,
    )
    assert r.status_code == 200 and r.json()["ok"] is True

    # Click (billed)
    r = requests.post(
        f"{BASE}/sponsored/track/click",
        json={"campaign_id": cid, "product_id": pid, "placement": "home"},
        timeout=5,
    )
    assert r.status_code == 200
    d = r.json()
    assert d["billed"] is True
    assert d["cpc"] == 0.25

    # Detail reflects stats
    r = requests.get(
        f"{BASE}/seller/sponsored/campaigns/{cid}", headers=headers, timeout=5
    )
    assert r.status_code == 200
    d = r.json()
    assert d["impressions"] >= 1
    assert d["clicks"] >= 1
    assert d["spent_today"] >= 0.25

    # Pause
    r = requests.patch(
        f"{BASE}/seller/sponsored/campaigns/{cid}",
        json={"status": "paused"},
        headers=headers,
        timeout=5,
    )
    assert r.status_code == 200 and r.json()["status"] == "paused"

    # Paused campaigns not served
    r = requests.get(
        f"{BASE}/sponsored/slots?placement=home&limit=4", timeout=5
    )
    assert all(s["campaign_id"] != cid for s in r.json()["items"])

    # Cleanup
    r = requests.delete(
        f"{BASE}/seller/sponsored/campaigns/{cid}", headers=headers, timeout=5
    )
    assert r.status_code == 200


def test_budget_validation():
    headers = _login(SELLER)
    pid = _seller_product_id()
    # Budget too small
    r = requests.post(
        f"{BASE}/seller/sponsored/campaigns",
        json={"product_id": pid, "daily_budget_nzd": 0.5},
        headers=headers,
        timeout=5,
    )
    assert r.status_code == 422
    # CPC out of range
    r = requests.post(
        f"{BASE}/seller/sponsored/campaigns",
        json={"product_id": pid, "daily_budget_nzd": 5.0, "cpc_nzd": 10.0},
        headers=headers,
        timeout=5,
    )
    assert r.status_code == 422


def test_unauthenticated_cant_manage():
    r = requests.get(f"{BASE}/seller/sponsored/campaigns", timeout=5)
    assert r.status_code == 401


def test_bad_placement_rejected():
    r = requests.get(f"{BASE}/sponsored/slots?placement=junk", timeout=5)
    assert r.status_code == 400
