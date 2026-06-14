"""Seller support ticket tests."""
import os
import requests

from test_seller import BASE_URL, _valid_business

ADMIN_SECRET = "allsale-admin-dev-secret"
ADMIN_HEADERS = {"x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json"}


def _seller_token():
    payload = {
        "email": f"supp_{os.urandom(4).hex()}@example.com",
        "password": "Allsale1!safe",
        "business": _valid_business(),
    }
    r = requests.post(f"{BASE_URL}/api/seller/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


class TestSellerSupport:
    def test_create_and_list_ticket(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Payout missing",
                "description": "My payout from last week hasn't arrived in my bank account.",
                "category": "payments",
                "priority": "high",
            },
            headers=_h(token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["status"] == "open"
        assert t["priority"] == "high"
        assert t["sla_due_at"]

        # Listing should return our ticket
        r2 = requests.get(
            f"{BASE_URL}/api/support/tickets", headers=_h(token), timeout=10
        )
        assert r2.status_code == 200
        items = r2.json()
        assert any(it["id"] == t["id"] for it in items)

    def test_get_detail_includes_first_message(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Login broken",
                "description": "Cannot login to my seller dashboard since today.",
                "category": "account",
            },
            headers=_h(token),
            timeout=15,
        )
        tid = r.json()["id"]
        r2 = requests.get(
            f"{BASE_URL}/api/support/tickets/{tid}", headers=_h(token), timeout=10
        )
        assert r2.status_code == 200
        d = r2.json()
        assert d["ticket"]["id"] == tid
        assert len(d["messages"]) == 1
        assert "Cannot login" in d["messages"][0]["body"]

    def test_reply_and_admin_thread(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Order issue",
                "description": "Buyer says order didn't ship.",
                "category": "orders",
                "priority": "medium",
            },
            headers=_h(token),
            timeout=15,
        )
        tid = r.json()["id"]

        # Seller adds a reply
        r2 = requests.post(
            f"{BASE_URL}/api/support/tickets/{tid}/reply",
            json={"body": "Adding tracking link details here."},
            headers=_h(token),
            timeout=10,
        )
        assert r2.status_code == 200

        # Admin replies via x-admin-secret
        r3 = requests.post(
            f"{BASE_URL}/api/admin/tickets/{tid}/reply",
            json={"body": "Thanks — we'll investigate today."},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r3.status_code == 200, r3.text

        # Seller now sees admin reply and status flipped to awaiting_reply
        r4 = requests.get(
            f"{BASE_URL}/api/support/tickets/{tid}", headers=_h(token), timeout=10
        )
        assert r4.status_code == 200
        d = r4.json()
        assert d["ticket"]["status"] == "awaiting_reply"
        assert any(m["sender_role"] == "admin" for m in d["messages"])

    def test_internal_note_hidden_from_seller(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Refund stuck",
                "description": "Customer waiting for refund processing details.",
                "category": "payments",
            },
            headers=_h(token),
            timeout=15,
        )
        tid = r.json()["id"]
        # Admin internal note
        rn = requests.post(
            f"{BASE_URL}/api/admin/tickets/{tid}/note",
            json={"body": "INTERNAL: check stripe dashboard for ch_xxx"},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert rn.status_code == 200
        # Seller fetches detail — should NOT include the note
        rd = requests.get(
            f"{BASE_URL}/api/support/tickets/{tid}", headers=_h(token), timeout=10
        )
        assert rd.status_code == 200
        bodies = [m["body"] for m in rd.json()["messages"]]
        assert not any("INTERNAL:" in b for b in bodies)

    def test_status_transitions_and_csat(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Documents",
                "description": "Need help re-uploading KYC docs.",
                "category": "kyc",
            },
            headers=_h(token),
            timeout=15,
        )
        tid = r.json()["id"]

        # Cannot rate while still open
        r_bad = requests.post(
            f"{BASE_URL}/api/support/tickets/{tid}/rate",
            json={"rating": 5},
            headers=_h(token),
            timeout=10,
        )
        assert r_bad.status_code == 400

        # Admin resolves
        r_res = requests.patch(
            f"{BASE_URL}/api/admin/tickets/{tid}/status",
            json={"status": "resolved"},
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r_res.status_code == 200
        assert r_res.json()["status"] == "resolved"
        assert r_res.json()["resolved_at"]

        # Now seller can rate
        r_rate = requests.post(
            f"{BASE_URL}/api/support/tickets/{tid}/rate",
            json={"rating": 5, "comment": "Quick fix, thanks!"},
            headers=_h(token),
            timeout=10,
        )
        assert r_rate.status_code == 200, r_rate.text
        assert r_rate.json()["csat_rating"] == 5

        # Cannot rate twice
        r_dup = requests.post(
            f"{BASE_URL}/api/support/tickets/{tid}/rate",
            json={"rating": 4},
            headers=_h(token),
            timeout=10,
        )
        assert r_dup.status_code == 400

    def test_other_seller_cannot_access(self):
        a = _seller_token()
        b = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Private issue A",
                "description": "Some private payments concern.",
                "category": "payments",
            },
            headers=_h(a),
            timeout=15,
        )
        tid = r.json()["id"]
        r2 = requests.get(
            f"{BASE_URL}/api/support/tickets/{tid}", headers=_h(b), timeout=10
        )
        assert r2.status_code == 404

    def test_admin_list_and_filter(self):
        token = _seller_token()
        # Make 2 tickets with different priorities
        requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Urgent fire 1",
                "description": "Something urgent please help.",
                "category": "orders",
                "priority": "urgent",
            },
            headers=_h(token),
            timeout=15,
        )
        requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Minor query",
                "description": "Just a small clarification on shipping.",
                "category": "shipping",
                "priority": "low",
            },
            headers=_h(token),
            timeout=15,
        )
        r = requests.get(
            f"{BASE_URL}/api/admin/tickets?priority=urgent",
            headers=ADMIN_HEADERS,
            timeout=10,
        )
        assert r.status_code == 200
        assert all(t["priority"] == "urgent" for t in r.json())

    def test_invalid_category_rejected(self):
        token = _seller_token()
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "abcd",
                "description": "Lorem ipsum dolor sit amet.",
                "category": "bogus_category",
            },
            headers=_h(token),
            timeout=10,
        )
        assert r.status_code in (400, 422)

    def test_unauth_create_rejected(self):
        r = requests.post(
            f"{BASE_URL}/api/support/tickets",
            json={
                "subject": "Test",
                "description": "An anonymous report something something.",
                "category": "other",
            },
            timeout=10,
        )
        assert r.status_code == 401
