"""Tests for the in-app notification preferences feature.

Covers:
  - GET /api/me/notification-prefs — defaults when no doc, role filtering
    (buyer vs seller), schema shape.
  - PUT /api/me/notification-prefs — upserts partial state, ignores
    unknown keys, returns merged echo, idempotency, 400 on empty body.
  - Auth (401 without token).
  - Mute logic: when a category is disabled, ``create_notification``
    SKIPS the insert. When enabled (default), the insert happens. Admin
    recipients are never muted.
  - Type → category mapping (`category_for_type`) sanity check.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from tests._helpers import make_gstin_pan
from tests.conftest import run_async


MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def _run(coro):
    return run_async(coro)


async def _db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli, cli[DB_NAME]


def _cleanup_user(user_id: str):
    async def go():
        cli, db = await _db()
        await db.notification_prefs.delete_many({"user_id": user_id})
        await db.notifications.delete_many({"user_id": user_id})
        cli.close()

    _run(go())


# ---------------------------------------------------------------------------
# Pure unit: type → category map
# ---------------------------------------------------------------------------
class TestTypeMap:
    def test_known_types_resolve_to_categories(self):
        from services.notification_prefs import category_for_type

        assert category_for_type("order_placed") == "orders"
        assert category_for_type("order_cancelled") == "orders"
        assert (
            category_for_type("shipment_milestone_customs_cleared")
            == "orders"
        )
        assert category_for_type("return_requested") == "returns"
        assert category_for_type("return_approved") == "returns"
        assert category_for_type("new_review") == "reviews"
        assert category_for_type("review_reply") == "reviews"
        assert category_for_type("support_reply") == "support"
        assert category_for_type("support_ticket") == "support"
        assert category_for_type("back_in_stock") == "back_in_stock"
        assert category_for_type("new_order") == "seller_alerts"
        assert category_for_type("proof_of_delivery_uploaded") == "seller_alerts"
        assert category_for_type("financing_application") == "seller_alerts"
        assert category_for_type("promo_summer_sale") == "promos"
        assert category_for_type("flash_sale_launched") == "promos"

    def test_unknown_type_returns_none(self):
        from services.notification_prefs import category_for_type

        assert category_for_type("totally_made_up_signal") is None


# ---------------------------------------------------------------------------
# GET /me/notification-prefs
# ---------------------------------------------------------------------------
class TestGetPrefs:
    def test_requires_auth(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/me/notification-prefs")
        assert r.status_code in (401, 403)

    def test_buyer_defaults(self, api_client, base_url, auth_headers):
        r = api_client.get(
            f"{base_url}/api/me/notification-prefs", headers=auth_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["role"] == "buyer"
        keys = {c["key"] for c in body["categories"]}
        # Buyers see these — but NOT seller_alerts
        assert "orders" in keys
        assert "returns" in keys
        assert "promos" in keys
        assert "back_in_stock" in keys
        assert "seller_alerts" not in keys
        for c in body["categories"]:
            assert c["enabled"] is True
            assert isinstance(c["label"], str)
            assert isinstance(c["description"], str)

    def test_seller_sees_seller_alerts(self, api_client, base_url):
        # Register a seller
        email = f"prefs_seller_{uuid.uuid4().hex[:10]}@allsale.co.nz"
        gstin, pan = make_gstin_pan()
        r = api_client.post(
            f"{base_url}/api/seller/register",
            json={
                "email": email,
                "password": "Test1234!",
                "business": {
                    "business_type": "sole_proprietorship",
                    "company_name": "Prefs Co",
                    "gstin": gstin,
                    "pan": pan,
                    "address_line1": "1 MG Road",
                    "city": "Mumbai",
                    "state": "Maharashtra",
                    "pincode": "400001",
                    "contact_name": "Tester",
                    "contact_phone": "+919999999999",
                },
            },
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        user_id = r.json()["user"]["id"]
        headers = {"Authorization": f"Bearer {token}"}

        try:
            g = api_client.get(
                f"{base_url}/api/me/notification-prefs", headers=headers
            )
            assert g.status_code == 200
            body = g.json()
            assert body["role"] == "seller"
            keys = {c["key"] for c in body["categories"]}
            # Seller sees seller_alerts plus the shared rows
            assert "seller_alerts" in keys
            assert "reviews" in keys  # shared
        finally:
            _cleanup_user(user_id)


# ---------------------------------------------------------------------------
# PUT /me/notification-prefs
# ---------------------------------------------------------------------------
class TestPutPrefs:
    def test_empty_body_rejected(self, api_client, base_url, auth_headers):
        r = api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {}},
            headers=auth_headers,
        )
        assert r.status_code == 400

    def test_unknown_keys_ignored(self, api_client, base_url, auth_headers):
        r = api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"made_up_category": False}},
            headers=auth_headers,
        )
        assert r.status_code == 400  # no VALID keys left → 400

    def test_partial_update_persists(self, api_client, base_url, auth_headers):
        # Mute promos
        r = api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"promos": False}},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["prefs"]["promos"] is False
        # Re-read; promos should still be False, everything else True
        g = api_client.get(
            f"{base_url}/api/me/notification-prefs", headers=auth_headers
        )
        cats = {c["key"]: c["enabled"] for c in g.json()["categories"]}
        assert cats["promos"] is False
        assert cats["orders"] is True

        # Restore for hygiene
        api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"promos": True}},
            headers=auth_headers,
        )

    def test_toggle_back_on(self, api_client, base_url, auth_headers):
        api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"orders": False}},
            headers=auth_headers,
        )
        r = api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"orders": True}},
            headers=auth_headers,
        )
        assert r.json()["prefs"]["orders"] is True


# ---------------------------------------------------------------------------
# create_notification respects mute
# ---------------------------------------------------------------------------
class TestMuteEnforcement:
    def test_muted_category_skips_insert(
        self, api_client, base_url, auth_headers
    ):
        # Get our user id
        me = api_client.get(
            f"{base_url}/api/auth/me", headers=auth_headers
        ).json()
        uid = me["id"]

        # Mute "promos"
        api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"promos": False}},
            headers=auth_headers,
        )

        # Drive create_notification directly
        from services.notifications import create_notification

        async def go():
            res = await create_notification(
                user_id=uid,
                role="buyer",
                n_type="promo_summer_sale",
                title="Summer sale",
                body="50% off everything",
            )
            return res

        out = _run(go())
        assert out == {}  # short-circuited

        # And the bell list should NOT contain this title
        notifs = api_client.get(
            f"{base_url}/api/notifications", headers=auth_headers
        ).json()
        assert not any(n["title"] == "Summer sale" for n in notifs)

        # Restore
        api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"promos": True}},
            headers=auth_headers,
        )

    def test_enabled_category_inserts(
        self, api_client, base_url, auth_headers
    ):
        me = api_client.get(
            f"{base_url}/api/auth/me", headers=auth_headers
        ).json()
        uid = me["id"]
        # Ensure orders is on
        api_client.put(
            f"{base_url}/api/me/notification-prefs",
            json={"prefs": {"orders": True}},
            headers=auth_headers,
        )
        from services.notifications import create_notification

        unique_title = f"TestOrder-{uuid.uuid4().hex[:8]}"

        async def go():
            return await create_notification(
                user_id=uid,
                role="buyer",
                n_type="order_placed",
                title=unique_title,
                body="Confirmed",
            )

        out = _run(go())
        assert out.get("id"), "expected insert to return a doc"
        notifs = api_client.get(
            f"{base_url}/api/notifications", headers=auth_headers
        ).json()
        assert any(n["title"] == unique_title for n in notifs)

    def test_admin_never_muted(self):
        """Admin recipients ignore mute prefs entirely (operational signal)."""
        from services.notifications import create_notification

        unique_title = f"AdminTest-{uuid.uuid4().hex[:8]}"

        async def go():
            return await create_notification(
                user_id="admin",
                role="admin",
                n_type="promo_test",
                title=unique_title,
                body="Admin pings always land",
            )

        out = _run(go())
        assert out.get("id")

        # Cleanup
        async def cleanup():
            cli, db = await _db()
            await db.notifications.delete_many({"title": unique_title})
            cli.close()

        _run(cleanup())

    def test_unknown_type_always_delivered(
        self, api_client, base_url, auth_headers
    ):
        """A brand-new n_type we haven't categorised yet should be
        delivered (better to over-notify than to silently drop)."""
        me = api_client.get(
            f"{base_url}/api/auth/me", headers=auth_headers
        ).json()
        uid = me["id"]
        from services.notifications import create_notification

        unique_title = f"NoveltyType-{uuid.uuid4().hex[:8]}"

        async def go():
            return await create_notification(
                user_id=uid,
                role="buyer",
                n_type="brand_new_signal_2026",
                title=unique_title,
                body="hi",
            )

        out = _run(go())
        assert out.get("id")
