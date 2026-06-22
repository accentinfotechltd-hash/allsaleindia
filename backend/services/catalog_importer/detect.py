"""Best-effort source-format detection from filename + first bytes.

We avoid loading the whole workbook just to detect format; we lean on
file signatures + filename heuristics first, then peek at sheet names
and the FIRST HEADER ROW only if both signals are inconclusive.

Header-signature detection lets a seller drop a Myntra/Meesho export
into the upload box without manually picking the format — we recognise
"Style Code"+"Article Type" → Myntra and "Product ID"+"Inventory" → Meesho.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from typing import Iterable, Literal


_Format = Literal["amazon", "flipkart", "myntra", "meesho", "csv", "unknown"]


def _xlsx_first_row(file_bytes: bytes) -> list[str]:
    """Peek at the first row of the first sheet of an xlsx without loading
    the whole workbook. Returns an empty list on any failure."""
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            # Read the shared strings table once.
            try:
                ss_xml = zf.read("xl/sharedStrings.xml").decode("utf-8", "ignore")
                shared = re.findall(r"<t[^>]*>([^<]*)</t>", ss_xml)
            except KeyError:
                shared = []
            # Pick the first sheet's xml.
            sheet_name = None
            for n in zf.namelist():
                if n.startswith("xl/worksheets/sheet1.xml"):
                    sheet_name = n
                    break
            if not sheet_name:
                return []
            sheet_xml = zf.read(sheet_name).decode("utf-8", "ignore")
            # Just the first <row>.
            m = re.search(r"<row[^>]*>(.*?)</row>", sheet_xml, re.DOTALL)
            if not m:
                return []
            row_xml = m.group(1)
            cells: list[str] = []
            for c_match in re.finditer(r"<c[^>]*?(?:t=\"([^\"]+)\")?[^>]*>(.*?)</c>", row_xml, re.DOTALL):
                t_attr = c_match.group(1) or ""
                inner = c_match.group(2) or ""
                v_match = re.search(r"<v>([^<]*)</v>", inner)
                if not v_match:
                    inline = re.search(r"<is>.*?<t[^>]*>([^<]*)</t>", inner, re.DOTALL)
                    cells.append((inline.group(1) if inline else "").strip().lower())
                    continue
                v = v_match.group(1)
                if t_attr == "s":  # shared-strings index
                    try:
                        cells.append(shared[int(v)].strip().lower())
                    except (IndexError, ValueError):
                        cells.append("")
                else:
                    cells.append(v.strip().lower())
            return cells
    except Exception:  # noqa: BLE001
        return []


def _csv_first_row(file_bytes: bytes) -> list[str]:
    try:
        text = file_bytes[:4096].decode("utf-8-sig", errors="ignore")
        try:
            dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t|")
        except Exception:  # noqa: BLE001
            dialect = csv.excel
        reader = csv.reader(io.StringIO(text), dialect=dialect)
        first = next(reader, [])
        return [(c or "").strip().lower() for c in first]
    except Exception:  # noqa: BLE001
        return []


def _headers_match(headers: Iterable[str], *needles: str) -> bool:
    """All needles must appear (as substring) in some header cell."""
    h = list(headers)
    if not h:
        return False
    for n in needles:
        n = n.lower()
        if not any(n in c for c in h):
            return False
    return True


def detect_format(filename: str, file_bytes: bytes) -> _Format:
    name = (filename or "").lower()
    head = file_bytes[:8]

    # Filename hints — strongest signal first.
    if "myntra" in name:
        return "myntra"
    if "meesho" in name:
        return "meesho"
    if "flipkart" in name:
        return "flipkart"
    if "amazon" in name:
        return "amazon"

    # CSV by extension or by sniffing first line for commas/tabs.
    if name.endswith(".csv") or name.endswith(".tsv"):
        first = _csv_first_row(file_bytes)
        # CSV could be Meesho's "My Inventory.csv" — recognise by columns.
        if _headers_match(first, "product id", "inventory") or _headers_match(first, "product id", "selling price"):
            return "meesho"
        return "csv"

    is_xlsx = head.startswith(b"PK\x03\x04")  # zip container = xlsx/xlsm
    is_xls = head.startswith(b"\xD0\xCF\x11\xE0")  # legacy OLE = xls

    if not (is_xlsx or is_xls):
        try:
            sniff = file_bytes[:512].decode("utf-8", errors="ignore")
            if "," in sniff and "\n" in sniff:
                # Try meesho CSV detection without an explicit extension.
                first = _csv_first_row(file_bytes)
                if _headers_match(first, "product id", "inventory"):
                    return "meesho"
                return "csv"
        except Exception:  # noqa: BLE001
            pass
        return "unknown"

    # Legacy .xls — almost always Flipkart in our world.
    if is_xls:
        return "flipkart"

    # XLSX/XLSM — sniff workbook + first-row headers.
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            wb_xml = ""
            try:
                wb_xml = zf.read("xl/workbook.xml").decode("utf-8", "ignore").lower()
            except KeyError:
                pass
            if "valid values" in wb_xml or "data definitions" in wb_xml:
                return "amazon"
            if "flipkart" in wb_xml or "dropdownvaluesforcolumn" in wb_xml:
                return "flipkart"
    except Exception:  # noqa: BLE001
        pass

    # Header-row sniff — covers Myntra/Meesho/generic xlsx exports.
    first = _xlsx_first_row(file_bytes)
    if _headers_match(first, "style code", "article type"):
        return "myntra"
    if _headers_match(first, "product id", "inventory") or _headers_match(first, "product id", "selling price"):
        return "meesho"
    if _headers_match(first, "asin"):
        return "amazon"
    if _headers_match(first, "fsn") or _headers_match(first, "listing id"):
        return "flipkart"

    # Default xlsx/xlsm to amazon since Amazon's inventory report uses .xlsm.
    return "amazon" if name.endswith(".xlsm") else "unknown"
