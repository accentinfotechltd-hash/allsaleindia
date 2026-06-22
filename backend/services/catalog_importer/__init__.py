"""Catalog importer — parse Amazon / Flipkart / generic CSV catalog files
into Allsale ``Product`` schema.

Public surface (used by ``routers/seller_import.py``):

- ``detect_format(filename, file_bytes) -> Literal["amazon", "flipkart", "csv", "unknown"]``
- ``parse(file_bytes, fmt) -> ParsedCatalog``
- ``ParsedCatalog`` — mapped rows + warnings ready for seller review.
"""
from .amazon_parser import parse_amazon
from .flipkart_parser import parse_flipkart
from .myntra_parser import parse_myntra
from .meesho_parser import parse_meesho
from .csv_parser import parse_csv
from .models import ParsedCatalog, ParsedRow, RowIssue
from .detect import detect_format


def parse(file_bytes: bytes, fmt: str) -> ParsedCatalog:
    """Dispatch to the correct parser based on detected format."""
    if fmt == "amazon":
        return parse_amazon(file_bytes)
    if fmt == "flipkart":
        return parse_flipkart(file_bytes)
    if fmt == "myntra":
        return parse_myntra(file_bytes)
    if fmt == "meesho":
        return parse_meesho(file_bytes)
    if fmt == "csv":
        return parse_csv(file_bytes)
    raise ValueError(f"Unsupported import format: {fmt}")


__all__ = [
    "ParsedCatalog",
    "ParsedRow",
    "RowIssue",
    "detect_format",
    "parse",
    "parse_amazon",
    "parse_flipkart",
    "parse_myntra",
    "parse_meesho",
    "parse_csv",
]
