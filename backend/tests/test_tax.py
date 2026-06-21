"""Smoke tests for the cross-border tax calculator.

Allsale ships from India to multiple jurisdictions. Each jurisdiction has its
own consumption-tax regime for offshore retailers. We verify:

  - NZ buyers get 15% GST on goods+shipping for low-value parcels
  - NZ buyers over $1,000 get NO GST (customs collects at border)
  - AU buyers get 10% GST on low-value
  - UK buyers get 20% VAT on low-value
  - US/CA/Pacific buyers see "at_border" hint (no in-app tax)
  - India domestic buyers see "inclusive" hint
"""
from __future__ import annotations

import pytest

from services.tax import TAX_RULES, compute_tax


def test_nz_low_value_gst_15pct():
    r = compute_tax(subtotal_nzd=500.0, shipping_nzd=20.0, country="NZ")
    assert r.rate == 0.15
    assert r.over_threshold is False
    assert r.at_border is False
    # 15% of (500 + 20) = 78.00
    assert r.tax_nzd == 78.0
    assert r.label_key == "tax.nz_gst"


def test_nz_high_value_no_gst_collected():
    """NZ orders > NZ$1,000 → GST is charged at the border, NOT by us."""
    r = compute_tax(subtotal_nzd=1500.0, shipping_nzd=50.0, country="NZ")
    assert r.over_threshold is True
    assert r.at_border is True
    assert r.tax_nzd == 0.0


def test_au_gst_10pct():
    r = compute_tax(subtotal_nzd=400.0, shipping_nzd=15.0, country="AU")
    assert r.rate == 0.10
    # 10% of 415 = 41.50
    assert r.tax_nzd == 41.5
    assert r.over_threshold is False


def test_uk_vat_20pct_under_threshold():
    r = compute_tax(subtotal_nzd=200.0, shipping_nzd=15.0, country="GB")
    assert r.rate == 0.20
    # 20% of 215 = 43.00
    assert r.tax_nzd == 43.0
    assert r.over_threshold is False


def test_uk_above_135_no_vat_collected():
    """UK orders above £135 (~NZ$280) → border collection."""
    r = compute_tax(subtotal_nzd=350.0, shipping_nzd=20.0, country="GB")
    assert r.over_threshold is True
    assert r.tax_nzd == 0.0
    assert r.at_border is True


def test_us_no_in_app_tax():
    """US has no federal VAT and de-minimis up to ~US$800 — nothing collected."""
    r = compute_tax(subtotal_nzd=500.0, shipping_nzd=30.0, country="US")
    assert r.tax_nzd == 0.0
    assert r.at_border is True


def test_india_domestic_marked_inclusive():
    """For IN, seller's price already includes 18% IGST. Frontend can
    surface a transparency note instead of charging again."""
    r = compute_tax(subtotal_nzd=300.0, shipping_nzd=10.0, country="IN")
    assert r.tax_nzd == 0.0
    assert r.inclusive is True
    assert r.label_key == "tax.in_gst_inclusive"


@pytest.mark.parametrize("country", ["FJ", "PG", "WS", "TO"])
def test_pacific_no_in_app_tax(country):
    """Pacific tail destinations clear customs locally — nothing collected."""
    r = compute_tax(subtotal_nzd=200.0, shipping_nzd=40.0, country=country)
    assert r.tax_nzd == 0.0
    assert r.at_border is True
    assert r.inclusive is False


def test_unknown_country_defaults_to_no_tax():
    """For a country we don't know, default to safe behaviour (no tax)."""
    r = compute_tax(subtotal_nzd=100.0, shipping_nzd=10.0, country="XX")
    assert r.tax_nzd == 0.0
    assert r.at_border is True


def test_to_dict_shape_complete():
    r = compute_tax(subtotal_nzd=500.0, shipping_nzd=20.0, country="NZ")
    d = r.to_dict()
    expected_keys = {
        "tax_country", "tax_rate", "tax_nzd", "tax_label_key",
        "tax_threshold_nzd", "tax_over_threshold", "tax_at_border",
        "tax_inclusive",
    }
    assert expected_keys.issubset(d.keys())


def test_zero_subtotal_no_tax():
    """Empty cart edge case."""
    r = compute_tax(subtotal_nzd=0.0, shipping_nzd=0.0, country="NZ")
    assert r.tax_nzd == 0.0


def test_tax_country_uppercased():
    r = compute_tax(subtotal_nzd=100.0, shipping_nzd=10.0, country="nz")
    assert r.country == "NZ"
    assert r.rate == 0.15


def test_all_jurisdictions_have_rules():
    """Regression guard: NZ/AU/GB/IN/US/CA + 4 Pacific = 10 known countries."""
    must_have = {"NZ", "AU", "GB", "IN", "US", "CA", "FJ", "PG", "WS", "TO"}
    assert must_have.issubset(TAX_RULES.keys())
