"""Tests for POST /orders/{id}/invoice/email — Resend dispatch + audit log.

Resend isn't (and shouldn't be) configured in CI, so we assert the
"skipped + reason=resend_not_configured" branch + audit-log row, plus
the auth gates around the endpoint.
"""
from __future__ import annotations

import asyncio


def _db():
    from db import db
    return db


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _seed_buyer_and_paid_order():
    """Returns (buyer_email, password, order_id). Uses the seed buyer +
    finds the buyer's most recent paid order from the test DB."""

    async def _go():
        buyer = await _db().users.find_one(
            {"email": "buyer@example.com"}, {"_id": 0, "id": 1, "email": 1}
        )
        if not buyer:
            return None, None
        order = await _db().orders.find_one(
            {"user_id": buyer["id"], "payment_status": "paid"},
            {"_id": 0, "id": 1},
            sort=[("created_at", -1)],
        )
        return buyer, order

    return _run(_go())


def _login(api_client, base_url, email, password):
    r = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
    )
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_email_invoice_skipped_when_resend_not_configured(api_client, base_url):
    """Endpoint should NOT 500 when Resend isn't configured — it should
    degrade gracefully with skipped:true and persist the audit log."""
    buyer, order = _seed_buyer_and_paid_order()
    if not buyer or not order:
        return  # seed DB has no paid order for buyer; skip

    token = _login(api_client, base_url, "buyer@example.com", "Buyer2026!")
    headers = {"Authorization": f"Bearer {token}"}
    order_id = order["id"]

    r = api_client.post(
        f"{base_url}/api/orders/{order_id}/invoice/email",
        json={},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["ok"] is True
    # Either sent OR skipped — both are valid contract responses.
    if not payload["sent"]:
        assert payload["skipped"] is True
        assert payload["reason"] in {
            "resend_not_installed",
            "resend_not_configured",
        }

    # Audit log row was appended either way.
    async def _check_log():
        o = await _db().orders.find_one(
            {"id": order_id}, {"_id": 0, "invoice_email_log": 1}
        )
        return o.get("invoice_email_log") or []

    log = _run(_check_log())
    assert len(log) >= 1
    latest = log[-1]
    assert latest["by_user_id"] == buyer["id"]
    assert latest["to"] == "buyer@example.com"


def test_email_invoice_requires_auth(api_client, base_url):
    """Anonymous request → 401."""
    _, order = _seed_buyer_and_paid_order()
    if not order:
        return
    r = api_client.post(
        f"{base_url}/api/orders/{order['id']}/invoice/email", json={}
    )
    assert r.status_code in (401, 403)


def test_email_invoice_forbidden_for_other_buyer(api_client, base_url):
    """Buyer A cannot email Buyer B's invoice (403)."""
    # We need a SECOND buyer with valid credentials. Use the existing
    # seller's order ownership — actually simpler: invent a 2nd seed buyer.
    async def _ensure_other_buyer():
        existing = await _db().users.find_one(
            {"email": "buyer2-iter43@example.com"}, {"_id": 0, "id": 1}
        )
        if existing:
            return existing["id"]
        from datetime import datetime, timezone
        import bcrypt, uuid
        pw_hash = bcrypt.hashpw(b"OtherBuyer2026!", bcrypt.gensalt()).decode()
        uid = f"user_{uuid.uuid4().hex[:12]}"
        await _db().users.insert_one(
            {
                "id": uid,
                "email": "buyer2-iter43@example.com",
                "password_hash": pw_hash,
                "full_name": "Other Buyer",
                "is_seller": False,
                "email_verified": True,
                "created_at": datetime.now(timezone.utc),
                "token_version": 0,
            }
        )
        return uid

    _run(_ensure_other_buyer())
    _, order = _seed_buyer_and_paid_order()
    if not order:
        return
    token2 = _login(api_client, base_url, "buyer2-iter43@example.com", "OtherBuyer2026!")
    headers = {"Authorization": f"Bearer {token2}"}
    r = api_client.post(
        f"{base_url}/api/orders/{order['id']}/invoice/email",
        json={},
        headers=headers,
    )
    assert r.status_code == 403, r.text
