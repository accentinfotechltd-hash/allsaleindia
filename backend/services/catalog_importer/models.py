"""Pydantic schema for catalog import preview/commit.

The preview response is the SINGLE source of truth between backend and
frontend wizard. Front-end only reads ``rows``, ``ready_count``,
``needs_attention_count``, ``warnings`` and ``preview_token``.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


IssueSeverity = Literal["error", "warning", "info"]
ImportSource = Literal["amazon", "flipkart", "myntra", "meesho", "csv", "unknown"]


class RowIssue(BaseModel):
    severity: IssueSeverity
    field: Optional[str] = None
    message: str


class MappedProduct(BaseModel):
    """Mapped Allsale-shape product ready to be persisted."""

    sku: Optional[str] = None
    name: str
    description: str = ""
    category: str = ""
    subcategory: Optional[str] = None
    brand: Optional[str] = None
    price_inr: Optional[float] = None
    price_nzd: Optional[float] = None
    mrp_inr: Optional[float] = None
    stock_count: int = 0
    image: Optional[str] = None
    images: List[str] = Field(default_factory=list)
    bullets: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)
    sizes: List[str] = Field(default_factory=list)
    weight_kg: Optional[float] = None
    dimensions_cm: Optional[List[float]] = None  # [L, B, H]
    hsn_code: Optional[str] = None
    ean_upc: Optional[str] = None
    country_of_origin: Optional[str] = None
    manufacturer: Optional[str] = None
    importer: Optional[str] = None
    ingredients: Optional[str] = None
    shelf_life_months: Optional[int] = None
    raw_category_label: Optional[str] = None


class ParsedRow(BaseModel):
    row_index: int
    product: MappedProduct
    issues: List[RowIssue] = Field(default_factory=list)
    ready: bool = True  # False if any issue.severity == "error"


class ParsedCatalog(BaseModel):
    source: ImportSource
    total_rows: int
    ready_count: int
    needs_attention_count: int
    rows: List[ParsedRow]
    sheet_name: Optional[str] = None
    fx_inr_to_nzd: Optional[float] = None
    warnings: List[str] = Field(default_factory=list)


class ImportCommitRow(BaseModel):
    """Front-end's accept/edit decision per row."""

    row_index: int
    publish: bool = True
    overrides: Optional[MappedProduct] = None  # seller-edited values


class ImportCommitRequest(BaseModel):
    preview_token: str
    rows: List[ImportCommitRow]
    margin_pct: float = 0.0  # uplift applied to price_nzd at commit time
    enrich_with_ai: bool = False  # Tier 2: translate + summarise via Claude


class ImportCommitResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    failed: int
    failed_details: List[dict] = Field(default_factory=list)
