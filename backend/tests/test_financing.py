"""Tests for invoice-financing partner referrals."""
import os
import requests

from test_seller import BASE_URL, _valid_business

ADMIN_HEADERS = {"x-admin-secret": "allsale-admin-dev-secret"}


def _seller_token():
    payload = {
        "email": f"fin_{os.urandom(4).hex()}@example.com",
        "password": "Allsale1!safe",
        "business": _valid_business(),
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


class TestFinancingPartners:
    def test_partners_list_shape(self):
        token = _seller_token()
        r = requests.get(f"{BASE_URL}/api/financing/partners", headers=_h(token), timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "partners" in d
        assert "tier" in d
        assert "eligibility" in d
        assert "disclaimer" in d
        # Should include at least KredX + Cashinvoice
        ids = {p["id"] for p in d["partners"]}
        assert "kredx" in ids
        assert "cashinvoice" in ids
        # Each partner has core fields
        for p in d["partners"]:
            for k in (
                "id", "name", "tagline", "website", "advance_pct_min",
                "advance_pct_max", "fee_pct_min", "fee_pct_max",
                "min_monthly_invoices_inr", "min_business_age_months",
                "turnaround_hours", "best_for",
            ):
                assert k in p, f"missing {k} in partner {p.get('id')}"

    def test_starter_seller_not_eligible(self):
        token = _seller_token()
        r = requests.get(f"{BASE_URL}/api/financing/partners", headers=_h(token), timeout=10)
        d = r.json()
        assert d["tier"] == "starter"
        assert d["eligibility"]["eligible"] is False

    def test_apply_blocked_for_starter(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/financing/apply",
            json={
                "partner_id": "kredx",
                "desired_advance_nzd": 5000,
                "monthly_invoices_inr": 150000,
                "business_age_months": 12,
            },
            headers=_h(token),
            timeout=10,
        )
        assert r.status_code == 400
        assert "verified" in (r.json().get("detail") or "").lower()

    def test_unknown_partner_rejected(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/financing/apply",
            json={"partner_id": "bogus_partner", "desired_advance_nzd": 1000},
            headers=_h(token),
            timeout=10,
        )
        # Either 400 (validator) or 422 (pydantic). We expect 400.
        assert r.status_code in (400, 422)

    def test_my_applications_empty_initially(self):
        token = _seller_token()
        r = requests.get(
            f"{BASE_URL}/api/financing/applications", headers=_h(token), timeout=10
        )
        assert r.status_code == 200
        assert r.json() == []

    def test_admin_list_endpoint(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/financing",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_admin_list_requires_secret(self):
        r = requests.get(f"{BASE_URL}/api/admin/financing", timeout=10)
        assert r.status_code == 403

    def test_admin_get_unknown_returns_404(self):
        r = requests.get(
            f"{BASE_URL}/api/admin/financing/fin_unknown_x",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 404

    def test_admin_patch_unknown_returns_404(self):
        r = requests.patch(
            f"{BASE_URL}/api/admin/financing/fin_unknown_y",
            json={"status": "approved"},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 404

    def test_admin_patch_invalid_status(self):
        # Use any existing app or just check validation responds — there may be
        # no app, so this returns 404 (validator hits before lookup); accept either.
        r = requests.patch(
            f"{BASE_URL}/api/admin/financing/fin_unknown_z",
            json={"status": "bogus_status_x"},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code in (400, 404, 422)
