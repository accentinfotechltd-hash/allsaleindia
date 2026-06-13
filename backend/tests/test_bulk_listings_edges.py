"""Edge / negative tests for the bulk listings endpoints.

Covers the iter-11 review-request cases that the existing test_bulk_listings.py
does NOT exercise:

  - empty file body         → 400
  - file > 8 MB             → 413
  - too many rows (>1000)   → 413
  - non-seller user         → 403 on every /seller/bulk/* endpoint
  - missing Authorization   → 401/403 on every /seller/bulk/* endpoint
  - regression: existing POST /api/seller/products & GET /api/seller/products
    still work alongside the new bulk feature.
"""
from __future__ import annotations

import io
import os
import sys
import time
from pathlib import Path

import pytest
import requests

# allow `from _helpers import make_gstin_pan`
sys.path.insert(0, str(Path(__file__).parent))
from _helpers import make_gstin_pan  # noqa: E402

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

BULK = f"{BASE_URL}/api/seller/bulk"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def seller_headers():
    """Register a fresh verified seller; return Authorization headers."""
    g, p = make_gstin_pan()
    suffix = int(time.time() * 1000)
    body = {
        "email": f"TEST_bulk_edge_{suffix}@allsale.co.nz",
        "password": "Test1234!",
        "business": {
            "business_type": "private_limited",
            "company_name": "TEST Bulk Edge Pvt Ltd",
            "gstin": g,
            "pan": p,
            "cin": "U74999MH2020PTC123456",
            "address_line1": "11 Edge Lane",
            "address_line2": "Andheri",
            "city": "Mumbai",
            "state": "Maharashtra",
            "pincode": "400001",
            "contact_name": "Edge Tester",
            "contact_phone": "+911234567890",
        },
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=body)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    uid = r.json()["user"]["id"]
    # Fast-track approval via direct pymongo (sync, no event-loop issues)
    import os
    from dotenv import load_dotenv
    from pymongo import MongoClient
    load_dotenv("/app/backend/.env", override=True)
    cli = MongoClient(os.environ["MONGO_URL"])
    db_ = cli[os.environ.get("DB_NAME", "allsale_database")]
    db_.users.update_one({"id": uid}, {"$set": {"seller_verification_status": "approved"}})
    db_.sellers.update_one(
        {"user_id": uid},
        {"$set": {"verification_status": "approved", "id_proof_url": "x", "business_proof_url": "y"}},
    )
    cli.close()
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def buyer_headers():
    """Register a plain buyer (not a seller). Used for 403 checks."""
    suffix = int(time.time() * 1000)
    email = f"TEST_bulk_buyer_{suffix}@allsale.co.nz"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "Test1234!", "full_name": "Edge Buyer"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Empty / oversize / too-many-rows
# ---------------------------------------------------------------------------
class TestPreviewSizeLimits:
    def test_empty_file_returns_400(self, seller_headers):
        files = {"file": ("empty.csv", b"", "text/csv")}
        r = requests.post(f"{BULK}/preview", files=files, headers=seller_headers)
        assert r.status_code == 400, r.text
        assert "empty" in r.text.lower()

    def test_oversize_file_returns_413(self, seller_headers):
        # 9 MB CSV-shaped blob (> 8 MB cap)
        blob = b"name,description,category,price_nzd,image_urls\n" + (b"a" * (9 * 1024 * 1024))
        files = {"file": ("big.csv", blob, "text/csv")}
        r = requests.post(f"{BULK}/preview", files=files, headers=seller_headers)
        assert r.status_code == 413, r.text
        assert "too large" in r.text.lower()

    def test_too_many_rows_returns_413(self, seller_headers):
        # Build 1001 data rows (header + 1001 rows)
        header = "product_id,name,description,category,price_nzd,stock_count,image_urls\n"
        row = ',"x","longer description text here","Ethnic Fashion","10","1","https://e.com/x.jpg"\n'
        body = (header + row * 1001).encode()
        files = {"file": ("many.csv", body, "text/csv")}
        r = requests.post(f"{BULK}/preview", files=files, headers=seller_headers)
        assert r.status_code == 413, r.text
        assert "too many" in r.text.lower()

    def test_no_data_rows_returns_400(self, seller_headers):
        body = b"product_id,name,description,category,price_nzd,image_urls\n"
        files = {"file": ("headers_only.csv", body, "text/csv")}
        r = requests.post(f"{BULK}/preview", files=files, headers=seller_headers)
        assert r.status_code == 400, r.text
        assert "no data" in r.text.lower()


# ---------------------------------------------------------------------------
# Authentication / authorization gating
# ---------------------------------------------------------------------------
BULK_ENDPOINTS_GET = [
    "/template.csv",
    "/template.xlsx",
    "/columns",
    "/export.csv",
    "/export.xlsx",
]


class TestAuthGating:
    @pytest.mark.parametrize("path", BULK_ENDPOINTS_GET)
    def test_missing_auth_blocked_on_get(self, path):
        r = requests.get(f"{BULK}{path}")
        # FastAPI/HTTPBearer returns 401 or 403 when no header is supplied
        assert r.status_code in (401, 403), f"{path} → {r.status_code} {r.text}"

    def test_missing_auth_blocked_on_preview(self):
        files = {"file": ("x.csv", b"name\nfoo\n", "text/csv")}
        r = requests.post(f"{BULK}/preview", files=files)
        assert r.status_code in (401, 403), r.text

    def test_missing_auth_blocked_on_import(self):
        r = requests.post(f"{BULK}/import", json={"rows": []})
        assert r.status_code in (401, 403), r.text

    @pytest.mark.parametrize("path", BULK_ENDPOINTS_GET)
    def test_buyer_blocked_with_403_on_get(self, path, buyer_headers):
        r = requests.get(f"{BULK}{path}", headers=buyer_headers)
        assert r.status_code == 403, f"{path} → {r.status_code} {r.text}"
        assert "seller" in r.text.lower()

    def test_buyer_blocked_with_403_on_preview(self, buyer_headers):
        files = {"file": ("x.csv", b"name,description,category,price_nzd,image_urls\nA,B,C,1,https://e/x.jpg\n", "text/csv")}
        r = requests.post(f"{BULK}/preview", files=files, headers=buyer_headers)
        assert r.status_code == 403, r.text

    def test_buyer_blocked_with_403_on_import(self, buyer_headers):
        r = requests.post(
            f"{BULK}/import",
            json={"rows": []},
            headers={**buyer_headers, "Content-Type": "application/json"},
        )
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Regression — pre-existing seller endpoints still work
# ---------------------------------------------------------------------------
class TestSellerRegression:
    def test_post_seller_products_still_works(self, seller_headers):
        payload = {
            "name": "TEST Regression Listing",
            "description": "Ensure direct seller create still works alongside bulk.",
            "category": "Ethnic Fashion",
            "subcategory": "Sarees",
            "price_nzd": 49.99,
            "stock_count": 4,
            "sizes": ["Free Size"],
            "colors": ["Red"],
            "images": ["https://example.com/regression.jpg"],
            "shipping_days_min": 7,
            "shipping_days_max": 14,
        }
        r = requests.post(
            f"{BASE_URL}/api/seller/products",
            json=payload,
            headers={**seller_headers, "Content-Type": "application/json"},
        )
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == payload["name"]
        assert created["price_nzd"] == 49.99
        assert "id" in created
        # GET to verify persistence
        lr = requests.get(f"{BASE_URL}/api/seller/products", headers=seller_headers)
        assert lr.status_code == 200
        ids = [p["id"] for p in lr.json()]
        assert created["id"] in ids

    def test_get_seller_products_still_works(self, seller_headers):
        r = requests.get(f"{BASE_URL}/api/seller/products", headers=seller_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------------------------------------------------------------------
# Auth header format — bare /api/seller/bulk/columns sanity round-trip
# ---------------------------------------------------------------------------
class TestAuthHeader:
    def test_garbage_bearer_blocked(self):
        r = requests.get(f"{BULK}/columns", headers={"Authorization": "Bearer garbage.token.value"})
        assert r.status_code in (401, 403), r.text

    def test_wrong_scheme_blocked(self, seller_headers):
        # Strip "Bearer " prefix → invalid scheme
        token = seller_headers["Authorization"].split(" ", 1)[1]
        r = requests.get(f"{BULK}/columns", headers={"Authorization": f"Basic {token}"})
        assert r.status_code in (401, 403), r.text

    def test_valid_bearer_works(self, seller_headers):
        r = requests.get(f"{BULK}/columns", headers=seller_headers)
        assert r.status_code == 200
        assert "columns" in r.json()
