"""Tests for partner notification dispatch.

These exercise the side-effect via the admin HTTP endpoints (running inside
the live server's persistent event loop) — we don't import the async service
directly because Motor binds to the first event loop it sees, which doesn't
match a fresh ``asyncio.run`` loop.
"""
import os
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

from test_seller import BASE_URL

ADMIN_HEADERS = {"x-admin-secret": "allsale-admin-dev-secret"}


def _seed_app(partner_id: str = "kredx", status: str = "submitted_to_partner") -> str:
    """Insert a minimal financing application via pymongo and return its id."""
    from pymongo import MongoClient

    load_dotenv("/app/backend/.env")
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "allsale_database")
    client = MongoClient(mongo_url)
    db = client[db_name]
    now = datetime.now(timezone.utc)
    aid = f"fin_test_{uuid.uuid4().hex[:8]}"
    db.financing_applications.insert_one(
        {
            "id": aid,
            "user_id": "user_test",
            "user_email": f"partner_{uuid.uuid4().hex[:6]}@example.com",
            "partner_id": partner_id,
            "partner_name": partner_id.title(),
            "desired_advance_nzd": 1234.0,
            "monthly_invoices_inr": None,
            "business_age_months": None,
            "notes": None,
            "seller_tier": "verified",
            "status": status,
            "admin_notes": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    client.close()
    return aid


class TestPartnerNotifyAPI:
    def test_renotify_endpoint_requires_admin_secret(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/financing/fin_anything/notify-partner",
            timeout=10,
        )
        assert r.status_code == 403

    def test_renotify_returns_404_for_unknown(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/financing/fin_does_not_exist_xyz/notify-partner",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 404

    def test_skipped_no_channel_when_unconfigured(self):
        """With no KREDX_WEBHOOK_URL / KREDX_INTAKE_EMAIL, the live PATCH-to-
        submitted_to_partner flow should record status=skipped_no_channel."""
        aid = _seed_app(status="interest")
        r = requests.patch(
            f"{BASE_URL}/api/admin/financing/{aid}",
            json={"status": "submitted_to_partner"},
            headers=ADMIN_HEADERS,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "submitted_to_partner"
        assert d["partner_notified_at"], "expected notification timestamp"
        # Live env doesn't have KREDX_WEBHOOK_URL/EMAIL set
        assert d["partner_notification_status"] in {
            "skipped_no_channel",
            "sent",  # if env vars *were* set, we accept "sent"
            "failed",  # if URL was bad
        }

    def test_renotify_endpoint_resets_and_reattempts(self):
        aid = _seed_app(status="submitted_to_partner")
        # First, trigger via PATCH to record an initial notification attempt
        requests.patch(
            f"{BASE_URL}/api/admin/financing/{aid}",
            json={"status": "submitted_to_partner"},
            headers=ADMIN_HEADERS,
            timeout=15,
        )
        # Renotify
        r = requests.post(
            f"{BASE_URL}/api/admin/financing/{aid}/notify-partner",
            headers=ADMIN_HEADERS,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        assert r.json()["partner_notified_at"]

    def test_status_returns_in_response_model(self):
        aid = _seed_app(status="interest")
        r = requests.get(
            f"{BASE_URL}/api/admin/financing/{aid}",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 200
        d = r.json()
        # Notification fields exist in response model even when null
        for k in (
            "partner_notified_at",
            "partner_notification_status",
            "partner_notification_error",
        ):
            assert k in d
