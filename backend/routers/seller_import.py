"""Seller catalog import — Amazon / Flipkart / generic CSV.

Two-step flow:
  1. ``POST /api/seller/import/preview`` (multipart) — parses the uploaded
     file, returns a per-row preview ({ready, needs_attention, issues}).
     Caches the parsed catalog in Mongo under a short-lived ``preview_token``
     so we don't re-parse on commit.
  2. ``POST /api/seller/import/commit`` (JSON) — seller submits the chosen
     rows + optional global margin %. Creates/updates products in
     ``db.products``. If ``enrich_with_ai=True``, runs Claude Sonnet 4.5
     translation + bullet summarization (Tier 2).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from config import INR_PER_NZD
from db import db
from deps import get_current_user
from services.catalog_importer import detect_format, parse
from services.catalog_importer.enrichment import enrich_product
from services.catalog_importer.models import (
    ImportCommitRequest,
    ImportCommitResponse,
    ParsedCatalog,
)
from utils import now_utc

logger = logging.getLogger("allsale.import")
router = APIRouter(prefix="/seller/import", tags=["seller-import"])


MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB
PREVIEW_TTL_HOURS = 2


async def _require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") not in (
        "approved",
        "auto_verified",
    ):
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


@router.post("/preview")
async def preview_import(
    file: UploadFile = File(...),
    source_hint: Optional[str] = Form(None),
    seller=Depends(_require_verified_seller),
):
    """Upload an Amazon/Flipkart/CSV file → return mapped preview rows.

    Doesn't write anything to ``products``. Caches the parsed catalog in
    ``catalog_import_previews`` keyed by ``preview_token`` so the client
    can commit later without re-uploading.
    """
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(file_bytes)} bytes). Max {MAX_FILE_BYTES}.",
        )
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    fmt = source_hint or detect_format(file.filename or "", file_bytes)
    if fmt == "unknown":
        raise HTTPException(
            status_code=400,
            detail=(
                "Couldn't detect file format. Supported: Amazon (.xlsx/.xlsm), "
                "Flipkart (.xls/.xlsx), Myntra (.xlsx), Meesho (.csv/.xlsx), "
                "or a generic CSV with name/price/image columns."
            ),
        )

    try:
        parsed: ParsedCatalog = parse(file_bytes, fmt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Catalog import parse failed: %s", exc)
        raise HTTPException(
            status_code=500, detail=f"Parser error: {exc}"
        ) from exc

    # Persist for later commit
    preview_token = f"imp_{uuid.uuid4().hex[:16]}"
    expires_at = datetime.now(timezone.utc) + timedelta(hours=PREVIEW_TTL_HOURS)
    await db.catalog_import_previews.insert_one(
        {
            "preview_token": preview_token,
            "seller_id": seller["id"],
            "source": parsed.source,
            "filename": file.filename,
            "rows": [r.model_dump() for r in parsed.rows],
            "warnings": parsed.warnings,
            "sheet_name": parsed.sheet_name,
            "fx_inr_to_nzd": parsed.fx_inr_to_nzd,
            "created_at": now_utc(),
            "expires_at": expires_at,
        }
    )

    return {
        "preview_token": preview_token,
        "source": parsed.source,
        "sheet_name": parsed.sheet_name,
        "filename": file.filename,
        "total_rows": parsed.total_rows,
        "ready_count": parsed.ready_count,
        "needs_attention_count": parsed.needs_attention_count,
        "fx_inr_to_nzd": parsed.fx_inr_to_nzd or INR_PER_NZD,
        "warnings": parsed.warnings,
        "rows": [r.model_dump() for r in parsed.rows],
        "expires_at": expires_at.isoformat(),
    }


@router.post("/commit", response_model=ImportCommitResponse)
async def commit_import(
    body: ImportCommitRequest,
    seller=Depends(_require_verified_seller),
):
    """Persist the seller-approved rows as real products.

    Behaviour:
      - If a product with the same ``sku`` already exists for this seller,
        we update it (price + stock + image refresh).
      - Otherwise we insert a new product with a fresh ``id``.
      - ``margin_pct`` uplifts ``price_nzd`` by N% across all rows.
      - ``enrich_with_ai`` runs Claude translation + bullet summarization
        on rows whose description looks Hindi/Hinglish or is unbulleted.
    """
    doc = await db.catalog_import_previews.find_one(
        {"preview_token": body.preview_token, "seller_id": seller["id"]},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Preview not found or expired")

    indexed = {r["row_index"]: r for r in doc.get("rows", [])}
    margin = max(0.0, min(float(body.margin_pct or 0.0), 200.0))
    fx = float(doc.get("fx_inr_to_nzd") or INR_PER_NZD)
    enrich = bool(body.enrich_with_ai)

    created = 0
    updated = 0
    skipped = 0
    failed: list[dict] = []

    seller_name = seller.get("full_name") or seller.get("email", "").split("@")[0]
    seller_city = None  # populated from seller profile if available
    try:
        s_doc = await db.sellers.find_one(
            {"user_id": seller["id"]}, {"_id": 0, "city": 1}
        )
        if s_doc:
            seller_city = s_doc.get("city")
    except Exception:  # noqa: BLE001
        pass

    for choice in body.rows:
        if not choice.publish:
            skipped += 1
            continue
        src = indexed.get(choice.row_index)
        if not src:
            failed.append(
                {"row_index": choice.row_index, "error": "row not in preview"}
            )
            continue

        p = src["product"]
        # Apply seller overrides if provided
        if choice.overrides:
            ov = choice.overrides.model_dump(exclude_unset=True)
            p = {**p, **ov}

        # Compute the final NZD price (margin uplift)
        price_nzd = p.get("price_nzd")
        if price_nzd is None and p.get("price_inr") is not None:
            price_nzd = round(p["price_inr"] / fx, 2)
        if price_nzd is None:
            failed.append(
                {"row_index": choice.row_index, "error": "missing price_nzd"}
            )
            continue
        if margin:
            price_nzd = round(price_nzd * (1.0 + margin / 100.0), 2)

        name = p.get("name") or "Untitled"
        image = p.get("image") or (
            p["images"][0] if p.get("images") else None
        )
        if not image:
            failed.append({"row_index": choice.row_index, "error": "missing image"})
            continue
        if not p.get("category"):
            failed.append(
                {"row_index": choice.row_index, "error": "missing category"}
            )
            continue

        # ----- Tier-2 AI enrichment -----
        description = p.get("description") or ""
        bullets = p.get("bullets") or []
        enrichment_notes: list[str] = []
        if enrich:
            try:
                description, bullets, enrichment_notes = await enrich_product(
                    name=name, description=description, bullets=bullets
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("enrich_product failed: %s", exc)

        # Existing product by (seller, sku)?
        existing = None
        if p.get("sku"):
            existing = await db.products.find_one(
                {"seller_id": seller["id"], "sku": p["sku"]},
                {"_id": 0, "id": 1},
            )

        now = now_utc()
        product_doc = {
            "name": name,
            "description": description,
            "category": p["category"],
            "subcategory": p.get("subcategory"),
            "price_inr": float(p.get("price_inr") or (price_nzd * fx)),
            "price_nzd": float(price_nzd),
            "image": image,
            "images": list(p.get("images") or []),
            "stock_count": int(p.get("stock_count") or 0),
            "in_stock": int(p.get("stock_count") or 0) > 0,
            "rating": 4.5,
            "reviews_count": 0,
            "colors": list(p.get("colors") or []),
            "sizes": list(p.get("sizes") or []),
            "origin": p.get("country_of_origin") or "India",
            "seller_id": seller["id"],
            "seller_name": seller_name,
            "seller_city": seller_city,
            "brand": p.get("brand"),
            "sku": p.get("sku"),
            "bullets": bullets,
            "hsn_code": p.get("hsn_code"),
            "ean_upc": p.get("ean_upc"),
            "manufacturer": p.get("manufacturer"),
            "importer": p.get("importer"),
            "ingredients": p.get("ingredients"),
            "imported_from": doc.get("source"),
            "imported_at": now,
            "ai_enrichment": enrichment_notes,
            "updated_at": now,
        }

        try:
            if existing:
                await db.products.update_one(
                    {"id": existing["id"]},
                    {"$set": product_doc},
                )
                updated += 1
            else:
                product_doc["id"] = f"pdt_{uuid.uuid4().hex[:12]}"
                product_doc["created_at"] = now
                await db.products.insert_one(product_doc)
                created += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Insert failed for row %s: %s", choice.row_index, exc)
            failed.append(
                {"row_index": choice.row_index, "error": str(exc)[:200]}
            )

    # Clean up the preview (best-effort)
    try:
        await db.catalog_import_previews.delete_one(
            {"preview_token": body.preview_token, "seller_id": seller["id"]}
        )
    except Exception:  # noqa: BLE001
        pass

    return ImportCommitResponse(
        created=created,
        updated=updated,
        skipped=skipped,
        failed=len(failed),
        failed_details=failed,
    )
