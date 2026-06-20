"""Tier-2 AI enrichment for imported catalog rows.

We use **Claude Sonnet 4.5** via the ``emergentintegrations`` universal
key for two batch text tasks during commit:

  - ``translate_to_english(text)`` — Hindi/Hinglish/regional → natural English.
    Returns the original text unchanged if it's already English.
  - ``summarize_to_bullets(text, n=5)`` — Long Amazon-style description →
    short, scannable bullet points suited for our PDP.

These run server-side during the ``/commit`` request only when the seller
flags ``enrich_with_ai=True``. Failures degrade gracefully — a 5xx from
Claude returns the original text and adds a warning to the response.

The Emergent LLM key is loaded from ``EMERGENT_LLM_KEY`` env (already in
``backend/.env``). No streaming needed — this is a batch task.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Optional

log = logging.getLogger("allsale.importer.enrich")

_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
_HINGLISH_HINTS = {
    "hai", "hain", "karein", "banaya", "kya", "acha", "sundar", "asli",
    "khaas", "behatreen", "naya", "kapde", "sasta", "ghar", "safed",
}


def _needs_translation(text: str) -> bool:
    if not text or not text.strip():
        return False
    if _DEVANAGARI_RE.search(text):
        return True
    tokens = re.findall(r"[a-zA-Z]+", text.lower())
    if not tokens:
        return False
    hits = sum(1 for t in tokens if t in _HINGLISH_HINTS)
    return hits / max(1, len(tokens)) > 0.05  # >5% Hinglish tokens


def _get_key() -> str:
    k = os.getenv("EMERGENT_LLM_KEY", "").strip()
    if not k:
        raise RuntimeError(
            "EMERGENT_LLM_KEY not set — cannot run AI enrichment."
        )
    return k


async def _send(prompt: str, system: str, *, max_tokens: int = 1024) -> str:
    """One-shot non-streaming Claude Sonnet 4.5 call. Returns text or raises."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(
        api_key=_get_key(),
        session_id=f"imp-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    msg = UserMessage(text=prompt)
    # ``send_message`` is the non-streaming, batch-friendly entrypoint.
    resp = await chat.send_message(msg)
    # Library returns either a plain string or an object with ``.text``.
    if hasattr(resp, "text"):
        return str(resp.text)
    return str(resp)


async def translate_to_english(text: str) -> str:
    """Translate Hindi/Hinglish/regional to natural English. No-op for English."""
    if not text or not _needs_translation(text):
        return text or ""
    try:
        out = await _send(
            prompt=(
                f"Translate the following Indian product description into clear, "
                f"natural English suited for an e-commerce listing. Preserve all "
                f"product facts (sizes, ingredients, brands). Reply with ONLY the "
                f"translated English text — no commentary, no quotes, no preface.\n\n"
                f"---\n{text}\n---"
            ),
            system=(
                "You are a precise product-listing translator for an Indian "
                "cross-border e-commerce app called Allsale. Translate from "
                "Hindi/Hinglish/regional Indian languages to English. Never "
                "invent facts or add disclaimers."
            ),
            max_tokens=900,
        )
        return out.strip().strip('"')
    except Exception as exc:  # noqa: BLE001
        log.warning("translate_to_english failed, falling back to original: %s", exc)
        return text


async def summarize_to_bullets(text: str, *, n: int = 5) -> list[str]:
    """Condense a long description into ``n`` short bullet points.

    Returns ``[]`` on failure rather than raising — caller can fall back
    to whatever bullets the source file already had.
    """
    if not text or len(text.strip()) < 40:
        return []
    try:
        out = await _send(
            prompt=(
                f"Condense this product description into exactly {n} short, "
                f"benefit-led bullet points (each ≤ 90 characters). Reply with "
                f"ONLY a JSON object of the form: "
                f'{{"bullets": ["point 1", "point 2", ...]}} — no preface.\n\n'
                f"---\n{text}\n---"
            ),
            system=(
                "You write concise, accurate product bullet points for an "
                "e-commerce app. Always reply with valid JSON only."
            ),
            max_tokens=600,
        )
        # Extract JSON even if model wrapped it in ``` fences.
        m = re.search(r"\{.*\}", out, re.DOTALL)
        if not m:
            return []
        data = json.loads(m.group(0))
        bullets = data.get("bullets", [])
        if not isinstance(bullets, list):
            return []
        return [str(b).strip() for b in bullets if str(b).strip()][:n]
    except Exception as exc:  # noqa: BLE001
        log.warning("summarize_to_bullets failed: %s", exc)
        return []


async def enrich_product(
    *, name: str, description: str, bullets: list[str]
) -> tuple[str, list[str], list[str]]:
    """Run translation + summarization in parallel. Returns
    ``(new_description, new_bullets, notes)`` where ``notes`` lists any
    enrichment actions taken (for the commit response).
    """
    notes: list[str] = []
    new_desc = description
    new_bullets = bullets

    # Translate description if needed
    if _needs_translation(description):
        translated = await translate_to_english(description)
        if translated and translated != description:
            new_desc = translated
            notes.append("translated_description")

    # Summarise into 5 bullets if seller didn't already provide them
    if len(bullets) < 3 and len(new_desc) > 80:
        ai_bullets = await summarize_to_bullets(new_desc, n=5)
        if ai_bullets:
            new_bullets = ai_bullets
            notes.append("generated_bullets")

    return new_desc, new_bullets, notes
