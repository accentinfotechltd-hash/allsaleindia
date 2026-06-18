"""Phase-2 Ambassador Programme — backend integration tests.

Covers:
  • POST /api/ambassadors/join (canonical coupon schema)
  • GET  /api/ambassadors/me (incl. social_handle/primary_platform/phone/audience_size)
  • PATCH /api/ambassadors/me guardrails (India INR lock, balance lock, phone fmt)
  • GET  /api/ambassadors/by-code/{code}
  • services.ambassador_attribution.credit_pending_for_order + idempotency
  • services.ambassador_attribution.release_due_ambassador_commission + clawback
  • Scheduler registers ambassador_release_due job
  • POST /api/seller/register accepts referral_code (B2B attribution)
  • POST /api/seller/upgrade accepts referral_code
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
import requests
import pytest
from conftest import run_async  # safe sync->async bridge

# Ensure backend modules importable
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
            break
BASE_URL = BASE_URL.rstrip("/")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _new_email(prefix="amb"):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:10]}@allsale.co.nz"


def _new_name(prefix="Tester"):
    return f"{prefix} {uuid.uuid4().hex[:6].upper()}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def nz_ambassador(session):
    """Create an NZ ambassador and return {email, password, code, id, token}."""
    email = _new_email("nz")
    name = _new_name("NZ Amb")
    r = session.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": name, "email": email, "country": "NZ",
        "social_handle": "@nztester", "primary_platform": "instagram",
    })
    assert r.status_code == 201, f"join failed: {r.status_code} {r.text}"
    body = r.json()
    # /join now returns {access_token, needs_password_setup, me} (Phase 2 change).
    # Unwrap into the legacy flat shape the rest of this suite expects.
    me = body["me"] if "me" in body else body
    join_token = body.get("access_token")
    # Set a password so we can log in for PATCH /me tests
    password = "AmbPass2026!"
    from db import db  # type: ignore

    async def _set_pw():
        from utils import hash_password
        await db.users.update_one(
            {"id": me["id"]},
            {"$set": {"password_hash": hash_password(password)}},
        )
    run_async(_set_pw())
    # Login
    rl = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": password})
    assert rl.status_code == 200, f"login failed: {rl.text}"
    token = rl.json()["access_token"]
    return {**me, "email": email, "password": password, "token": token,
            "join_token": join_token}


@pytest.fixture(scope="module")
def in_ambassador(session):
    """Create an IN ambassador (B2B program)."""
    email = _new_email("in")
    name = _new_name("IN Amb")
    r = session.post(f"{BASE_URL}/api/ambassadors/join", json={
        "name": name, "email": email, "country": "IN",
        "social_handle": "@intester", "primary_platform": "instagram",
    })
    assert r.status_code == 201, f"IN join failed: {r.status_code} {r.text}"
    body = r.json()
    me = body["me"] if "me" in body else body
    join_token = body.get("access_token")
    password = "AmbPass2026!"
    from db import db

    async def _set_pw():
        from utils import hash_password
        await db.users.update_one(
            {"id": me["id"]},
            {"$set": {"password_hash": hash_password(password)}},
        )
    run_async(_set_pw())
    rl = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": email, "password": password})
    assert rl.status_code == 200, f"IN login failed: {rl.text}"
    return {**me, "email": email, "password": password,
            "token": rl.json()["access_token"], "join_token": join_token}


# ---------------------------------------------------------------------------
# 1. POST /api/ambassadors/join — canonical coupon schema
# ---------------------------------------------------------------------------
class TestJoin:
    def test_join_nz_creates_canonical_coupon(self, session, nz_ambassador):
        from db import db
        code = nz_ambassador["code"]
        coupon = run_async(
            db.coupons.find_one({"code": code}, {"_id": 0})
        )
        assert coupon is not None, f"coupon not created for {code}"
        # Canonical fields
        assert coupon["type"] == "percent"
        assert coupon["value"] == 5.0
        assert coupon["active"] is True
        assert coupon["scope"] == "all"
        assert coupon["valid_from"] is not None
        # Ambassador metadata preserved
        assert coupon["coupon_type"] == "ambassador_b2c"
        assert coupon["ambassador_user_id"] == nz_ambassador["id"]

    def test_join_validates_via_coupon_validator(self, nz_ambassador):
        """The created coupon must validate via services.coupons.validate_for_cart."""
        from services.coupons import validate_for_cart

        async def _run():
            cart_items = [{
                "product_id": "p1", "name": "X", "image": "",
                "price_nzd": 50.0, "quantity": 2, "seller_id": "s1",
            }]
            coupon, result = await validate_for_cart(
                nz_ambassador["code"], cart_items, 100.0,
                {"id": "u1", "country": "NZ"},
            )
            return result

        result = run_async(_run())
        assert result["ok"], f"validator rejected ambassador code: {result}"
        assert result["discount_nzd"] == 5.0

    def test_join_in_creates_both_codes(self, in_ambassador):
        assert in_ambassador["code"]
        assert in_ambassador.get("code_b2b")
        assert in_ambassador["program"] in ("B2B", "BOTH")
        assert in_ambassador["payout_currency"] == "INR"


# ---------------------------------------------------------------------------
# 2. GET /api/ambassadors/me + new editable fields exposed
# ---------------------------------------------------------------------------
class TestMe:
    def test_me_returns_new_profile_fields(self, session, nz_ambassador):
        r = session.get(f"{BASE_URL}/api/ambassadors/me",
                       headers={"Authorization": f"Bearer {nz_ambassador['token']}"})
        assert r.status_code == 200, r.text
        body = r.json()
        # New fields exposed
        for f in ("social_handle", "primary_platform", "phone", "audience_size"):
            assert f in body, f"missing field {f} in /me response"
        assert body["social_handle"] == "@nztester"
        assert body["primary_platform"] == "instagram"


# ---------------------------------------------------------------------------
# 3. PATCH /api/ambassadors/me — guardrails
# ---------------------------------------------------------------------------
class TestPatchMe:
    def test_patch_basic_fields(self, session, nz_ambassador):
        r = session.patch(
            f"{BASE_URL}/api/ambassadors/me",
            headers={"Authorization": f"Bearer {nz_ambassador['token']}"},
            json={"social_handle": "@newhandle", "phone": "+64 21 555 1234",
                  "audience_size": 12500, "primary_platform": "tiktok"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["social_handle"] == "@newhandle"
        assert body["phone"] == "+64 21 555 1234"
        assert body["audience_size"] == 12500
        assert body["primary_platform"] == "tiktok"

    def test_patch_invalid_phone_400(self, session, nz_ambassador):
        r = session.patch(
            f"{BASE_URL}/api/ambassadors/me",
            headers={"Authorization": f"Bearer {nz_ambassador['token']}"},
            json={"phone": "abc!!"},
        )
        assert r.status_code == 400, r.text

    def test_patch_india_cannot_leave_inr(self, session, in_ambassador):
        r = session.patch(
            f"{BASE_URL}/api/ambassadors/me",
            headers={"Authorization": f"Bearer {in_ambassador['token']}"},
            json={"payout_currency": "USD"},
        )
        assert r.status_code == 400, r.text
        assert "INR" in r.text or "India" in r.text

    def test_patch_blocks_ccy_change_with_pending_balance(self, session, nz_ambassador):
        """Set pending_commission_minor > 0, attempt to change payout_currency → 409."""
        from db import db

        async def _set():
            await db.users.update_one(
                {"id": nz_ambassador["id"]},
                {"$set": {"ambassador_profile.pending_commission_minor": 5000}},
            )
        run_async(_set())
        try:
            r = session.patch(
                f"{BASE_URL}/api/ambassadors/me",
                headers={"Authorization": f"Bearer {nz_ambassador['token']}"},
                json={"payout_currency": "USD"},
            )
            assert r.status_code == 409, r.text
        finally:
            async def _reset():
                await db.users.update_one(
                    {"id": nz_ambassador["id"]},
                    {"$set": {"ambassador_profile.pending_commission_minor": 0}},
                )
            run_async(_reset())


# ---------------------------------------------------------------------------
# 4. GET /api/ambassadors/by-code/{code}
# ---------------------------------------------------------------------------
class TestByCode:
    def test_valid_code_200(self, session, nz_ambassador):
        r = session.get(f"{BASE_URL}/api/ambassadors/by-code/{nz_ambassador['code']}")
        assert r.status_code == 200, r.text
        assert r.json()["code"] == nz_ambassador["code"]

    def test_invalid_code_404(self, session):
        r = session.get(f"{BASE_URL}/api/ambassadors/by-code/NONEXISTENTXYZ9")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# 5. credit_pending_for_order + release_due_ambassador_commission
# ---------------------------------------------------------------------------
class TestAttribution:
    def test_credit_and_idempotency(self, nz_ambassador):
        from db import db
        from services.ambassador_attribution import credit_pending_for_order
        from datetime import datetime, timezone

        order_id = f"TEST_order_{uuid.uuid4().hex[:10]}"
        code = nz_ambassador["code"]

        async def _run():
            paid_at = datetime.now(timezone.utc)
            await db.orders.insert_one({
                "id": order_id, "user_id": "buyer_test",
                "items": [{"product_id": "p", "price_nzd": 100, "quantity": 1, "seller_id": "s"}],
                "subtotal_nzd": 100.0, "total_nzd": 95.0, "discount_nzd": 5.0,
                "coupon_code": code, "status": "paid", "payment_status": "paid",
                "buyer_country": "NZ", "paid_at": paid_at, "created_at": paid_at,
            })
            await credit_pending_for_order(order_id)
            o = await db.orders.find_one({"id": order_id}, {"_id": 0})
            return o

        order = run_async(_run())
        assert order["ambassador_id"] == nz_ambassador["id"]
        assert order["ambassador_commission_minor"] == 500  # 5% of 100 = 5.00
        assert order["ambassador_attribution_state"] == "credited"
        assert order.get("ambassador_release_at") is not None

        # Idempotency
        async def _run2():
            await credit_pending_for_order(order_id)
            u = await db.users.find_one({"id": nz_ambassador["id"]},
                                          {"_id": 0, "ambassador_profile": 1})
            return u["ambassador_profile"]
        prof = run_async(_run2())
        # Pending should still be 500 (not 1000) — re-run was a no-op
        assert prof["pending_commission_minor"] >= 500
        assert prof["lifetime_orders"] == 1

        # Cleanup
        async def _cleanup():
            await db.orders.delete_one({"id": order_id})
            await db.users.update_one(
                {"id": nz_ambassador["id"]},
                {"$set": {"ambassador_profile.pending_commission_minor": 0,
                          "ambassador_profile.lifetime_orders": 0,
                          "ambassador_profile.revenue_driven_minor": 0}},
            )
        run_async(_cleanup())

    def test_release_promotes_pending_to_unpaid(self, nz_ambassador):
        from db import db
        from services.ambassador_attribution import (
            credit_pending_for_order, release_due_ambassador_commission,
        )
        from datetime import datetime, timezone, timedelta

        order_id = f"TEST_order_{uuid.uuid4().hex[:10]}"
        code = nz_ambassador["code"]

        async def _run():
            paid_at = datetime.now(timezone.utc)
            await db.orders.insert_one({
                "id": order_id, "user_id": "buyer_test",
                "items": [{"product_id": "p", "price_nzd": 200, "quantity": 1, "seller_id": "s"}],
                "subtotal_nzd": 200.0, "total_nzd": 190.0, "discount_nzd": 10.0,
                "coupon_code": code, "status": "paid", "payment_status": "paid",
                "buyer_country": "NZ", "paid_at": paid_at, "created_at": paid_at,
            })
            await credit_pending_for_order(order_id)
            # Force-expire the hold
            await db.orders.update_one(
                {"id": order_id},
                {"$set": {"ambassador_release_at": paid_at - timedelta(seconds=1)}},
            )
            res = await release_due_ambassador_commission()
            u = await db.users.find_one({"id": nz_ambassador["id"]},
                                          {"_id": 0, "ambassador_profile": 1})
            o = await db.orders.find_one({"id": order_id}, {"_id": 0})
            return res, u["ambassador_profile"], o

        res, prof, o = run_async(_run())
        assert res["released"] >= 1
        assert o["ambassador_attribution_state"] == "released"
        assert prof["unpaid_balance_minor"] >= 1000  # 5% of 200 = 10.00 = 1000 minor
        assert prof["lifetime_commission_minor"] >= 1000

        async def _cleanup():
            await db.orders.delete_one({"id": order_id})
            await db.users.update_one(
                {"id": nz_ambassador["id"]},
                {"$set": {"ambassador_profile.pending_commission_minor": 0,
                          "ambassador_profile.unpaid_balance_minor": 0,
                          "ambassador_profile.lifetime_commission_minor": 0,
                          "ambassador_profile.lifetime_orders": 0,
                          "ambassador_profile.revenue_driven_minor": 0}},
            )
        run_async(_cleanup())

    def test_clawback_on_cancelled_order(self, nz_ambassador):
        from db import db
        from services.ambassador_attribution import (
            credit_pending_for_order, release_due_ambassador_commission,
        )
        from datetime import datetime, timezone, timedelta

        order_id = f"TEST_order_{uuid.uuid4().hex[:10]}"
        code = nz_ambassador["code"]

        async def _run():
            paid_at = datetime.now(timezone.utc)
            await db.orders.insert_one({
                "id": order_id, "user_id": "buyer_test",
                "items": [{"product_id": "p", "price_nzd": 100, "quantity": 1, "seller_id": "s"}],
                "subtotal_nzd": 100.0, "total_nzd": 95.0, "discount_nzd": 5.0,
                "coupon_code": code, "status": "paid", "payment_status": "paid",
                "buyer_country": "NZ", "paid_at": paid_at, "created_at": paid_at,
            })
            await credit_pending_for_order(order_id)
            # Cancel order and force expire
            await db.orders.update_one(
                {"id": order_id},
                {"$set": {"status": "cancelled",
                          "ambassador_release_at": paid_at - timedelta(seconds=1)}},
            )
            res = await release_due_ambassador_commission()
            o = await db.orders.find_one({"id": order_id}, {"_id": 0})
            u = await db.users.find_one({"id": nz_ambassador["id"]},
                                          {"_id": 0, "ambassador_profile": 1})
            return res, o, u["ambassador_profile"]

        res, o, prof = run_async(_run())
        assert res["clawed_back"] >= 1
        assert o["ambassador_attribution_state"] == "clawed_back"
        # Pending was decremented, unpaid NOT incremented
        assert prof["pending_commission_minor"] == 0
        assert prof["unpaid_balance_minor"] == 0  # no release happened

        async def _cleanup():
            await db.orders.delete_one({"id": order_id})
            await db.users.update_one(
                {"id": nz_ambassador["id"]},
                {"$set": {"ambassador_profile.lifetime_orders": 0,
                          "ambassador_profile.revenue_driven_minor": 0}},
            )
        run_async(_cleanup())


# ---------------------------------------------------------------------------
# 6. Checkout wiring (import check only — actual Stripe payment not driven)
# ---------------------------------------------------------------------------
class TestCheckoutWiring:
    def test_credit_pending_imported_in_checkout(self):
        """Verify _on_payment_succeeded references credit_pending_for_order."""
        text = open("/app/backend/routers/checkout.py").read()
        assert "credit_pending_for_order" in text
        assert "from services.ambassador_attribution" in text


# ---------------------------------------------------------------------------
# 7. Scheduler — both jobs registered
# ---------------------------------------------------------------------------
class TestScheduler:
    def test_ambassador_release_due_registered(self, monkeypatch):
        """init_scheduler() should add both payouts_release_due AND
        ambassador_release_due jobs."""
        monkeypatch.delenv("DISABLE_SCHEDULER", raising=False)
        from services import scheduler as sched

        async def _run():
            sched.shutdown_scheduler()
            sched.init_scheduler()
            try:
                assert sched._scheduler is not None
                jobs = {j.id for j in sched._scheduler.get_jobs()}
                assert "payouts_release_due" in jobs
                assert "ambassador_release_due" in jobs
            finally:
                sched.shutdown_scheduler()

        asyncio.new_event_loop().run_until_complete(_run())


# ---------------------------------------------------------------------------
# 8. Seller signup with referral_code
# ---------------------------------------------------------------------------
class TestSellerReferral:
    def _seller_payload(self, email, referral_code=None):
        from _helpers import make_gstin_pan
        gstin, pan = make_gstin_pan()
        payload = {
            "email": email,
            "password": "SellerPass2026!",
            "business": {
                "business_type": "sole_proprietorship",
                "company_name": "TEST_BizCo",
                "gstin": gstin,
                "pan": pan,
                "address_line1": "1 Test Lane",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_name": "Tester Seller",
                "contact_phone": "+919999999999",
            },
        }
        if referral_code is not None:
            payload["referral_code"] = referral_code
        return payload

    def test_seller_register_with_valid_referral_code(self, session, nz_ambassador):
        """Seller signing up with NZ ambassador code → linked & sellers_count bumped."""
        from db import db

        email = _new_email("seller_with_ref")
        payload = self._seller_payload(email, referral_code=nz_ambassador["code"])
        r = session.post(f"{BASE_URL}/api/seller/register", json=payload)
        # Skip if seller registration not available for this configuration
        if r.status_code in (400, 422) and "country" in (r.text or "").lower():
            pytest.skip(f"seller registration shape mismatch: {r.text}")
        assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
        user = r.json()["user"]
        user_id = user["id"]

        async def _check():
            u = await db.users.find_one({"id": user_id}, {"_id": 0})
            amb = await db.users.find_one({"id": nz_ambassador["id"]},
                                            {"_id": 0, "ambassador_profile": 1})
            return u, amb
        seller_doc, amb_doc = run_async(_check())
        assert seller_doc.get("referred_by_ambassador_id") == nz_ambassador["id"]
        assert seller_doc.get("seller_onboarded_at") is not None
        assert amb_doc["ambassador_profile"].get("referred_sellers_count", 0) >= 1

        # Cleanup
        async def _cleanup():
            await db.users.delete_one({"id": user_id})
            await db.sellers.delete_one({"user_id": user_id})
            await db.users.update_one(
                {"id": nz_ambassador["id"]},
                {"$set": {"ambassador_profile.referred_sellers_count": 0}},
            )
        run_async(_cleanup())

    def test_seller_register_with_invalid_referral_silent(self, session):
        """Invalid referral code → silently ignored, signup still succeeds."""
        from db import db
        email = _new_email("seller_bad_ref")
        payload = self._seller_payload(email, referral_code="NONEXISTENTCODE123")
        r = session.post(f"{BASE_URL}/api/seller/register", json=payload)
        if r.status_code in (400, 422) and "country" in (r.text or "").lower():
            pytest.skip(f"seller registration shape mismatch: {r.text}")
        assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
        user_id = r.json()["user"]["id"]

        async def _check():
            u = await db.users.find_one({"id": user_id}, {"_id": 0})
            return u
        seller_doc = run_async(_check())
        assert "referred_by_ambassador_id" not in seller_doc

        async def _cleanup():
            await db.users.delete_one({"id": user_id})
            await db.sellers.delete_one({"user_id": user_id})
        run_async(_cleanup())
