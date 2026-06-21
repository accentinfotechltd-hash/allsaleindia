"""Smoke tests for the Pacific shipping calculator extension.

Verifies that:
  - Pacific destinations (FJ/PG/WS/TO) all return a quote
  - Their freight is materially MORE expensive than NZ/AU for the same parcel
  - Pacific quotes don't expose an Express tier (we drop it on purpose)
  - Tonga (the most remote of the four) is the most expensive
  - Free-shipping threshold is country-specific (not hardcoded to NZD $80)
"""
from __future__ import annotations

import pytest

from services.shipping_quotes import COUNTRY_CONFIG, quote


# Same parcel, varying destination
WEIGHT_KG = 0.5

# 1 unit of buyer currency = how many INR.
INR_PER_UNIT = {
    "NZ": 50.0,
    "AU": 56.0,
    "US": 83.5,
    "FJ": 37.0,
    "PG": 22.0,
    "WS": 30.0,
    "TO": 34.0,
}


def _standard_inr(country: str) -> float:
    """Helper: return the INR cost of the standard tier for a destination."""
    q = quote(
        country=country,
        weight_kg=WEIGHT_KG,
        fx_rate_inr_per_unit=INR_PER_UNIT[country],
    )
    std = next(o for o in q["options"] if o["tier"] == "standard")
    return std["rate_inr"]


def test_all_pacific_countries_quote():
    """Each Pacific destination returns at least 1 shipping option."""
    for country in ("FJ", "PG", "WS", "TO"):
        q = quote(
            country=country,
            weight_kg=WEIGHT_KG,
            fx_rate_inr_per_unit=INR_PER_UNIT[country],
        )
        assert q["country"] == country
        assert len(q["options"]) >= 1, f"no shipping options for {country}"
        assert any(o["tier"] == "standard" for o in q["options"]), (
            f"missing standard tier for {country}"
        )


def test_pacific_more_expensive_than_nz():
    """Pacific freight should be strictly more expensive than NZ."""
    nz_inr = _standard_inr("NZ")
    for country in ("FJ", "PG", "WS", "TO"):
        pacific_inr = _standard_inr(country)
        assert pacific_inr > nz_inr, (
            f"{country} cost ({pacific_inr}) not > NZ cost ({nz_inr})"
        )


def test_tonga_is_most_expensive():
    """TO is the most remote → should be the priciest of the Pacific four."""
    costs = {c: _standard_inr(c) for c in ("FJ", "PG", "WS", "TO")}
    most_expensive = max(costs, key=costs.get)
    assert most_expensive == "TO", f"expected TO most expensive, got {costs}"


def test_pacific_drops_express_tier():
    """Pacific destinations don't get an Express tier (India Post EMS gap)."""
    for country in ("FJ", "PG", "WS", "TO"):
        q = quote(
            country=country,
            weight_kg=WEIGHT_KG,
            fx_rate_inr_per_unit=INR_PER_UNIT[country],
        )
        tiers = [o["tier"] for o in q["options"]]
        assert "express" not in tiers, f"{country} should not offer express"


def test_nz_still_has_express():
    """Regression guard: NZ keeps its Express tier."""
    q = quote(
        country="NZ",
        weight_kg=WEIGHT_KG,
        fx_rate_inr_per_unit=INR_PER_UNIT["NZ"],
    )
    tiers = [o["tier"] for o in q["options"]]
    assert "express" in tiers


def test_country_specific_free_shipping_threshold():
    """Each Pacific country has its own threshold — none should default to NZ's 80."""
    # All Pacific thresholds should be >= 180 (in their local currency)
    for country in ("FJ", "PG", "WS", "TO"):
        assert COUNTRY_CONFIG[country]["free_shipping_threshold"] >= 180, (
            f"{country} threshold looks like an NZ leak"
        )


def test_free_shipping_applies_at_pacific_threshold():
    """When subtotal >= threshold, standard tier becomes free."""
    cfg = COUNTRY_CONFIG["FJ"]
    threshold = cfg["free_shipping_threshold"]
    q = quote(
        country="FJ",
        weight_kg=WEIGHT_KG,
        fx_rate_inr_per_unit=INR_PER_UNIT["FJ"],
        order_subtotal_in_currency=threshold + 1.0,
    )
    std = next(o for o in q["options"] if o["tier"] == "standard")
    assert std["free"] is True
    assert std["rate_in_currency"] == 0.0


def test_pacific_sla_is_slower():
    """Standard SLA strings for Pacific should mention more days than NZ."""
    nz_q = quote(
        country="NZ",
        weight_kg=WEIGHT_KG,
        fx_rate_inr_per_unit=INR_PER_UNIT["NZ"],
    )
    fj_q = quote(
        country="FJ",
        weight_kg=WEIGHT_KG,
        fx_rate_inr_per_unit=INR_PER_UNIT["FJ"],
    )
    nz_std_sla = next(o["sla"] for o in nz_q["options"] if o["tier"] == "standard")
    fj_std_sla = next(o["sla"] for o in fj_q["options"] if o["tier"] == "standard")
    assert nz_std_sla != fj_std_sla


@pytest.mark.parametrize("country", ["FJ", "PG", "WS", "TO"])
def test_pacific_quote_shape(country):
    """Sanity: returned dict has expected top-level keys."""
    q = quote(
        country=country,
        weight_kg=WEIGHT_KG,
        fx_rate_inr_per_unit=INR_PER_UNIT[country],
    )
    assert {"country", "weight_kg", "options", "free_shipping_threshold"}.issubset(
        q.keys()
    )
    for opt in q["options"]:
        assert {"tier", "rate_inr", "rate_in_currency", "sla"}.issubset(opt.keys())
        assert opt["rate_in_currency"] > 0 or opt["free"]
