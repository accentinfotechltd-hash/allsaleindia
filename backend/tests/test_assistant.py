"""Tests for the AI Shopping Assistant.

We hit the running uvicorn process (same convention as other test files
in this repo) and monkey-patch ``services.assistant_svc.call_claude`` so
we don't burn LLM credits in CI. Catalog search + session persistence
go through real Mongo.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import requests


BASE = "http://localhost:8001/api"


# ---------------------------------------------------------------------------
# Pure-function helpers (no HTTP required)
# ---------------------------------------------------------------------------
def test_keyword_extraction_filters_stopwords():
    from services.assistant_svc import _extract_keywords

    assert _extract_keywords("show me a great cheap saree under 50") == [
        "saree"
    ]
    assert "and" not in _extract_keywords("kurta and pants for men")
    assert sorted(_extract_keywords("kurta saree dress")) == sorted(
        ["kurta", "saree", "dress"]
    )


def test_price_filter_extraction():
    from services.assistant_svc import _extract_price_filter

    assert _extract_price_filter("under $50")[1] == 50.0
    assert _extract_price_filter("less than 30")[1] == 30.0
    assert _extract_price_filter("over $100")[0] == 100.0
    assert _extract_price_filter("hello world") == (None, None)


def test_system_prompt_renders_catalog():
    from services.assistant_svc import _system_prompt

    p = _system_prompt(
        [
            {
                "id": "p1",
                "name": "Cool Saree",
                "price_nzd": 29.99,
                "category": "Ethnic Fashion",
                "rating": 4.5,
            }
        ]
    )
    assert "Cool Saree" in p
    assert "29.99" in p
    assert "$" in p


def test_system_prompt_handles_empty_catalog():
    from services.assistant_svc import _system_prompt

    p = _system_prompt([])
    assert "none for this turn" in p


# ---------------------------------------------------------------------------
# HTTP endpoint tests (hit running uvicorn at :8001)
# ---------------------------------------------------------------------------
def test_chat_validation_rejects_empty_message():
    r = requests.post(f"{BASE}/assistant/chat", json={"message": ""}, timeout=5)
    assert r.status_code == 422


def test_chat_validation_rejects_overlong_message():
    r = requests.post(
        f"{BASE}/assistant/chat", json={"message": "x" * 900}, timeout=5
    )
    assert r.status_code == 422


def test_chat_minimal_anonymous_call_returns_session_and_reply():
    """End-to-end smoke against live uvicorn. Hits Claude for real but
    keeps the prompt small so cost is negligible. Skipped if no key.
    """
    import os

    if not os.getenv("EMERGENT_LLM_KEY"):
        pytest.skip("EMERGENT_LLM_KEY not configured")

    r = requests.post(
        f"{BASE}/assistant/chat",
        json={"message": "hi"},
        timeout=30,
    )
    assert r.status_code == 200
    d = r.json()
    assert d["session_id"].startswith("asst_")
    assert isinstance(d["reply"], str) and len(d["reply"]) > 0
    assert isinstance(d["products"], list)


def test_session_not_found_404():
    r = requests.get(f"{BASE}/assistant/sessions/asst_doesnotexist123", timeout=5)
    assert r.status_code == 404


def test_session_replay_returns_messages():
    """Create a session via chat, then replay it."""
    import os

    if not os.getenv("EMERGENT_LLM_KEY"):
        pytest.skip("EMERGENT_LLM_KEY not configured")

    r = requests.post(
        f"{BASE}/assistant/chat", json={"message": "test"}, timeout=30
    )
    assert r.status_code == 200
    sid = r.json()["session_id"]

    r = requests.get(f"{BASE}/assistant/sessions/{sid}", timeout=5)
    assert r.status_code == 200
    d = r.json()
    assert d["session_id"] == sid
    assert len(d["messages"]) == 2
    assert d["messages"][0]["role"] == "user"
    assert d["messages"][1]["role"] == "assistant"
