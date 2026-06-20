"""Best-effort source-format detection from filename + first bytes.

We avoid loading the whole workbook just to detect format; we lean on
file signatures + filename heuristics first, then peek at sheet names
only if both signals are inconclusive.
"""
from __future__ import annotations

import io
from typing import Literal


def detect_format(
    filename: str, file_bytes: bytes
) -> Literal["amazon", "flipkart", "csv", "unknown"]:
    name = (filename or "").lower()
    head = file_bytes[:8]

    # CSV by extension or by sniffing first line for commas/tabs.
    if name.endswith(".csv") or name.endswith(".tsv"):
        return "csv"

    is_xlsx = head.startswith(b"PK\x03\x04")  # zip container = xlsx/xlsm
    is_xls = head.startswith(b"\xD0\xCF\x11\xE0")  # legacy OLE = xls

    if not (is_xlsx or is_xls):
        # Could still be raw text CSV without the right extension.
        try:
            sniff = file_bytes[:512].decode("utf-8", errors="ignore")
            if "," in sniff and "\n" in sniff:
                return "csv"
        except Exception:  # noqa: BLE001
            pass
        return "unknown"

    # Filename hints (cheap)
    if "flipkart" in name or name.endswith(".xls") or is_xls:
        # Legacy .xls is overwhelmingly Flipkart in our world.
        if is_xls:
            return "flipkart"
    if "amazon" in name:
        return "amazon"

    # Last-resort sniff for xlsx/xlsm: peek at sheet names.
    try:
        import zipfile

        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            try:
                wb_xml = zf.read("xl/workbook.xml").decode("utf-8", "ignore")
            except KeyError:
                return "unknown"
            low = wb_xml.lower()
            if "valid values" in low or "data definitions" in low:
                return "amazon"
            if "flipkart" in low or "dropdownvaluesforcolumn" in low:
                return "flipkart"
    except Exception:  # noqa: BLE001
        pass

    # Default xlsx/xlsm to amazon since that's the only marketplace using xlsm.
    return "amazon" if name.endswith(".xlsm") else "unknown"
