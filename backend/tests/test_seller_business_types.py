"""Iteration 6 — business-type selector tests for /api/seller/register.

Covers all 7 entity types: sole_proprietorship, partnership_firm, llp,
private_limited, public_limited, opc, section_8.
"""
import os
import random
import string
import time
from pathlib import Path

import pytest

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


def _ts():
    return int(time.time() * 1000)


def _rand_pan_prefix():
    """Random 5-letter prefix used in both GSTIN (positions 2..7) and PAN[0..5]."""
    return "".join(random.choices(string.ascii_uppercase, k=5))


def _make_gstin_pan():
    """Return a (gstin, pan) pair where PAN == GSTIN[2:12]."""
    prefix = _rand_pan_prefix()
    pan = f"{prefix}1234F"  # 5 letters + 4 digits + 1 letter
    entity = random.choice(string.ascii_uppercase + "123456789")
    check = random.choice(string.ascii_uppercase + string.digits)
    gstin = f"27{pan}{entity}Z{check}"
    # Sanity: PAN must equal GSTIN[2:12]
    assert pan == gstin[2:12]
    return gstin, pan


def _biz(business_type, cin=None, llpin=None):
    gstin, pan = _make_gstin_pan()
    b = {
        "business_type": business_type,
        "company_name": f"TEST {business_type} Co",
        "gstin": gstin,
        "pan": pan,
        "address_line1": "12 Test Lane",
        "address_line2": "Andheri East",
        "city": "Mumbai",
        "state": "Maharashtra",
        "pincode": "400001",
        "contact_name": "Test Contact",
        "contact_phone": "+919999999999",
    }
    if cin is not None:
        b["cin"] = cin
    if llpin is not None:
        b["llpin"] = llpin
    return b


def _register(api_client, business):
    return api_client.post(
        f"{BASE_URL}/api/seller/register",
        json={
            "email": f"TEST_bt_{business['business_type']}_{_ts()}_{random.randint(1, 1_000_000)}@allsale.co.nz",
            "password": "Test1234!",
            "business": business,
        },
    )


VALID_CIN = "U74999MH2020PTC123456"


# --- CIN-required entity types ---------------------------------------------
class TestCinRequiredTypes:
    @pytest.mark.parametrize("btype", ["private_limited", "public_limited", "opc", "section_8"])
    def test_valid_cin_succeeds(self, api_client, btype):
        r = _register(api_client, _biz(btype, cin=VALID_CIN))
        assert r.status_code == 200, r.text
        data = r.json()
        # Verify saved business_type + cin via /seller/me
        h = {"Authorization": f"Bearer {data['access_token']}"}
        me = api_client.get(f"{BASE_URL}/api/seller/me", headers=h)
        assert me.status_code == 200
        prof = me.json()
        assert prof["business_type"] == btype
        assert prof["cin"] == VALID_CIN
        assert prof["llpin"] in (None, "")

    @pytest.mark.parametrize("btype", ["private_limited", "public_limited", "opc", "section_8"])
    def test_missing_cin_rejected(self, api_client, btype):
        r = _register(api_client, _biz(btype, cin=None))
        assert r.status_code == 400, r.text
        assert "CIN" in r.json()["detail"]

    def test_cin_with_llpin_rejected_for_pvt(self, api_client):
        r = _register(api_client, _biz("private_limited", cin=VALID_CIN, llpin="AAB-1234"))
        assert r.status_code == 400
        assert "LLPIN" in r.json()["detail"]


# --- LLP -------------------------------------------------------------------
class TestLlp:
    @pytest.mark.parametrize("llpin", ["AAB-1234", "AAB1234"])
    def test_valid_llpin_succeeds(self, api_client, llpin):
        r = _register(api_client, _biz("llp", llpin=llpin))
        assert r.status_code == 200, r.text
        data = r.json()
        h = {"Authorization": f"Bearer {data['access_token']}"}
        me = api_client.get(f"{BASE_URL}/api/seller/me", headers=h)
        assert me.status_code == 200
        prof = me.json()
        assert prof["business_type"] == "llp"
        assert prof["llpin"] == llpin.upper()
        assert prof["cin"] in (None, "")

    def test_missing_llpin_rejected(self, api_client):
        r = _register(api_client, _biz("llp"))
        assert r.status_code == 400
        assert "LLPIN" in r.json()["detail"]

    def test_cin_set_for_llp_rejected(self, api_client):
        r = _register(api_client, _biz("llp", cin=VALID_CIN, llpin="AAB-1234"))
        assert r.status_code == 400
        assert "CIN" in r.json()["detail"]


# --- No-MCA types ----------------------------------------------------------
class TestNoMcaTypes:
    @pytest.mark.parametrize("btype", ["sole_proprietorship", "partnership_firm"])
    def test_no_ids_succeeds(self, api_client, btype):
        r = _register(api_client, _biz(btype))
        assert r.status_code == 200, r.text
        data = r.json()
        h = {"Authorization": f"Bearer {data['access_token']}"}
        me = api_client.get(f"{BASE_URL}/api/seller/me", headers=h)
        assert me.status_code == 200
        prof = me.json()
        assert prof["business_type"] == btype
        assert prof["cin"] in (None, "")
        assert prof["llpin"] in (None, "")

    def test_sole_prop_with_cin_rejected(self, api_client):
        r = _register(api_client, _biz("sole_proprietorship", cin=VALID_CIN))
        assert r.status_code == 400
        assert "do not apply" in r.json()["detail"].lower() or "CIN" in r.json()["detail"]

    def test_partnership_with_llpin_rejected(self, api_client):
        r = _register(api_client, _biz("partnership_firm", llpin="AAB-1234"))
        assert r.status_code == 400


# --- Invalid type ----------------------------------------------------------
class TestInvalidBusinessType:
    def test_unknown_type_rejected(self, api_client):
        r = _register(api_client, _biz("proprietary", cin=VALID_CIN))
        assert r.status_code == 400
        assert "business type" in r.json()["detail"].lower()


# --- PAN vs GSTIN cross-check still fires for all types --------------------
class TestPanGstinForAllTypes:
    @pytest.mark.parametrize(
        "btype,extras",
        [
            ("private_limited", {"cin": VALID_CIN}),
            ("public_limited", {"cin": VALID_CIN}),
            ("opc", {"cin": VALID_CIN}),
            ("section_8", {"cin": VALID_CIN}),
            ("llp", {"llpin": "AAB-1234"}),
            ("sole_proprietorship", {}),
            ("partnership_firm", {}),
        ],
    )
    def test_pan_mismatch_rejected(self, api_client, btype, extras):
        b = _biz(btype, **extras)
        b["pan"] = "ZZZZZ9999Z"  # valid format, but won't match GSTIN[2:12]
        r = _register(api_client, b)
        assert r.status_code == 400, r.text
        assert "PAN" in r.json()["detail"]
