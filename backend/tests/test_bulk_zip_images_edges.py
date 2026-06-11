"""Iteration-12 edge tests for the optional ZIP-of-images bulk upload flow.

Covers explicit acceptance criteria from the review request that are NOT
already covered by tests/test_bulk_zip_images.py:

  * Oversized ZIP (> 60 MB) → 413
  * Too many files in ZIP (> 500) → 413
  * Per-image > 6 MB → that file ends up in `skipped`, upload otherwise OK
  * Unsupported extensions (.txt / .pdf) → in `skipped`, response still 200
  * Dot-prefixed hidden entries (`.DS_Store`, `.gitignore`) → silently skipped
  * Auth: 401 when no token, 403 when caller is a buyer (not a verified seller)
  * URL / data: URI tokens in image_urls are PRESERVED through preview
"""
from __future__ import annotations

import io
import json
import os
import random
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

ZIP_URL = f"{BASE_URL}/api/seller/bulk/images-zip"
PREVIEW_URL = f"{BASE_URL}/api/seller/bulk/preview"

# 1x1 transparent PNG (valid bytes) — same as test_bulk_zip_images.py
_PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0"
    b"\xc0\xc0\x00\x00\x00\x05\x00\x01\x9d\x0e\x9e\xa8\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _make_zip(files: dict[str, bytes], *, compress: bool = True) -> bytes:
    """Build an in-memory ZIP from a {name: bytes} mapping."""
    buf = io.BytesIO()
    mode = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
    with zipfile.ZipFile(buf, "w", mode) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Fixtures: verified seller + a buyer
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def seller_session():
    from _helpers import make_gstin_pan

    g, p = make_gstin_pan()
    suffix = int(time.time() * 1000)
    body = {
        "email": f"TEST_zipedge_seller_{suffix}_{random.randint(1000, 9999)}@allsale.co.nz",
        "password": "Test1234!",
        "business": {
            "business_type": "private_limited",
            "company_name": "TEST Zip Edges Pvt Ltd",
            "gstin": g,
            "pan": p,
            "cin": "U74999MH2020PTC123456",
            "address_line1": "1 Edge Ln",
            "address_line2": "",
            "city": "Mumbai",
            "state": "Maharashtra",
            "pincode": "400001",
            "contact_name": "Edge Tester",
            "contact_phone": "+911234567890",
        },
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=body)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def buyer_session():
    """A standard (non-seller) buyer account."""
    suffix = int(time.time() * 1000)
    body = {
        "email": f"TEST_zipedge_buyer_{suffix}_{random.randint(1000, 9999)}@allsale.co.nz",
        "password": "Test1234!",
        "full_name": "Edge Buyer",
    }
    r = requests.post(f"{BASE_URL}/api/auth/register", json=body)
    if r.status_code not in (200, 201):
        pytest.skip(f"Could not create buyer: {r.status_code} {r.text[:200]}")
    token = r.json().get("access_token") or r.json().get("token")
    if not token:
        # Some apps return tokens only on /login. Fall back.
        lr = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": body["email"], "password": body["password"]},
        )
        token = lr.json().get("access_token")
    assert token, "could not obtain buyer token"
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Size / count limit tests
# ---------------------------------------------------------------------------
class TestZipSizeLimits:
    def test_oversize_zip_returns_413(self, seller_session):
        """A ZIP body larger than 60 MB must be rejected with HTTP 413."""
        # Use ZIP_STORED with a single big incompressible payload so the
        # archive itself is > 60 MB (compressed PNG bytes would collapse).
        big = os.urandom(61 * 1024 * 1024)  # 61 MB random bytes
        blob = _make_zip({"big.png": big}, compress=False)
        assert len(blob) > 60 * 1024 * 1024
        r = requests.post(
            ZIP_URL,
            files={"file": ("big.zip", blob, "application/zip")},
            headers=seller_session,
        )
        assert r.status_code == 413, r.text
        assert "60" in r.text or "large" in r.text.lower()

    def test_too_many_files_returns_413(self, seller_session):
        """A ZIP with > 500 entries should be rejected with HTTP 413."""
        files = {f"img_{i:04d}.png": _PNG_1PX for i in range(501)}
        blob = _make_zip(files)
        r = requests.post(
            ZIP_URL,
            files={"file": ("many.zip", blob, "application/zip")},
            headers=seller_session,
        )
        assert r.status_code == 413, r.text
        assert "many" in r.text.lower() or "500" in r.text

    def test_per_image_oversize_is_skipped_not_failed(self, seller_session):
        """A single image > 6 MB lands in `skipped` — the rest still upload."""
        big_img = b"\x89PNG\r\n\x1a\n" + os.urandom(7 * 1024 * 1024)  # ~7 MB
        blob = _make_zip(
            {
                "ok-1.png": _PNG_1PX,
                "huge.png": big_img,
                "ok-2.png": _PNG_1PX,
            }
        )
        r = requests.post(
            ZIP_URL,
            files={"file": ("mixed.zip", blob, "application/zip")},
            headers=seller_session,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # 2 small ones uploaded; huge.png skipped (too large)
        assert data["uploaded"] == 2
        assert any("huge.png" in s and "large" in s.lower() for s in data["skipped"]), data["skipped"]
        assert "ok-1.png" in data["mapping"]
        assert "ok-2.png" in data["mapping"]


# ---------------------------------------------------------------------------
# Skip / filter behaviour
# ---------------------------------------------------------------------------
class TestZipSkippingRules:
    def test_unsupported_extensions_go_into_skipped(self, seller_session):
        """`.txt` and `.pdf` are listed in `skipped` but do NOT fail the upload."""
        blob = _make_zip(
            {
                "good.png": _PNG_1PX,
                "README.txt": b"hello",
                "spec.pdf": b"%PDF-1.4 fake",
            }
        )
        r = requests.post(
            ZIP_URL,
            files={"file": ("mix.zip", blob, "application/zip")},
            headers=seller_session,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["uploaded"] == 1
        assert "good.png" in data["mapping"]
        joined = " | ".join(data["skipped"]).lower()
        assert "readme.txt" in joined
        assert "spec.pdf" in joined
        assert "unsupported" in joined

    def test_dot_prefixed_and_macosx_entries_are_silently_skipped(self, seller_session):
        """Hidden entries (`.DS_Store`, `__MACOSX/…`) are filtered out
        BEFORE we check for ALLOWED_IMG_EXT, so they must NOT appear in
        the skipped list.
        """
        blob = _make_zip(
            {
                "real.png": _PNG_1PX,
                ".DS_Store": b"junk",
                ".gitignore": b"junk",
                "__MACOSX/dontuploadme.png": _PNG_1PX,
                "sub/.hidden.png": _PNG_1PX,  # "/." path
            }
        )
        r = requests.post(
            ZIP_URL,
            files={"file": ("hidden.zip", blob, "application/zip")},
            headers=seller_session,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["uploaded"] == 1
        assert "real.png" in data["mapping"]
        joined = " | ".join(data["skipped"])
        assert ".DS_Store" not in joined
        assert ".gitignore" not in joined
        assert "__MACOSX" not in joined
        assert ".hidden.png" not in joined


# ---------------------------------------------------------------------------
# Auth gating
# ---------------------------------------------------------------------------
class TestZipAuth:
    def test_missing_token_returns_401(self):
        blob = _make_zip({"x.png": _PNG_1PX})
        r = requests.post(
            ZIP_URL,
            files={"file": ("x.zip", blob, "application/zip")},
        )
        assert r.status_code == 401, r.text

    def test_buyer_returns_403(self, buyer_session):
        blob = _make_zip({"x.png": _PNG_1PX})
        r = requests.post(
            ZIP_URL,
            files={"file": ("x.zip", blob, "application/zip")},
            headers=buyer_session,
        )
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Preview-time substitution: preserves URLs / data URIs
# ---------------------------------------------------------------------------
class TestPreviewPreserveExistingUrls:
    def test_existing_http_url_tokens_are_not_rewritten(self, seller_session):
        """If the image_urls cell already contains an http(s) URL, the
        substitution layer must leave that token alone. Filename tokens
        in the same cell should still be rewritten via images_map.
        """
        zip_bytes = _make_zip({"file_a.png": _PNG_1PX})
        r = requests.post(
            ZIP_URL,
            files={"file": ("imgs.zip", zip_bytes, "application/zip")},
            headers=seller_session,
        )
        assert r.status_code == 200, r.text
        images_map = r.json()["mapping"]
        hosted_a = images_map["file_a.png"]

        # Bogus mapping for an existing URL — verifies "kept as-is" rule
        # (the URL must not be looked up in / replaced by the map).
        images_map["https://cdn.example.com/keep.jpg"] = "https://SHOULD_NOT_BE_USED/x.jpg"

        cell = "file_a.png | https://cdn.example.com/keep.jpg"
        csv_text = (
            "product_id,name,description,category,price_nzd,stock_count,image_urls\n"
            f',Two-Token Item,A product with a filename and a URL token.,Ethnic Fashion,15.0,4,"{cell}"\n'
        )
        pr = requests.post(
            PREVIEW_URL,
            files={"file": ("mixed.csv", csv_text.encode(), "text/csv")},
            data={"images_map": json.dumps(images_map)},
            headers=seller_session,
        )
        assert pr.status_code == 200, pr.text
        body = pr.json()
        assert body["valid"] == 1, body
        imgs = body["rows"][0]["data"]["images"]
        assert len(imgs) == 2
        assert imgs[0] == hosted_a
        assert imgs[1] == "https://cdn.example.com/keep.jpg"

    def test_existing_data_uri_token_is_preserved(self, seller_session):
        """A data: URI already in the image_urls cell must survive
        through both _split_multi() and substitute_images_with_zip_map()
        without being mangled. NOTE: data: URIs contain ';' and ',' which
        are also used as token separators by the bulk parser.
        """
        data_uri = "data:image/png;base64,iVBORw0KGgo="
        csv_text = (
            "product_id,name,description,category,price_nzd,stock_count,image_urls\n"
            f',Data URI Item,A product using only a data URI image.,Ethnic Fashion,12.0,3,{data_uri}\n'
        )
        pr = requests.post(
            PREVIEW_URL,
            files={"file": ("datauri.csv", csv_text.encode(), "text/csv")},
            headers=seller_session,
        )
        assert pr.status_code == 200, pr.text
        body = pr.json()
        imgs = body["rows"][0]["data"]["images"]
        # The cell contained EXACTLY one image; it must come out as one.
        assert imgs == [data_uri], (
            f"data: URI was mangled (likely split on ';' or ','): {imgs}"
        )
        assert body["valid"] == 1, body

    def test_unknown_filename_remains_and_fails_validation(self, seller_session):
        """If a row references a filename not in the supplied map, the
        token stays as-is and the URL validator flags it as invalid."""
        csv_text = (
            "product_id,name,description,category,price_nzd,stock_count,image_urls\n"
            ",Bad Ref Item,Filename token absent from map should still fail.,Ethnic Fashion,9.0,2,missing.png\n"
        )
        files = {"file": ("bad.csv", csv_text.encode(), "text/csv")}
        pr = requests.post(
            PREVIEW_URL,
            files=files,
            data={"images_map": json.dumps({"other.png": "https://x/y.jpg"})},
            headers=seller_session,
        )
        assert pr.status_code == 200, pr.text
        row = pr.json()["rows"][0]
        assert row["ok"] is False
        assert any("url" in e.lower() or "image" in e.lower() for e in row["errors"])
