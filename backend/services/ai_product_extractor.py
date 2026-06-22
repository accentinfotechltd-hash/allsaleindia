"""AI product-draft extractor — turn 1–3 product photos into a complete
listing draft (title, description, category, suggested price, materials,
colors, sizes, bullets) so casual sellers can list a SKU in seconds.

Implementation:
  • Uses Claude Sonnet 4-5 (claude-sonnet-4-5-20250929) via the Emergent
    Universal LLM Key + ``emergentintegrations.llm.chat.LlmChat``.
  • Forces structured JSON output via a strict prompt + JSON schema fence;
    we parse the response defensively and never crash the route.
  • Each base64 image is decoded → re-saved as JPEG (max 1024×1024, q=82)
    to keep token cost bounded.

Cost ballpark: ~$0.005 per listing on Sonnet 4-5 with 3 photos @ 1024px.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from PIL import Image

load_dotenv()
logger = logging.getLogger("allsale.ai_product_extractor")

MAX_IMAGE_SIDE = 1024
JPEG_QUALITY = 82
DEFAULT_MODEL = ("anthropic", "claude-sonnet-4-5-20250929")


SYSTEM_PROMPT = """You are an Indian e-commerce listing-copy expert who writes for the Allsale
marketplace selling India-made goods to shoppers in New Zealand, Australia,
the UK and the US. You will be shown 1-3 photos of a single product.

Your job: extract a complete listing draft as STRICT JSON conforming to
the schema below. Do NOT invent details you can't see in the image (e.g.
brand names, certifications, weight). When uncertain, use null or an
empty array — never hallucinate.

Return exactly ONE JSON object, no markdown, no commentary, no code fence.

Schema:
{
  "name": str (60-90 chars; product type + key descriptor + colour + material),
  "description": str (120-260 words; 1st paragraph: what it is; 2nd: details / use cases),
  "category": str (one of: "Ethnic Fashion", "Women's Clothing", "Men's Clothing",
                  "Beauty & Health", "Jewellery", "Accessories", "Home & Kitchen",
                  "Food & Groceries", "Electronics", "Shoes", "Toys & Kids", "Other"),
  "subcategory": str | null (e.g. "Sarees", "Kurtis", "Hair Care", "Earrings"),
  "bullets": [str] (3-5 short benefit-led bullets, max 80 chars each),
  "colors": [str] (visible colours; empty if none),
  "sizes": [str] (visible size labels; empty if none — e.g. ["S","M","L","XL"]),
  "materials": [str] (visible/likely materials — e.g. ["Cotton", "Silk"]),
  "suggested_price_inr": int (your best wholesale-friendly INR retail price),
  "confidence": "high" | "medium" | "low",
  "notes_for_seller": str (1-2 sentences for the seller about any fields they should review)
}"""


def _compress_image(b64: str) -> Optional[str]:
    """Decode a base64 image, downscale to MAX_IMAGE_SIDE, re-encode as JPEG."""
    try:
        # Strip data URL prefix if present
        if "," in b64 and b64.lstrip().startswith("data:"):
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        # Always animated → first frame
        if getattr(img, "n_frames", 1) > 1:
            img.seek(0)
        img = img.convert("RGB")
        if max(img.size) > MAX_IMAGE_SIDE:
            img.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as exc:  # noqa: BLE001
        logger.warning("image compression failed: %s", exc)
        return None


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Best-effort JSON extractor that survives accidental markdown fencing."""
    if not text:
        return None
    text = text.strip()
    # Strip ```json … ``` if Claude adds it anyway.
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    # Otherwise extract the first {…} balanced block.
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def _normalize_draft(d: Dict[str, Any]) -> Dict[str, Any]:
    """Defensive trimming + type coercion so the route always returns a
    consistently-shaped object, even if the LLM goes off-script."""
    def s(v: Any, lim: int) -> str:
        return (str(v) if v is not None else "")[:lim].strip()

    def lst(v: Any, item_lim: int = 80) -> List[str]:
        if not v:
            return []
        if isinstance(v, str):
            v = [v]
        out: List[str] = []
        for x in v:
            if x is None:
                continue
            t = str(x).strip()[:item_lim]
            if t:
                out.append(t)
        return out[:6]

    return {
        "name": s(d.get("name") or d.get("title"), 120) or "Untitled product",
        "description": s(d.get("description"), 2000),
        "category": s(d.get("category"), 60),
        "subcategory": s(d.get("subcategory"), 60) or None,
        "bullets": lst(d.get("bullets")),
        "colors": lst(d.get("colors"), 30),
        "sizes": lst(d.get("sizes"), 12),
        "materials": lst(d.get("materials"), 40),
        "suggested_price_inr": int(d["suggested_price_inr"]) if str(d.get("suggested_price_inr") or "").strip().isdigit() else None,
        "confidence": (s(d.get("confidence"), 12).lower() or "medium"),
        "notes_for_seller": s(d.get("notes_for_seller"), 400),
    }


async def extract_product_draft(
    images_base64: List[str],
    *,
    seller_hint: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a single Sonnet 4-5 vision call → return a draft dict.

    Raises ``ValueError`` if the LLM key is missing, no images decoded
    successfully, or the response can't be parsed as JSON.
    """
    if not images_base64:
        raise ValueError("At least one image is required")
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise ValueError("EMERGENT_LLM_KEY not configured")

    # Lazy import so unit tests that don't exercise the AI path don't pull in
    # the emergentintegrations dependency at import time.
    from emergentintegrations.llm.chat import (  # type: ignore
        ImageContent,
        LlmChat,
        UserMessage,
    )

    image_contents: List[Any] = []
    for raw_b64 in images_base64[:3]:
        compressed = _compress_image(raw_b64)
        if compressed:
            image_contents.append(ImageContent(image_base64=compressed))
    if not image_contents:
        raise ValueError("None of the uploaded images could be decoded")

    chat = LlmChat(
        api_key=api_key,
        session_id=session_id or f"draft_{uuid.uuid4().hex[:10]}",
        system_message=SYSTEM_PROMPT,
    ).with_model(*DEFAULT_MODEL)

    user_text = (
        "Extract the listing JSON now. "
        "Remember: STRICT JSON, no markdown."
    )
    if seller_hint:
        user_text = f"Seller hint: '{seller_hint.strip()[:200]}'. " + user_text

    msg = UserMessage(text=user_text, file_contents=image_contents)

    # Non-streaming send for a single structured call — streaming buys us
    # nothing here and complicates JSON parsing.
    response_text = await chat.send_message(msg)

    parsed = _extract_json(response_text or "")
    if not parsed:
        logger.warning(
            "ai_product_extractor: couldn't parse JSON from LLM (head=%s)",
            (response_text or "")[:200],
        )
        raise ValueError("AI couldn't produce a valid listing — try clearer photos")

    return _normalize_draft(parsed)
