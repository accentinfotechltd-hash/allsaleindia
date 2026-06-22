"""Tests for Myntra/Meesho parsers + smart format detection.

We synthesise minimal-but-realistic xlsx/csv payloads in-memory rather
than checking in real seller exports (which are private).
"""
from __future__ import annotations
import io

import openpyxl
import pytest

from services.catalog_importer import detect_format, parse
from services.catalog_importer.myntra_parser import parse_myntra
from services.catalog_importer.meesho_parser import parse_meesho


def _make_myntra_xlsx() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Catalog"
    ws.append([
        "Style Code", "Vendor Article Number", "Brand", "Article Type",
        "Color", "Size", "MRP", "Selling Price", "Inventory",
        "Title", "Description", "Composition", "Wash Care", "HSN",
        "Front Image", "Back Image",
    ])
    ws.append([
        "STY123", "VND-001", "RangRiti", "Kurta", "Red", "S, M, L, XL",
        1499, 999, 25,
        "RangRiti Red Cotton Kurta",
        "Comfortable cotton kurta for everyday wear",
        "100% Cotton", "Machine wash cold", "6109",
        "https://cdn.example.com/p1-front.jpg",
        "https://cdn.example.com/p1-back.jpg",
    ])
    ws.append([
        "STY456", "VND-002", "Libas", "Sarees", "Blue", "Free Size",
        2999, 1799, 10,
        "Libas Blue Banarasi Silk Saree",
        "Festive saree with gold zari border",
        "Silk blend", "Dry clean only", "5407",
        "https://cdn.example.com/p2.jpg", "",
    ])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _make_meesho_csv() -> bytes:
    return (
        "Product ID,Title,Description,Category,Sub Category,MRP,Selling Price,Inventory,"
        "Brand,Color,Size,HSN,Image URL 1,Image URL 2\n"
        "MEE001,Banarasi Silk Saree,Festive saree with zari border,Sarees,Banarasi,"
        "2500,1499,12,Meesho Pick,Maroon,Free Size,5407,"
        "https://cdn.meesho.com/p1.jpg,https://cdn.meesho.com/p1b.jpg\n"
        "MEE002,Floral Kurta Set,Daily wear kurta set,Kurta,,1899,899,30,"
        "Meesho Pick,Yellow,\"S, M, L\",6109,"
        "https://cdn.meesho.com/p2.jpg,\n"
    ).encode("utf-8")


def test_detect_myntra_by_headers():
    bs = _make_myntra_xlsx()
    assert detect_format("listings.xlsx", bs) == "myntra"


def test_detect_myntra_by_filename():
    assert detect_format("myntra_export.xlsx", b"PK\x03\x04anything") == "myntra"


def test_detect_meesho_by_csv_headers():
    bs = _make_meesho_csv()
    assert detect_format("My Inventory.csv", bs) == "meesho"


def test_detect_meesho_by_filename():
    assert detect_format("meesho-bulk.xlsx", b"PK\x03\x04junk") == "meesho"


def test_parse_myntra_extracts_rows():
    parsed = parse_myntra(_make_myntra_xlsx())
    assert parsed.source == "myntra"
    assert parsed.total_rows == 2
    assert parsed.ready_count == 2

    r0 = parsed.rows[0]
    p0 = r0.product
    assert p0.name == "RangRiti Red Cotton Kurta"
    assert p0.sku == "VND-001"
    assert p0.brand == "RangRiti"
    assert p0.price_inr == 999
    assert p0.mrp_inr == 1499
    assert p0.stock_count == 25
    assert p0.image == "https://cdn.example.com/p1-front.jpg"
    assert "https://cdn.example.com/p1-back.jpg" in p0.images
    assert p0.category == "Ethnic Fashion"
    assert p0.subcategory == "Kurtis"
    assert "S" in p0.sizes and "M" in p0.sizes and "XL" in p0.sizes
    assert "Cotton" in p0.description or "100% Cotton" in p0.description
    assert "Wash care:" in p0.description

    p1 = parsed.rows[1].product
    assert p1.category == "Ethnic Fashion"
    assert p1.subcategory == "Sarees"


def test_parse_meesho_extracts_rows_from_csv():
    parsed = parse_meesho(_make_meesho_csv())
    assert parsed.source == "meesho"
    assert parsed.total_rows == 2
    assert parsed.ready_count == 2

    p0 = parsed.rows[0].product
    assert p0.name == "Banarasi Silk Saree"
    assert p0.sku == "MEE001"
    assert p0.price_inr == 1499
    assert p0.mrp_inr == 2500
    assert p0.stock_count == 12
    assert p0.image == "https://cdn.meesho.com/p1.jpg"
    assert "https://cdn.meesho.com/p1b.jpg" in p0.images
    assert p0.category == "Ethnic Fashion"
    assert p0.subcategory == "Sarees"

    p1 = parsed.rows[1].product
    assert p1.name == "Floral Kurta Set"
    # Comma-separated sizes should split correctly
    assert "S" in p1.sizes and "M" in p1.sizes and "L" in p1.sizes


def test_parse_dispatch_routes_correctly():
    """The public ``parse(bytes, fmt)`` entrypoint must dispatch to the right parser."""
    bs = _make_myntra_xlsx()
    parsed = parse(bs, "myntra")
    assert parsed.source == "myntra"

    bs2 = _make_meesho_csv()
    parsed2 = parse(bs2, "meesho")
    assert parsed2.source == "meesho"


def test_unsupported_format_raises():
    with pytest.raises(ValueError):
        parse(b"junk", "shopify")
