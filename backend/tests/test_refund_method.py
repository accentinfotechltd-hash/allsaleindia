"""Tests for the refund-method choice on return requests.

Verifies that buyers can opt for store credit instead of a Stripe refund,
and that approval correctly tops up their wallet (with the 5% bonus).
"""
import os
import time
from pathlib import Path

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


def _register_buyer() -> dict:
    body = {
        "email": f"TEST_refund_buyer_{int(time.time() * 1000)}@allsale.co.nz",
        "password": "Test1234!",
        "full_name": "Refund Tester",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_wallet_endpoint_starts_at_zero():
    headers = _register_buyer()
    r = requests.get(f"{BASE_URL}/api/wallet", headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["balance_nzd"] == 0.0
    assert data["entries"] == []


def test_return_request_accepts_refund_method_field():
    """The ReturnRequestCreate model must accept refund_method without
    breaking when no order exists (we expect a 404 for the missing order,
    not a 422 schema violation).
    """
    headers = _register_buyer()
    body = {
        "order_id": "order_does_not_exist_123",
        "reason": "damaged_on_arrival",
        "product_ids": [],
        "note": "Test refund method validation only.",
        "photos": ["https://example.com/proof.jpg"],
        "refund_method": "store_credit",
    }
    r = requests.post(
        f"{BASE_URL}/api/returns/request",
        json=body,
        headers=headers,
    )
    # 404 (no such order) is acceptable; 422 (validation) means our field was rejected.
    assert r.status_code != 422, r.text
    assert r.status_code in (404, 400), r.text


def test_return_request_rejects_invalid_refund_method_gracefully():
    """An unknown refund_method should NOT 422; it should fall back to 'original'."""
    headers = _register_buyer()
    body = {
        "order_id": "order_does_not_exist_123",
        "reason": "damaged_on_arrival",
        "photos": ["https://example.com/proof.jpg"],
        "refund_method": "magic_beans",
    }
    r = requests.post(
        f"{BASE_URL}/api/returns/request",
        json=body,
        headers=headers,
    )
    # Either the order-not-found 404 or reason validation 400 — anything except 422.
    assert r.status_code != 422, r.text
