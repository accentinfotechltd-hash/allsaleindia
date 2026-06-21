"""End-to-end validation: GST/VAT computation + invoice PDF generation
for every supported destination country.

Verifies the full tax loop:
  1. compute_tax() returns the right rate for the country
  2. tax_nzd matches the documented formula (% of taxable base)
  3. PDF is generated successfully (no crashes on any country's tax state)
  4. The right human-readable label lands in the PDF text
"""
from __future__ import annotations

import io

import pytest
from pypdf import PdfReader

from routers.invoices import _build_pdf_bytes
from services.tax import compute_tax


def _mock_order(country: str, subtotal: float, shipping: float) -> dict:
    """Build a minimal but valid order doc with tax computed for `country`."""
    tax = compute_tax(subtotal_nzd=subtotal, shipping_nzd=shipping, country=country)
    total = round(subtotal + shipping + tax.tax_nzd, 2)
    return {
        "id": f"o_e2e_{country.lower()}",
        "created_at": "2026-06-20T00:00:00Z",
        "paid_at": "2026-06-20T00:01:23Z",
        "items": [
            {
                "name": "Saree (silk)",
                "quantity": 1,
                "price_nzd": subtotal,
                "seller_name": "Mumbai Silks Ltd",
            }
        ],
        "subtotal_nzd": subtotal,
        "shipping_nzd": shipping,
        "discount_nzd": 0,
        "points_discount_nzd": 0,
        "tax_nzd": tax.tax_nzd,
        "tax_rate": tax.rate,
        "tax_country": tax.country,
        "tax_label_key": tax.label_key,
        "tax_at_border": tax.at_border,
        "tax_inclusive": tax.inclusive,
        "tax_over_threshold": tax.over_threshold,
        "total_nzd": total,
        "buyer_currency": "NZD",
        "charge_amount": total,
        "shipping_courier_name": "India Post",
        "estimated_delivery": "2026-07-05",
        "address": {
            "full_name": "Test Buyer",
            "line1": "1 Test Rd",
            "city": "Auckland",
            "region": "AKL",
            "postcode": "1010",
            "country": country,
            "phone": "+64 21 555 1234",
        },
    }


def _pdf_text(order: dict) -> str:
    """Generate a PDF and return its concatenated text content."""
    pdf_bytes = _build_pdf_bytes(order, "buyer@example.com")
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return " ".join(p.extract_text() or "" for p in reader.pages)


# ---------------------------------------------------------------------------
# Country-by-country: tax math
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "country,subtotal,shipping,expected_tax",
    [
        # Below threshold → in-app collection
        ("NZ", 500.0, 20.0, 78.00),    # 15% of 520
        ("NZ", 100.0, 10.0, 16.50),    # 15% of 110
        ("AU", 400.0, 15.0, 41.50),    # 10% of 415
        ("AU", 1000.0, 0.0, 100.00),   # exactly 10% of 1000
        ("GB", 200.0, 15.0, 43.00),    # 20% of 215
        ("GB", 50.0, 10.0, 12.00),     # 20% of 60
    ],
)
def test_below_threshold_tax_is_charged(country, subtotal, shipping, expected_tax):
    r = compute_tax(subtotal_nzd=subtotal, shipping_nzd=shipping, country=country)
    assert r.tax_nzd == expected_tax, (
        f"{country} expected {expected_tax}, got {r.tax_nzd}"
    )
    assert r.over_threshold is False


@pytest.mark.parametrize(
    "country,subtotal",
    [
        ("NZ", 1500.0),
        ("AU", 1500.0),
        ("GB", 400.0),
    ],
)
def test_above_threshold_no_in_app_tax(country, subtotal):
    """NZ/AU > $1k OR UK > £135 → customs collects at border, not us."""
    r = compute_tax(subtotal_nzd=subtotal, shipping_nzd=50.0, country=country)
    assert r.tax_nzd == 0.0
    assert r.over_threshold is True
    assert r.at_border is True


@pytest.mark.parametrize("country", ["US", "CA", "FJ", "PG", "WS", "TO"])
def test_no_tax_jurisdictions_show_at_border(country):
    """Countries we don't collect for should always show `at_border`."""
    r = compute_tax(subtotal_nzd=400.0, shipping_nzd=20.0, country=country)
    assert r.tax_nzd == 0.0
    assert r.at_border is True
    assert r.inclusive is False


def test_india_marked_inclusive():
    """India = inclusive (18% IGST already in seller price)."""
    r = compute_tax(subtotal_nzd=500.0, shipping_nzd=20.0, country="IN")
    assert r.tax_nzd == 0.0
    assert r.inclusive is True
    assert r.at_border is False  # not at-border, it's inclusive


# ---------------------------------------------------------------------------
# PDF rendering: invoice must show the right tax row for each country
# ---------------------------------------------------------------------------

def test_pdf_nz_shows_gst_15_pct():
    pdf_text = _pdf_text(_mock_order("NZ", 500.0, 20.0))
    assert "NZ GST 15%" in pdf_text
    # Expected tax: 15% of (500 + 20) = $78.00
    assert "78.00" in pdf_text or "$78.00" in pdf_text


def test_pdf_au_shows_gst_10_pct():
    pdf_text = _pdf_text(_mock_order("AU", 400.0, 15.0))
    assert "AU GST 10%" in pdf_text
    assert "41.50" in pdf_text or "$41.50" in pdf_text


def test_pdf_gb_shows_vat_20_pct():
    pdf_text = _pdf_text(_mock_order("GB", 100.0, 15.0))
    assert "UK VAT 20%" in pdf_text
    assert "23.00" in pdf_text or "$23.00" in pdf_text  # 20% of 115


def test_pdf_india_shows_inclusive_note():
    pdf_text = _pdf_text(_mock_order("IN", 500.0, 20.0))
    assert "GST included in price" in pdf_text


def test_pdf_above_threshold_nz_shows_at_border():
    """High-value NZ order → "Customs duty (collected at border)"."""
    pdf_text = _pdf_text(_mock_order("NZ", 1500.0, 50.0))
    assert "Customs duty" in pdf_text
    assert "at border" in pdf_text.lower()


def test_pdf_above_threshold_uk_shows_at_border():
    pdf_text = _pdf_text(_mock_order("GB", 400.0, 30.0))
    assert "Customs duty" in pdf_text


@pytest.mark.parametrize("country", ["US", "CA", "FJ", "PG", "WS", "TO"])
def test_pdf_no_tax_jurisdictions_omit_tax_line(country):
    """For countries where we charge no in-app tax AND not above threshold,
    we hide the row entirely to avoid clutter."""
    pdf_text = _pdf_text(_mock_order(country, 300.0, 15.0))
    # No GST/VAT line, no "included" note for these — clean invoice
    assert "NZ GST" not in pdf_text
    assert "AU GST" not in pdf_text
    assert "UK VAT" not in pdf_text


def test_pdf_total_includes_tax():
    """PDF total line must equal subtotal + shipping + tax_nzd."""
    order = _mock_order("NZ", 500.0, 20.0)
    expected_total = 500.0 + 20.0 + 78.0  # 598.00
    assert order["total_nzd"] == expected_total
    pdf_text = _pdf_text(order)
    assert f"{expected_total:.2f}" in pdf_text


# ---------------------------------------------------------------------------
# Defensive: zero-tax + free shipping shouldn't crash
# ---------------------------------------------------------------------------

def test_pdf_zero_shipping_zero_tax_ok():
    """E.g. India domestic with free shipping."""
    order = _mock_order("IN", 100.0, 0.0)
    pdf_text = _pdf_text(order)
    assert "Subtotal" in pdf_text
    assert "TOTAL" in pdf_text


# ---------------------------------------------------------------------------
# Dynamic legal/registration footer per destination
# ---------------------------------------------------------------------------

def test_footer_nz_mentions_ird_registration():
    pdf_text = _pdf_text(_mock_order("NZ", 500.0, 20.0))
    assert "NZ GST 15%" in pdf_text
    assert "Inland Revenue" in pdf_text


def test_footer_au_mentions_ato():
    pdf_text = _pdf_text(_mock_order("AU", 400.0, 15.0))
    assert "AU GST 10%" in pdf_text
    assert "ATO" in pdf_text


def test_footer_gb_mentions_hmrc():
    pdf_text = _pdf_text(_mock_order("GB", 100.0, 15.0))
    assert "UK VAT 20%" in pdf_text
    assert "HMRC" in pdf_text


def test_footer_above_threshold_mentions_border():
    pdf_text = _pdf_text(_mock_order("NZ", 1500.0, 50.0))
    assert "customs duty" in pdf_text.lower() or "import VAT" in pdf_text


def test_footer_india_mentions_igst_inclusive():
    pdf_text = _pdf_text(_mock_order("IN", 500.0, 20.0))
    assert "18% IGST" in pdf_text
    assert "included" in pdf_text.lower()


@pytest.mark.parametrize("country", ["US", "CA", "FJ", "PG", "WS", "TO"])
def test_footer_no_in_app_tax_mentions_local_customs(country):
    pdf_text = _pdf_text(_mock_order(country, 300.0, 15.0))
    assert "local customs" in pdf_text.lower()


def test_footer_never_says_gst_not_applicable():
    """Regression: the old misleading "GST not applicable" footer must NOT
    appear on any country's invoice."""
    for country in ("NZ", "AU", "GB", "IN", "US", "CA", "FJ", "PG", "WS", "TO"):
        pdf_text = _pdf_text(_mock_order(country, 300.0, 15.0))
        assert "GST not applicable" not in pdf_text, (
            f"{country} invoice still has the misleading 'GST not applicable' footer"
        )


def test_pdf_with_discount_still_shows_tax():
    """Tax is on the gross sale price — discount doesn't reduce GST owed."""
    order = _mock_order("NZ", 500.0, 20.0)
    order["discount_nzd"] = 50.0
    order["coupon_code"] = "SAVE50"
    order["coupon_label"] = "Save NZ$50"
    # Total should still be subtotal + shipping + tax - discount
    order["total_nzd"] = round(500.0 + 20.0 + 78.0 - 50.0, 2)
    pdf_text = _pdf_text(order)
    assert "NZ GST 15%" in pdf_text
    assert "Save NZ$50" in pdf_text or "SAVE50" in pdf_text
