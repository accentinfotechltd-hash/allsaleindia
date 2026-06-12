"""Public size-guide endpoints.

`/api/size-guide` returns conversion tables for apparel, shoes,
heritage Indian sizes and jewellery. Front-end uses this to render the
"Size guide" modal on every product page and inside the filter sheet.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from data.size_guide import (
    CATEGORIES,
    COUNTRIES,
    by_id,
    for_category,
    recommend_size,
)

router = APIRouter(tags=["size-guide"])


@router.get("/size-guide")
async def get_size_guide(
    category: Optional[str] = Query(default=None, description="Product category (e.g. 'Women's Clothing')"),
    gender: Optional[str] = Query(default=None, description="women | men — narrows shoes"),
):
    """Return one or more size conversion tables.

    * `category` — when supplied, only tables that apply to that product
      category are returned. e.g. `category=Shoes` returns both women's
      and men's shoe tables; pass `gender=women` to narrow further.
    * No filters → returns ALL tables (used by the dedicated size-guide
      help screen).
    """
    if category:
        tables = for_category(category)
        if gender and category == "Shoes":
            tables = [t for t in tables if t.get("gender_hint", gender) == gender]
        return {"countries": COUNTRIES, "categories": tables}
    return {"countries": COUNTRIES, "categories": CATEGORIES}


@router.get("/size-guide/recommend")
async def recommend(
    kind: str = Query(..., description="apparel | shoes | kids"),
    gender: Optional[str] = Query(default=None, description="women | men"),
    bust_cm: Optional[float] = None,
    chest_cm: Optional[float] = None,
    waist_cm: Optional[float] = None,
    hip_cm: Optional[float] = None,
    foot_cm: Optional[float] = None,
    height_cm: Optional[float] = None,
):
    """Pick the best-fit size from the user's body measurements.

    Returns the matched row (or `null` if nothing fits the provided
    measurements). Front-end shows the size label + reassurance copy.
    """
    row = recommend_size(
        kind=kind,
        gender=gender,
        bust_cm=bust_cm,
        chest_cm=chest_cm,
        waist_cm=waist_cm,
        hip_cm=hip_cm,
        foot_cm=foot_cm,
        height_cm=height_cm,
    )
    return {"match": row}


@router.get("/size-guide/{table_id}")
async def get_size_guide_table(table_id: str):
    """Return a single table by its stable id (e.g. 'womens_apparel')."""
    table = by_id(table_id)
    if not table:
        return {"error": "not_found"}, 404
    return table
