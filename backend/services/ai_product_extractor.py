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


SYSTEM_PROMPT_PHOTO = """You are an Indian e-commerce listing-copy expert who writes for the Allsale
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
  "suggested_hs_code": str | null (Indian customs HS code — 6 digits, e.g. "5407.20" for synthetic sarees, "6204.40" for women's dresses, "7117.19" for imitation jewellery, "0904.21" for chillies. Null if uncertain.),
  "is_screenshot": bool (TRUE if the photo is OBVIOUSLY a screenshot/screen-capture of another marketplace listing — e.g. you see Amazon/Flipkart/Myntra/Meesho UI elements, browser chrome, ratings stars, "Add to Cart" button, price tag overlays. FALSE for clean product shots even if shot on mannequin or with watermark. When in doubt, FALSE.),
  "confidence": "high" | "medium" | "low",
  "notes_for_seller": str (1-2 sentences for the seller about any fields they should review)
}"""


SYSTEM_PROMPT_SCREENSHOT = """You are reading a SCREENSHOT of an existing product listing the seller has
on another marketplace (Amazon, Flipkart, Myntra, Meesho, Etsy, Shopify,
their own website, etc.). The seller wants to re-list the same item on
Allsale, an Indian-export marketplace serving shoppers in New Zealand,
Australia, the UK and the US.

Treat this as OCR + understanding: read the title, price, bullet points,
description, specifications, colour/size options, and category breadcrumb
that are VISIBLE on the page in the screenshot. Pull the prices the seller
is charging on the original marketplace (any currency — convert to INR if
the source currency is INR or display the INR equivalent if you can infer
it).

Critical: pretend the screenshot is the ground truth — do NOT invent fields
that aren't on the page. If you can't see something, return null / empty.

Return exactly ONE JSON object, no markdown, no commentary, no code fence.

Schema is the SAME as the photo extraction mode:
{
  "name": str (use the exact product title from the page, lightly cleaned),
  "description": str (combine the on-page description + bullet points into 120-260 words),
  "category": str (one of: "Ethnic Fashion", "Women's Clothing", "Men's Clothing",
                  "Beauty & Health", "Jewellery", "Accessories", "Home & Kitchen",
                  "Food & Groceries", "Electronics", "Shoes", "Toys & Kids", "Other"),
  "subcategory": str | null,
  "bullets": [str] (use the on-page bullets if present; otherwise generate 3-5),
  "colors": [str],
  "sizes": [str],
  "materials": [str] (extract from product specifications panel),
  "suggested_price_inr": int (page price converted to INR — use ~83 INR/USD, ~51 INR/NZD, ~110 INR/GBP, ~55 INR/AUD as approximations),
  "suggested_hs_code": str | null,
  "confidence": "high" | "medium" | "low",
  "notes_for_seller": str (1-2 sentences flagging any fields you couldn't read clearly)
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


async def _to_base64(raw: str) -> Optional[str]:
    """Accept a raw base64 string, a data: URI, or an http(s) URL — return
    the raw base64 payload. URL fetches are bounded by content-length to
    keep us from buffering hostile/huge files."""
    if not raw:
        return None
    s = raw.strip()
    # 1) data URI
    if s.startswith("data:"):
        idx = s.find(",")
        return s[idx + 1 :] if idx > 0 else None
    # 2) http(s) URL — fetch and base64-encode
    if s.startswith("http://") or s.startswith("https://"):
        try:
            import httpx  # noqa: WPS433 — local import keeps optional dep light

            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                r = await client.get(s)
                if r.status_code != 200:
                    logger.warning("image fetch failed status=%s url=%s", r.status_code, s[:120])
                    return None
                # Defensive size cap (raw bytes) to avoid memory bombs.
                if len(r.content) > 6 * 1024 * 1024:
                    logger.warning("image fetch too large (%d bytes) url=%s", len(r.content), s[:120])
                    return None
                return base64.b64encode(r.content).decode("ascii")
        except Exception as exc:  # noqa: BLE001
            logger.warning("image fetch threw: %s", exc)
            return None
    # 3) Already-raw base64 (no scheme prefix)
    return s


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
        "suggested_hs_code": s(d.get("suggested_hs_code"), 20) or None,
        "is_screenshot": bool(d.get("is_screenshot")),
        "confidence": (s(d.get("confidence"), 12).lower() or "medium"),
        "notes_for_seller": s(d.get("notes_for_seller"), 400),
    }


async def extract_product_draft(
    images: List[str],
    *,
    mode: str = "photo",
    seller_hint: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a single Sonnet 4-5 vision call → return a draft dict.

    ``images`` may be a mix of:
      • raw base64 strings (e.g. directly from expo-image-picker)
      • data:image/...;base64,... data URIs
      • https://... CDN URLs (we'll fetch them server-side)

    Raises ``ValueError`` if the LLM key is missing, no images decoded
    successfully, or the response can't be parsed as JSON.
    """
    if not images:
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
    for raw in images[:3]:
        b64 = await _to_base64(raw)
        if not b64:
            continue
        compressed = _compress_image(b64)
        if compressed:
            image_contents.append(ImageContent(image_base64=compressed))
    if not image_contents:
        raise ValueError("None of the uploaded images could be decoded")

    chat = LlmChat(
        api_key=api_key,
        session_id=session_id or f"draft_{uuid.uuid4().hex[:10]}",
        system_message=SYSTEM_PROMPT_SCREENSHOT if mode == "screenshot" else SYSTEM_PROMPT_PHOTO,
    ).with_model(*DEFAULT_MODEL)

    if mode == "screenshot":
        user_text = (
            "Extract the listing JSON from this marketplace screenshot. "
            "Use the on-page title, description, price (convert to INR), and bullet points. "
            "STRICT JSON, no markdown."
        )
    else:
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
