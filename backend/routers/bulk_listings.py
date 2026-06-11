"""Seller bulk listing import / export endpoints.

Flow:
  1. Seller downloads a CSV/XLSX template OR exports their current
     listings (with `product_id`) for round-trip editing.
  2. Seller fills the sheet and uploads it to /seller/bulk/preview.
     The backend validates each row and returns a per-row report
     (valid rows + errors) without writing anything to the DB.
  3. Seller calls /seller/bulk/import with the validated rows to
     actually create/update products.

Up to 1000 rows per upload (configurable).
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from config import INR_PER_NZD, TAXONOMY
from db import db
from deps import get_current_user
from models import BulkImportPreviewResponse, BulkImportRequest, BulkImportResult
from services.bulk_listings_svc import (
    TEMPLATE_COLUMNS,
    parse_upload,
    template_rows_example,
    validate_row,
    write_csv,
    write_xlsx,
)
from utils import now_utc

router = APIRouter(prefix="/seller/bulk", tags=["seller-bulk"])

MAX_ROWS = 1000
MAX_FILE_BYTES = 8 * 1024 * 1024  # 8 MB


async def _require_verified_seller(current=Depends(get_current_user)) -> dict:
    if not current.get("is_seller"):
        raise HTTPException(status_code=403, detail="Seller account required")
    if current.get("seller_verification_status") != "auto_verified":
        raise HTTPException(status_code=403, detail="Seller verification pending")
    return current


def _valid_categories() -> set[str]:
    return {t["name"] for t in TAXONOMY}


# ---------------------------------------------------------------------------
# Template downloads
# ---------------------------------------------------------------------------
@router.get("/template.csv")
async def download_csv_template(seller=Depends(_require_verified_seller)):
    """Download a blank CSV template with two example rows pre-filled."""
    body = write_csv(template_rows_example())
    return StreamingResponse(
        iter([body]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=allsale-listings-template.csv"
        },
    )


@router.get("/template.xlsx")
async def download_xlsx_template(seller=Depends(_require_verified_seller)):
    """Download a blank XLSX template with two example rows pre-filled."""
    body = write_xlsx(template_rows_example())
    return StreamingResponse(
        iter([body]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": "attachment; filename=allsale-listings-template.xlsx"
        },
    )


# ---------------------------------------------------------------------------
# Export current listings (round-trip edit)
# ---------------------------------------------------------------------------
async def _seller_listings_as_rows(seller_id: str) -> list[dict[str, Any]]:
    cursor = db.products.find(
        {"seller_id": seller_id}, {"_id": 0}
    ).sort("created_at", -1)
    rows: list[dict[str, Any]] = []
    async for p in cursor:
        rows.append(
            {
                "product_id": p.get("id", ""),
                "name": p.get("name", ""),
                "description": p.get("description", ""),
                "category": p.get("category", ""),
                "subcategory": p.get("subcategory", ""),
                "price_nzd": p.get("price_nzd", ""),
                "stock_count": p.get("stock_count", 0),
                "sizes": p.get("sizes", []) or [],
                "colors": p.get("colors", []) or [],
                "shipping_days_min": p.get("shipping_days_min", 7),
                "shipping_days_max": p.get("shipping_days_max", 14),
                "image_urls": (p.get("images") or ([p.get("image")] if p.get("image") else [])),
            }
        )
    return rows


@router.get("/export.csv")
async def export_listings_csv(seller=Depends(_require_verified_seller)):
    rows = await _seller_listings_as_rows(seller["id"])
    body = write_csv(rows)
    return StreamingResponse(
        iter([body]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=allsale-listings-{seller['id']}.csv"
        },
    )


@router.get("/export.xlsx")
async def export_listings_xlsx(seller=Depends(_require_verified_seller)):
    rows = await _seller_listings_as_rows(seller["id"])
    body = write_xlsx(rows)
    return StreamingResponse(
        iter([body]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=allsale-listings-{seller['id']}.xlsx"
        },
    )


# ---------------------------------------------------------------------------
# Preview (validate file, no DB writes)
# ---------------------------------------------------------------------------
@router.post("/preview", response_model=BulkImportPreviewResponse)
async def preview_upload(
    file: UploadFile = File(...),
    seller=Depends(_require_verified_seller),
):
    blob = await file.read()
    if not blob:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(blob) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 8 MB)")
    try:
        raw_rows = parse_upload(file.filename or "", blob)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    if not raw_rows:
        raise HTTPException(status_code=400, detail="No data rows found in the file")
    if len(raw_rows) > MAX_ROWS:
        raise HTTPException(
            status_code=413, detail=f"Too many rows (max {MAX_ROWS} per upload)"
        )

    valid_categories = _valid_categories()
    # For update rows, check ownership.
    update_ids = [
        str(r.get("product_id") or "").strip()
        for r in raw_rows
        if str(r.get("product_id") or "").strip()
    ]
    owned_ids: set[str] = set()
    if update_ids:
        owned_cursor = db.products.find(
            {"id": {"$in": update_ids}, "seller_id": seller["id"]},
            {"_id": 0, "id": 1},
        )
        owned_ids = {p["id"] async for p in owned_cursor}

    rows: list[dict[str, Any]] = []
    valid_count = 0
    create_count = 0
    update_count = 0
    error_count = 0
    for idx, raw in enumerate(raw_rows, start=2):  # +2 because row 1 is the header
        result = validate_row(raw, valid_categories)
        if result["mode"] == "update":
            pid = result["data"].get("product_id")
            if pid and pid not in owned_ids:
                result["ok"] = False
                result["errors"].append(
                    f"product_id '{pid}' is not one of your listings"
                )
        if result["ok"]:
            valid_count += 1
            if result["mode"] == "create":
                create_count += 1
            else:
                update_count += 1
        else:
            error_count += 1
        rows.append(
            {
                "row_number": idx,
                "mode": result["mode"],
                "ok": result["ok"],
                "errors": result["errors"],
                "data": result["data"],
            }
        )

    return BulkImportPreviewResponse(
        total=len(rows),
        valid=valid_count,
        errors=error_count,
        will_create=create_count,
        will_update=update_count,
        rows=rows,
    )


# ---------------------------------------------------------------------------
# Commit (insert + update)
# ---------------------------------------------------------------------------
async def _seller_company_info(seller_id: str) -> tuple[str | None, str | None]:
    profile = await db.sellers.find_one({"user_id": seller_id}, {"_id": 0})
    if not profile:
        user = await db.users.find_one({"id": seller_id}, {"_id": 0, "full_name": 1})
        return (user or {}).get("full_name"), None
    return profile.get("company_name"), profile.get("city")


@router.post("/import", response_model=BulkImportResult)
async def commit_import(
    body: BulkImportRequest,
    seller=Depends(_require_verified_seller),
):
    valid_categories = _valid_categories()
    update_ids = [r.product_id for r in body.rows if r.product_id]
    owned_ids: set[str] = set()
    if update_ids:
        owned_cursor = db.products.find(
            {"id": {"$in": update_ids}, "seller_id": seller["id"]},
            {"_id": 0, "id": 1},
        )
        owned_ids = {p["id"] async for p in owned_cursor}

    company_name, seller_city = await _seller_company_info(seller["id"])

    created = 0
    updated = 0
    errors: list[dict[str, Any]] = []

    for idx, row in enumerate(body.rows, start=2):
        raw_dict = row.model_dump()
        # `images` list comes through directly; the validator expects
        # them under the `image_urls` slot of the raw row dict.
        raw_dict["image_urls"] = " | ".join(row.images or [])
        raw_dict["sizes"] = " | ".join(row.sizes or [])
        raw_dict["colors"] = " | ".join(row.colors or [])
        result = validate_row(raw_dict, valid_categories)
        if row.product_id and row.product_id not in owned_ids:
            result["ok"] = False
            result["errors"].append(
                f"product_id '{row.product_id}' is not one of your listings"
            )
        if not result["ok"]:
            errors.append({"row_number": idx, "errors": result["errors"]})
            continue

        data = result["data"]
        if result["mode"] == "create":
            pid = str(uuid.uuid4())
            images = data["images"][:10]
            doc = {
                "id": pid,
                "name": data["name"],
                "description": data["description"],
                "category": data["category"],
                "subcategory": data.get("subcategory"),
                "price_nzd": float(data["price_nzd"]),
                "price_inr": round(float(data["price_nzd"]) * INR_PER_NZD, 0),
                "image": images[0],
                "images": images,
                "rating": 0.0,
                "reviews_count": 0,
                "in_stock": int(data["stock_count"] or 0) > 0,
                "stock_count": int(data["stock_count"] or 0),
                "colors": data["colors"],
                "sizes": data["sizes"],
                "shipping_days_min": int(data["shipping_days_min"]),
                "shipping_days_max": int(data["shipping_days_max"]),
                "origin": "India",
                "seller_id": seller["id"],
                "seller_name": company_name or seller.get("full_name"),
                "seller_city": seller_city,
                "created_at": now_utc(),
            }
            await db.products.insert_one(doc)
            created += 1
        else:
            update: dict[str, Any] = {"updated_at": now_utc()}
            if data["name"]:
                update["name"] = data["name"]
            if data["description"]:
                update["description"] = data["description"]
            if data["category"]:
                update["category"] = data["category"]
            if data.get("subcategory") is not None:
                update["subcategory"] = data["subcategory"]
            if data["price_nzd"] is not None:
                update["price_nzd"] = float(data["price_nzd"])
                update["price_inr"] = round(
                    float(data["price_nzd"]) * INR_PER_NZD, 0
                )
            if data["stock_count"] is not None:
                update["stock_count"] = int(data["stock_count"])
                update["in_stock"] = int(data["stock_count"]) > 0
            if data["sizes"]:
                update["sizes"] = data["sizes"]
            if data["colors"]:
                update["colors"] = data["colors"]
            if data["images"]:
                imgs = data["images"][:10]
                update["images"] = imgs
                update["image"] = imgs[0]
            update["shipping_days_min"] = int(data["shipping_days_min"])
            update["shipping_days_max"] = int(data["shipping_days_max"])
            res = await db.products.update_one(
                {"id": data["product_id"], "seller_id": seller["id"]},
                {"$set": update},
            )
            if res.matched_count:
                updated += 1
            else:
                errors.append(
                    {
                        "row_number": idx,
                        "errors": [
                            f"product_id '{data['product_id']}' not found"
                        ],
                    }
                )

    return BulkImportResult(
        created=created,
        updated=updated,
        errors=errors,
        total_attempted=len(body.rows),
    )


# ---------------------------------------------------------------------------
# Misc: which columns are expected (helpful for the mobile UI)
# ---------------------------------------------------------------------------
@router.get("/columns")
async def template_columns(seller=Depends(_require_verified_seller)):
    return {
        "columns": TEMPLATE_COLUMNS,
        "required_for_new": ["name", "description", "category", "price_nzd", "image_urls"],
        "categories": [t["name"] for t in TAXONOMY],
        "max_rows_per_upload": MAX_ROWS,
    }
