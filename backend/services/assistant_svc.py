"""AI Shopping Assistant — backend service.

Strategy: one Claude Sonnet 4.5 call per user message. Before calling
Claude we pre-fetch up to 6 catalog matches from a keyword search; we
feed those plus the last 6 conversation turns plus a tight system prompt
to Claude. Claude writes a natural reply; the backend returns the reply
plus the pre-fetched products so the UI can render product cards inline.

This single-shot approach keeps latency under ~2s and avoids the cost
and complexity of tool-calling for the MVP.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from typing import Optional

from db import db

log = logging.getLogger("allsale.assistant")

MAX_HISTORY_TURNS = 6
MAX_PRODUCTS_INLINE = 6

# Words too common to be useful as catalog filters.
_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "i", "you", "me", "we",
    "my", "your", "this", "that", "and", "or", "of", "for", "to", "in",
    "on", "show", "find", "want", "need", "looking", "buy", "get", "best",
    "good", "great", "any", "some", "all", "have", "do", "does", "did",
    "where", "what", "when", "who", "why", "how", "can", "could", "should",
    "would", "please", "thanks", "hello", "hi", "hey", "yes", "no", "ok",
    "okay", "with", "without", "under", "over", "below", "above", "than",
    "less", "more", "cheap", "expensive", "price", "from", "by",
}

_PRICE_RE = re.compile(r"(?:under|below|less than|<)\s*\$?\s*(\d+)", re.I)
_PRICE_OVER_RE = re.compile(r"(?:over|above|more than|>)\s*\$?\s*(\d+)", re.I)


def _extract_keywords(message: str) -> list[str]:
    """Pull catalog-searchable words out of free text."""
    tokens = re.findall(r"[a-zA-Z]{3,}", message.lower())
    return [t for t in tokens if t not in _STOPWORDS][:6]


def _extract_price_filter(message: str) -> tuple[Optional[float], Optional[float]]:
    """Return (min_price, max_price) in NZD if mentioned, else (None, None)."""
    max_price = None
    min_price = None
    m = _PRICE_RE.search(message)
    if m:
        max_price = float(m.group(1))
    m = _PRICE_OVER_RE.search(message)
    if m:
        min_price = float(m.group(1))
    return min_price, max_price


async def search_catalog(
    message: str, *, limit: int = MAX_PRODUCTS_INLINE
) -> list[dict]:
    """Best-effort product search for the assistant's grounding context."""
    kw = _extract_keywords(message)
    min_p, max_p = _extract_price_filter(message)
    if not kw and min_p is None and max_p is None:
        return []

    # Match name/category/brand by case-insensitive substring on any keyword.
    or_clauses: list[dict] = []
    for w in kw:
        or_clauses.extend(
            [
                {"name": {"$regex": w, "$options": "i"}},
                {"category": {"$regex": w, "$options": "i"}},
                {"subcategory": {"$regex": w, "$options": "i"}},
                {"brand": {"$regex": w, "$options": "i"}},
                {"description": {"$regex": w, "$options": "i"}},
            ]
        )

    q: dict = {"in_stock": True, "stock_count": {"$gt": 0}}
    if or_clauses:
        q["$or"] = or_clauses
    if max_p is not None:
        q["price_nzd"] = {"$lte": max_p}
    if min_p is not None:
        q.setdefault("price_nzd", {})["$gte"] = min_p

    cur = (
        db.products.find(
            q,
            {
                "_id": 0, "id": 1, "name": 1, "image": 1, "price_nzd": 1,
                "category": 1, "subcategory": 1, "rating": 1,
                "reviews_count": 1, "seller_name": 1,
            },
        )
        .sort([("rating", -1), ("reviews_count", -1)])
        .limit(limit)
    )
    return [p async for p in cur]


def _system_prompt(catalog_context: list[dict]) -> str:
    """Build the system prompt for Claude with catalog grounding."""
    base = (
        "You are Allsale Assistant — a friendly, concise shopping helper for "
        "Allsale, a cross-border e-commerce marketplace where buyers in New "
        "Zealand, Australia, the US, UK and Canada shop from sellers in India. "
        "Prices on Allsale are shown in NZD. Be warm but efficient: 1–3 short "
        "sentences typically. If the buyer asks for products and we provide "
        "matching items in CATALOG_MATCHES, mention them by name and let the "
        "buyer know they're shown below the message. Never make up product IDs "
        "or prices. If you don't have a match, say so honestly and suggest a "
        "better keyword. For order/return/refund queries say you'll route them "
        "to support if you can't help directly."
    )
    if not catalog_context:
        return base + "\n\nCATALOG_MATCHES: (none for this turn)"

    lines = []
    for p in catalog_context:
        lines.append(
            f"- {p['name']} | ${float(p.get('price_nzd', 0)):.2f} NZD | "
            f"category={p.get('category')} | rating={p.get('rating')}/5"
        )
    return (
        base
        + "\n\nCATALOG_MATCHES (use these to ground your reply):\n"
        + "\n".join(lines)
    )


async def call_claude(
    *,
    system_prompt: str,
    history: list[dict],
    user_message: str,
    timeout_s: float = 20.0,
) -> str:
    """Single-shot Claude Sonnet 4.5 call. Returns assistant text."""
    api_key = os.getenv("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")

    # Build a context-rich user prompt that includes the history because
    # the lightweight chat client doesn't expose multi-turn messages directly.
    convo_text = ""
    for turn in history[-MAX_HISTORY_TURNS:]:
        role = "Buyer" if turn["role"] == "user" else "Assistant"
        convo_text += f"{role}: {turn['content']}\n"
    convo_text += f"Buyer: {user_message}\nAssistant:"

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=api_key,
        session_id=f"asst-{uuid.uuid4().hex[:8]}",
        system_message=system_prompt,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    msg = UserMessage(text=convo_text)
    try:
        resp = await asyncio.wait_for(chat.send_message(msg), timeout=timeout_s)
    except asyncio.TimeoutError as exc:
        raise RuntimeError("Assistant timed out") from exc

    if hasattr(resp, "text"):
        return str(resp.text).strip()
    return str(resp).strip()


async def run_turn(
    *,
    session_id: str,
    user_id: Optional[str],
    user_message: str,
) -> dict:
    """Run a single chat turn: search catalog, call Claude, persist, return."""
    products = await search_catalog(user_message)
    system_prompt = _system_prompt(products)

    # Load history for this session
    sess = await db.assistant_sessions.find_one(
        {"id": session_id}, {"_id": 0, "messages": 1}
    )
    history = (sess or {}).get("messages", [])

    try:
        reply = await call_claude(
            system_prompt=system_prompt,
            history=history,
            user_message=user_message,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Claude call failed: %s", exc)
        reply = (
            "Sorry, I'm having trouble reaching my brain right now. "
            "Try again in a moment, or browse the home screen for ideas."
        )

    # Persist new turn
    now = __import__("datetime").datetime.utcnow()
    new_user_turn = {"role": "user", "content": user_message}
    new_asst_turn = {
        "role": "assistant",
        "content": reply,
        "product_ids": [p["id"] for p in products],
    }
    await db.assistant_sessions.update_one(
        {"id": session_id},
        {
            "$setOnInsert": {"id": session_id, "user_id": user_id, "created_at": now},
            "$set": {"updated_at": now},
            "$push": {"messages": {"$each": [new_user_turn, new_asst_turn]}},
        },
        upsert=True,
    )

    return {"reply": reply, "products": products}


__all__ = ["run_turn", "search_catalog"]
