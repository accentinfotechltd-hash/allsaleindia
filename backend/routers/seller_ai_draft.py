"""Seller AI product-draft endpoint.

POST /api/seller/products/ai-draft
  body: { images: [base64,…], seller_hint?: str, sku?: str }
  returns: { draft: ProductDraft, model: str, took_ms: int }

The endpoint is verified-seller-gated (same as the catalog importer).
Each call costs ~$0.005 worth of Emergent LLM credits — cheap enough that
we don't need to rate-limit aggressively; we just cap input size.
"""
from __future__ import annotations

import logging
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_current_user
from services.ai_product_extractor import extract_product_draft

logger = logging.getLogger("allsale.ai_draft")
router = APIRouter(prefix="/seller/products", tags=["seller-ai-draft"])

MAX_BASE64_BYTES_PER_IMAGE = 6 * 1024 * 1024  # 6 MB per image (~4.5 MB binary)
MAX_TOTAL_BYTES = 15 * 1024 * 1024


class AIDraftRequest(BaseModel):
    images: List[str] = Field(..., min_length=1, max_length=3, description="Base64-encoded JPEG/PNG/WEBP images OR public https:// URLs")
    mode: str = Field(default="photo", pattern="^(photo|screenshot)$", description="'photo' for product photos · 'screenshot' for screenshots of an existing marketplace listing")
    seller_hint: Optional[str] = Field(default=None, max_length=200, description="Optional one-line context like 'banarasi silk saree, my own SKU 1234'")
    sku: Optional[str] = Field(default=None, max_length=64)


class AIDraftResponse(BaseModel):
    draft: dict
    model: str
    took_ms: int


async def _require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") not in ("approved", "auto_verified"):
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


@router.post("/ai-draft", response_model=AIDraftResponse)
async def ai_draft_from_photos(
    body: AIDraftRequest,
    seller=Depends(_require_verified_seller),
):
    """Turn 1-3 product photos into a complete listing draft via Claude vision."""
    # Defensive size checks — base64 expansion is 4/3 of the binary size.
    total = 0
    for img in body.images:
        n = len(img.encode("utf-8"))
        if n > MAX_BASE64_BYTES_PER_IMAGE:
            raise HTTPException(
                status_code=413,
                detail=f"Image too large ({n} base64 bytes). Compress to under {MAX_BASE64_BYTES_PER_IMAGE}.",
            )
        total += n
    if total > MAX_TOTAL_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"All images together exceed {MAX_TOTAL_BYTES} base64 bytes.",
        )

    started = time.time()
    try:
        draft = await extract_product_draft(
            body.images,
            mode=body.mode,
            seller_hint=body.seller_hint,
            session_id=f"draft_{seller['id']}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("ai_draft_from_photos failed: %s", exc)
        raise HTTPException(status_code=502, detail="AI service failed — try again in a moment.") from exc

    # Carry the seller's chosen SKU into the draft if they passed one.
    if body.sku:
        draft["sku"] = body.sku.strip()[:64]

    return AIDraftResponse(
        draft=draft,
        model="claude-sonnet-4-5-20250929",
        took_ms=int((time.time() - started) * 1000),
    )
