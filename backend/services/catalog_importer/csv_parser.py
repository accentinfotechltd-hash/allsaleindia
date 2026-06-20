"""Parse a simple, Allsale-shaped CSV/TSV catalog.

Expected columns (case-insensitive, comma OR tab separated):
  sku, name, description, category, subcategory, brand,
  price_inr, price_nzd, mrp_inr, stock_count, image, images (semicolon
  separated), bullets (semicolon separated), color, size, weight_kg,
  hsn_code, ean_upc, country_of_origin, manufacturer, ingredients

This is the fallback for sellers who keep their own spreadsheet.
"""
from __future__ import annotations

import csv
import io

from .mapping import coerce_inr_to_nzd, parse_decimal, parse_int, split_multi
from .models import MappedProduct, ParsedCatalog, ParsedRow, RowIssue


def parse_csv(file_bytes: bytes, *, fx_inr_per_nzd: float = 51.0) -> ParsedCatalog:
    text = file_bytes.decode("utf-8-sig", errors="replace")
    # Sniff dialect
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t|")
    except Exception:  # noqa: BLE001
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    # Normalize header keys to lower_snake.
    rows = []
    for raw in reader:
        normalized = {
            (k or "").strip().lower().replace(" ", "_"): (v or "").strip()
            for k, v in raw.items()
        }
        rows.append(normalized)

    parsed_rows: list[ParsedRow] = []
    for idx, r in enumerate(rows, start=2):  # row 1 = header
        if not any(r.values()):
            continue
        issues: list[RowIssue] = []
        name = r.get("name") or r.get("title") or ""
        if not name:
            issues.append(
                RowIssue(severity="error", field="name", message="name is empty")
            )

        price_inr = parse_decimal(r.get("price_inr"))
        price_nzd = parse_decimal(r.get("price_nzd"))
        if price_nzd is None and price_inr is not None:
            price_nzd = coerce_inr_to_nzd(price_inr, fx_inr_per_nzd)
        if price_nzd is None:
            issues.append(
                RowIssue(severity="error", field="price_nzd", message="price_nzd or price_inr required")
            )

        main_img = r.get("image") or ""
        gallery = split_multi(r.get("images"), seps=(";", "|", ","))
        if not main_img and not gallery:
            issues.append(
                RowIssue(severity="error", field="image", message="image is empty")
            )

        prod = MappedProduct(
            sku=r.get("sku") or None,
            name=name or "(unnamed)",
            description=r.get("description") or "",
            category=r.get("category") or "",
            subcategory=r.get("subcategory") or None,
            brand=r.get("brand") or None,
            price_inr=price_inr,
            price_nzd=price_nzd,
            mrp_inr=parse_decimal(r.get("mrp_inr")),
            stock_count=parse_int(r.get("stock_count")) or 0,
            image=main_img or (gallery[0] if gallery else None),
            images=gallery if main_img else gallery[1:],
            bullets=split_multi(r.get("bullets"), seps=(";", "|")),
            colors=split_multi(r.get("color") or r.get("colors"), seps=(";", ",", "|")),
            sizes=split_multi(r.get("size") or r.get("sizes"), seps=(";", ",", "|")),
            weight_kg=parse_decimal(r.get("weight_kg")),
            hsn_code=r.get("hsn_code") or None,
            ean_upc=r.get("ean_upc") or r.get("barcode") or None,
            country_of_origin=r.get("country_of_origin") or "India",
            manufacturer=r.get("manufacturer") or None,
            ingredients=r.get("ingredients") or None,
            raw_category_label=r.get("category"),
        )
        ready = not any(i.severity == "error" for i in issues)
        parsed_rows.append(
            ParsedRow(row_index=idx, product=prod, issues=issues, ready=ready)
        )

    ready_count = sum(1 for r in parsed_rows if r.ready)
    needs = len(parsed_rows) - ready_count
    return ParsedCatalog(
        source="csv",
        total_rows=len(parsed_rows),
        ready_count=ready_count,
        needs_attention_count=needs,
        rows=parsed_rows,
        fx_inr_to_nzd=fx_inr_per_nzd,
    )
