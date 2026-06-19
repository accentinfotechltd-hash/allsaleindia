"""Unit tests for the Smart ETA computation (Phase 1.5 #2).

The `compute_eta_summary` helper is a pure function — no DB or network — so
these tests cover all branching logic deterministically.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from services.eta import (
    ETA_STATUS_ARRIVING_SOON,
    ETA_STATUS_CANCELLED,
    ETA_STATUS_DELAYED,
    ETA_STATUS_DELIVERED,
    ETA_STATUS_ON_TIME,
    ETA_STATUS_OUT_FOR_DELIVERY,
    ETA_STATUS_PENDING,
    compute_eta_summary,
    parse_delivery_window,
)


def _fixed_today() -> date:
    return date(2026, 6, 19)


# ---------- parse_delivery_window ----------

def test_parse_window_standard():
    s, e = parse_delivery_window("17 Jun – 24 Jun 2026")
    assert s == date(2026, 6, 17)
    assert e == date(2026, 6, 24)


def test_parse_window_hyphen():
    s, e = parse_delivery_window("17 Jun - 24 Jun 2026")
    assert s == date(2026, 6, 17)
    assert e == date(2026, 6, 24)


def test_parse_window_invalid_returns_none():
    s, e = parse_delivery_window("sometime soon")
    assert s is None and e is None


def test_parse_window_empty():
    s, e = parse_delivery_window(None)
    assert s is None and e is None


# ---------- compute_eta_summary ----------

def test_eta_delivered_returns_delivered_label():
    out = compute_eta_summary(
        status="delivered",
        estimated_delivery="17 Jun – 24 Jun 2026",
        delivered_at=datetime(2026, 6, 19, 9, tzinfo=timezone.utc),
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_DELIVERED
    assert out["headline"] == "Delivered"
    assert "19 Jun" in out["sublabel"] or "19 Jun" in out.get("latest_estimate_date", "")
    assert out["arrives_in_days"] == 0


def test_eta_buyer_confirmed_counts_as_delivered():
    out = compute_eta_summary(
        status="shipped",  # carrier never closed
        estimated_delivery="17 Jun – 24 Jun 2026",
        buyer_confirmed_at=datetime(2026, 6, 19, tzinfo=timezone.utc),
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_DELIVERED


def test_eta_out_for_delivery_says_arriving_today():
    out = compute_eta_summary(
        status="out_for_delivery",
        estimated_delivery="17 Jun – 24 Jun 2026",
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_OUT_FOR_DELIVERY
    assert out["headline"] == "Arriving today"
    assert out["arrives_in_days"] == 0


def test_eta_cancelled():
    out = compute_eta_summary(
        status="cancelled",
        estimated_delivery="17 Jun – 24 Jun 2026",
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_CANCELLED
    assert out["arrives_in_days"] is None


def test_eta_on_time_in_transit():
    # today=19 Jun, window ends 24 Jun → 5 days left → "Arriving in 5 days"
    out = compute_eta_summary(
        status="shipped",
        estimated_delivery="17 Jun – 24 Jun 2026",
        shipped_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_ON_TIME
    assert out["headline"] == "Arriving in 5 days"
    assert out["arrives_in_days"] == 5
    assert out["refreshed_from"] == "in_transit"


def test_eta_arriving_soon_two_days():
    out = compute_eta_summary(
        status="shipped",
        estimated_delivery="17 Jun – 21 Jun 2026",  # 2 days left from 19 Jun
        shipped_at=datetime(2026, 6, 18, tzinfo=timezone.utc),
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_ARRIVING_SOON
    assert out["headline"] == "Arriving soon"
    assert out["arrives_in_days"] == 2


def test_eta_delayed_pads_estimate_from_last_scan():
    # window ended 17 Jun, today 19 Jun, last scan 18 Jun
    last_scan = datetime(2026, 6, 18, tzinfo=timezone.utc)
    out = compute_eta_summary(
        status="shipped",
        estimated_delivery="14 Jun – 17 Jun 2026",
        shipped_at=datetime(2026, 6, 10, tzinfo=timezone.utc),
        last_tracking_update=last_scan,
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_DELAYED
    assert out["headline"] == "Delayed"
    assert out["arrives_in_days"] >= 1
    # New estimate is last_scan + 2 days = 20 Jun, > today
    assert out["latest_estimate_date"] == "2026-06-20"
    assert out["refreshed_from"] == "in_transit"


def test_eta_pending_order_keeps_original_promise():
    out = compute_eta_summary(
        status="pending",
        estimated_delivery="17 Jun – 24 Jun 2026",
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_PENDING
    assert out["arrives_in_days"] == 5
    assert "24 Jun" in out["sublabel"]


def test_eta_fallback_when_unparseable_window():
    # No estimated_delivery, only created_at — falls back to +14d
    out = compute_eta_summary(
        status="paid",
        estimated_delivery=None,
        created_at=datetime(2026, 6, 19, tzinfo=timezone.utc),
        today=_fixed_today(),
    )
    # Should not throw, should produce a valid payload
    assert out["status"] in (ETA_STATUS_ON_TIME, ETA_STATUS_PENDING)
    assert out["arrives_in_days"] is not None
    assert out["latest_estimate_date"] is not None


def test_eta_paid_but_not_yet_shipped_is_on_time():
    out = compute_eta_summary(
        status="paid",
        estimated_delivery="17 Jun – 24 Jun 2026",
        shipped_at=None,
        today=_fixed_today(),
    )
    assert out["status"] == ETA_STATUS_ON_TIME
    assert out["arrives_in_days"] == 5
