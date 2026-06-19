"""Unit tests for the shipment milestone detector (Phase 1.5 #4)."""
from __future__ import annotations

import pytest

from services.shipment_milestones import detect_milestone


NZ_ORDER = {
    "address": {"country": "New Zealand", "city": "Auckland"},
    "milestones_notified": [],
}


def test_detects_arrival_in_destination_country_by_country_name():
    out = detect_milestone(
        event_status="Arrived",
        event_location="Auckland, New Zealand",
        event_remark="Reached destination hub",
        order=NZ_ORDER,
    )
    assert out is not None
    assert out["key"] == "arrived_in_destination"
    assert "New Zealand" in out["title"] or "NZ" in out["title"]


def test_detects_arrival_by_major_city():
    out = detect_milestone(
        event_status="In Transit",
        event_location="Auckland sorting hub",
        event_remark="",
        order=NZ_ORDER,
    )
    assert out is not None
    assert out["key"] == "arrived_in_destination"


def test_skips_arrival_when_already_notified():
    order = {**NZ_ORDER, "milestones_notified": ["arrived_in_destination"]}
    out = detect_milestone(
        event_status="Arrived",
        event_location="Auckland",
        event_remark="",
        order=order,
    )
    # Already notified arrival — should not re-fire (could still fire customs though)
    assert out is None or out["key"] != "arrived_in_destination"


def test_detects_customs_cleared():
    out = detect_milestone(
        event_status="Customs Cleared",
        event_location="Auckland",
        event_remark="Released by customs",
        order={"address": {"country": "New Zealand"}, "milestones_notified": ["arrived_in_destination"]},
    )
    assert out is not None
    assert out["key"] == "customs_cleared"
    assert "✅" in out["title"]


def test_skips_customs_when_already_notified():
    order = {
        "address": {"country": "New Zealand"},
        "milestones_notified": ["arrived_in_destination", "customs_cleared"],
    }
    out = detect_milestone(
        event_status="Customs Cleared",
        event_location="",
        event_remark="customs cleared",
        order=order,
    )
    assert out is None


def test_ignores_event_with_no_matching_location():
    out = detect_milestone(
        event_status="In Transit",
        event_location="Mumbai, IN",
        event_remark="Hub scan",
        order=NZ_ORDER,
    )
    assert out is None  # still in India, not arrived at NZ destination


def test_country_aliases():
    out = detect_milestone(
        event_status="Arrived",
        event_location="Sydney, AU",
        event_remark="",
        order={"address": {"country": "australia"}, "milestones_notified": []},
    )
    assert out is not None
    assert out["key"] == "arrived_in_destination"
    assert "Australia" in out["title"] or "AU" in out["title"]


def test_returns_none_for_empty_event():
    out = detect_milestone(
        event_status=None,
        event_location=None,
        event_remark=None,
        order=NZ_ORDER,
    )
    assert out is None


def test_returns_none_when_no_address():
    out = detect_milestone(
        event_status="Arrived",
        event_location="Auckland",
        event_remark="",
        order={"milestones_notified": []},  # no address — can't tell destination
    )
    # No address country → can't fire arrival; customs still possible if keywords match
    assert out is None


def test_customs_fires_even_without_country_match():
    out = detect_milestone(
        event_status="Import Clearance",
        event_location="",
        event_remark="import customs",
        order={"address": {"country": "France"}, "milestones_notified": []},
    )
    # France isn't in our supported markets but customs keyword still fires
    assert out is not None
    assert out["key"] == "customs_cleared"
