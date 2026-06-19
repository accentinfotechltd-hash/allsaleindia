"""Smart ETA computation for buyer order tracking.

Takes the static `estimated_delivery` window (e.g. "17 Jun – 24 Jun 2026") plus
the latest known shipment scan to derive a fresh ETA that reflects reality:

- "Arriving today" when the parcel is out-for-delivery
- "Arriving in N days" when on schedule (relative to the window upper bound)
- "Arriving soon · Jun 20" when ≤ 2 days remain
- "Delayed · new estimate: Jun 22" when the original window has lapsed but
  parcel is still in transit (we pad +2 days from the latest scan as a heuristic)
- "Delivered Jun 19" when buyer-confirmed or carrier-confirmed

The output is a JSON-serialisable dict consumed by `OrderTracking.eta_summary`.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

# Heuristic padding applied to "delayed" orders so we don't keep promising the
# carrier's original SLA after it lapses.
_DELAYED_PAD_DAYS = 2

# Status keys returned by the API — used by the mobile ribbon colour mapping.
ETA_STATUS_DELIVERED = "delivered"
ETA_STATUS_OUT_FOR_DELIVERY = "out_for_delivery"
ETA_STATUS_ARRIVING_SOON = "arriving_soon"
ETA_STATUS_ON_TIME = "on_time"
ETA_STATUS_DELAYED = "delayed"
ETA_STATUS_PENDING = "pending"  # order not yet paid/dispatched
ETA_STATUS_CANCELLED = "cancelled"


def parse_delivery_window(s: Optional[str]) -> tuple[Optional[date], Optional[date]]:
    """Parse strings like '17 Jun – 24 Jun 2026'.

    Returns `(start_date, end_date)` or `(None, None)` if unparseable. Falls
    back gracefully so callers can pivot to a default window.
    """
    if not s:
        return None, None
    raw = str(s).replace("\u2013", "-").replace("\u2014", "-").strip()  # en/em dashes → '-'
    if "-" not in raw:
        return None, None
    left, _, right = raw.partition("-")
    left, right = left.strip(), right.strip()
    # Right side carries the year — left side usually does not.
    parts = right.split()
    if len(parts) < 3:
        return None, None
    try:
        end_date = datetime.strptime(right, "%d %b %Y").date()
    except ValueError:
        return None, None
    # Left side: prepend the year from the right side if not present.
    try:
        start_date = datetime.strptime(left, "%d %b %Y").date()
    except ValueError:
        try:
            start_date = datetime.strptime(f"{left} {parts[-1]}", "%d %b %Y").date()
        except ValueError:
            start_date = end_date
    return start_date, end_date


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _format_date_short(d: date) -> str:
    return d.strftime("%-d %b") if hasattr(d, "strftime") else str(d)


def compute_eta_summary(
    *,
    status: str,
    estimated_delivery: Optional[str],
    delivered_at: Optional[datetime] = None,
    buyer_confirmed_at: Optional[datetime] = None,
    last_tracking_update: Optional[datetime] = None,
    out_for_delivery_at: Optional[datetime] = None,
    shipped_at: Optional[datetime] = None,
    created_at: Optional[datetime] = None,
    today: Optional[date] = None,
) -> dict:
    """Build the ETA ribbon payload for a single order.

    The function is *pure* — no I/O — so it can be unit-tested without a DB.
    """
    today = today or _today_utc()
    start_date, end_date = parse_delivery_window(estimated_delivery)
    # Fallbacks if the order doesn't carry a parseable window (legacy data).
    if not end_date:
        base = (created_at or datetime.now(timezone.utc)).date()
        end_date = base + timedelta(days=14)
        start_date = base + timedelta(days=7)

    label_status = ETA_STATUS_ON_TIME  # default
    headline = ""
    sublabel = ""
    arrives_in_days: Optional[int] = None
    latest_estimate_date: date = end_date
    refreshed_from = "initial"

    if status in {"cancelled", "refunded"}:
        return {
            "status": ETA_STATUS_CANCELLED,
            "headline": "Order cancelled",
            "sublabel": "Refund details on this page",
            "arrives_in_days": None,
            "latest_estimate_date": None,
            "original_window": estimated_delivery or None,
            "refreshed_from": "cancelled",
        }

    # Delivered (carrier or buyer-confirmed)
    if status == "delivered" or buyer_confirmed_at or delivered_at:
        delivered = delivered_at or buyer_confirmed_at
        delivered_d = delivered.date() if delivered else today
        return {
            "status": ETA_STATUS_DELIVERED,
            "headline": "Delivered",
            "sublabel": f"on {_format_date_short(delivered_d)}",
            "arrives_in_days": 0,
            "latest_estimate_date": delivered_d.isoformat(),
            "original_window": estimated_delivery or None,
            "refreshed_from": "delivered",
        }

    # Out for delivery — narrow ETA window to "today"
    if status == "out_for_delivery" or out_for_delivery_at:
        return {
            "status": ETA_STATUS_OUT_FOR_DELIVERY,
            "headline": "Arriving today",
            "sublabel": "Out for delivery",
            "arrives_in_days": 0,
            "latest_estimate_date": today.isoformat(),
            "original_window": estimated_delivery or None,
            "refreshed_from": "out_for_delivery",
        }

    # Not yet shipped — keep the original promise
    if status in {"pending", "paid"} and not shipped_at:
        days_left = max(0, (end_date - today).days)
        if days_left == 0:
            sublabel = "Pending dispatch"
        return {
            "status": ETA_STATUS_PENDING if status == "pending" else ETA_STATUS_ON_TIME,
            "headline": f"Arriving in {days_left} day{'s' if days_left != 1 else ''}"
            if days_left > 0
            else "Arriving soon",
            "sublabel": (sublabel or f"by {_format_date_short(end_date)}")
            if days_left
            else f"by {_format_date_short(end_date)}",
            "arrives_in_days": days_left,
            "latest_estimate_date": end_date.isoformat(),
            "original_window": estimated_delivery or None,
            "refreshed_from": refreshed_from,
        }

    # In transit (shipped, awaiting OFD) — compute against current date
    days_left = (end_date - today).days

    if days_left < 0:
        # Window has lapsed but parcel is still moving — derive a fresh ETA from
        # the latest carrier scan, padded by the delay heuristic.
        anchor = (last_tracking_update or shipped_at or datetime.now(timezone.utc)).date()
        latest_estimate_date = max(today + timedelta(days=1), anchor + timedelta(days=_DELAYED_PAD_DAYS))
        arrives_in_days = max(1, (latest_estimate_date - today).days)
        label_status = ETA_STATUS_DELAYED
        headline = "Delayed"
        sublabel = f"New estimate: {_format_date_short(latest_estimate_date)}"
        refreshed_from = "in_transit"
    elif days_left <= 2:
        latest_estimate_date = end_date
        arrives_in_days = days_left
        label_status = ETA_STATUS_ARRIVING_SOON
        headline = "Arriving soon"
        sublabel = f"by {_format_date_short(end_date)}"
        refreshed_from = "in_transit"
    else:
        latest_estimate_date = end_date
        arrives_in_days = days_left
        label_status = ETA_STATUS_ON_TIME
        headline = f"Arriving in {days_left} days"
        sublabel = f"by {_format_date_short(end_date)}"
        refreshed_from = "in_transit"

    return {
        "status": label_status,
        "headline": headline,
        "sublabel": sublabel,
        "arrives_in_days": arrives_in_days,
        "latest_estimate_date": latest_estimate_date.isoformat() if latest_estimate_date else None,
        "original_window": estimated_delivery or None,
        "refreshed_from": refreshed_from,
    }
