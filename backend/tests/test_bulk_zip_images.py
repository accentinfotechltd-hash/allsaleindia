"""Tests for the optional ZIP-of-images upload (/api/seller/bulk/images-zip)
and filename → URL substitution at /preview time.
"""
import io
import os
import random
import string
import time
import zipfile
from pathlib import Path

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


def _gstin_pan():
    from _helpers import make_gstin_pan

    return make_gstin_pan()


@pytest.fixture(scope="module")
def seller_session():
    g, p = _gstin_pan()
    suffix = int(time.time() * 1000)
    body = {
        "email": f"TEST_zip_seller_{suffix}_{random.randint(1000, 9999)}@allsale.co.nz",
        "password": "Test1234!",
        "business": {
            "business_type": "private_limited",
            "company_name": "TEST Zip Bulk Pvt Ltd",
            "gstin": g,
            "pan": p,
            "cin": "U74999MH2020PTC123456",
            "address_line1": "1 Zip Ln",
            "address_line2": "",
            "city": "Mumbai",
            "state": "Maharashtra",
            "pincode": "400001",
            "contact_name": "Zip Tester",
            "contact_phone": "+911234567890",
        },
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=body)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# 1x1 transparent PNG (valid bytes)
_PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0"
    b"\xc0\xc0\x00\x00\x00\x05\x00\x01\x9d\x0e\x9e\xa8\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _make_zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_images_zip_upload_returns_mapping(seller_session):
    zip_bytes = _make_zip(
        {
            "sku-1_front.png": _PNG_1PX,
            "sku-1_back.png": _PNG_1PX,
            "sku-2.png": _PNG_1PX,
            "README.txt": b"this should be skipped",
            "__MACOSX/skipme.png": _PNG_1PX,  # OS junk
        }
    )
    files = {"file": ("images.zip", zip_bytes, "application/zip")}
    r = requests.post(
        f"{BASE_URL}/api/seller/bulk/images-zip",
        files=files,
        headers=seller_session,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["uploaded"] == 3
    assert data["provider"] in {"cloudinary", "passthrough"}
    # Mapping has both full-path AND basename keys
    assert "sku-1_front.png" in data["mapping"]
    assert "sku-2.png" in data["mapping"]
    # README.txt should appear in skipped (unsupported file type)
    assert any("README.txt" in s for s in data["skipped"])
    # Each value is either a Cloudinary URL or a data: URI
    for v in data["mapping"].values():
        assert v.startswith("http") or v.startswith("data:")


def test_images_zip_rejects_non_zip(seller_session):
    files = {"file": ("notazip.zip", b"hello world", "application/zip")}
    r = requests.post(
        f"{BASE_URL}/api/seller/bulk/images-zip",
        files=files,
        headers=seller_session,
    )
    assert r.status_code == 400
    assert "valid ZIP" in r.text or "ZIP" in r.text


def test_images_zip_rejects_empty_upload(seller_session):
    files = {"file": ("empty.zip", b"", "application/zip")}
    r = requests.post(
        f"{BASE_URL}/api/seller/bulk/images-zip",
        files=files,
        headers=seller_session,
    )
    assert r.status_code == 400


def test_preview_substitutes_filenames_against_images_map(seller_session):
    """Upload a ZIP, then upload a CSV whose image_urls references the
    bare filename — the backend must rewrite them to hosted URLs before
    validating, so the row passes the URL check.
    """
    zip_bytes = _make_zip({"alpha.png": _PNG_1PX, "beta.png": _PNG_1PX})
    files = {"file": ("imgs.zip", zip_bytes, "application/zip")}
    r = requests.post(
        f"{BASE_URL}/api/seller/bulk/images-zip",
        files=files,
        headers=seller_session,
    )
    assert r.status_code == 200, r.text
    images_map = r.json()["mapping"]
    assert "alpha.png" in images_map and "beta.png" in images_map

    csv = (
        "product_id,name,description,category,price_nzd,stock_count,image_urls\n"
        ",ZIP Sub Item A,An A-grade test product referencing alpha.,Ethnic Fashion,"
        "29.99,5,alpha.png\n"
        ",ZIP Sub Item B,Another B-grade test product referencing beta.,Home & Puja,"
        "55.00,3,beta.png\n"
    )
    files = {"file": ("rows.csv", csv.encode(), "text/csv")}
    pr = requests.post(
        f"{BASE_URL}/api/seller/bulk/preview",
        files=files,
        data={"images_map": __import__("json").dumps(images_map)},
        headers=seller_session,
    )
    assert pr.status_code == 200, pr.text
    preview = pr.json()
    assert preview["total"] == 2
    assert preview["valid"] == 2
    assert preview["errors"] == 0
    for row in preview["rows"]:
        assert row["ok"]
        assert len(row["data"]["images"]) == 1
        assert row["data"]["images"][0].startswith(("http", "data:"))


def test_preview_without_images_map_flags_filename_as_invalid_url(seller_session):
    """Sanity check the inverse case: if no images_map is supplied and a
    seller pastes a bare filename, the row should fail validation.
    """
    csv = (
        "product_id,name,description,category,price_nzd,stock_count,image_urls\n"
        ",ZIP No-Map Item,Filename-only image reference should fail.,Ethnic Fashion,"
        "10.0,2,nope.jpg\n"
    )
    files = {"file": ("nomap.csv", csv.encode(), "text/csv")}
    pr = requests.post(
        f"{BASE_URL}/api/seller/bulk/preview",
        files=files,
        headers=seller_session,
    )
    assert pr.status_code == 200
    data = pr.json()
    assert data["rows"][0]["ok"] is False
    assert any(
        "url" in e.lower() or "image" in e.lower() for e in data["rows"][0]["errors"]
    )
