"""Google Places proxy — server-side wrapper around the new Places API.

We proxy from the mobile/web clients so the API key never ships to the
device and we can layer rate-limiting / per-user quotas later.

Endpoints:
  GET  /api/geo/places/autocomplete?q=...&session_token=...
  GET  /api/geo/places/details?place_id=...&session_token=...

Cost notes
----------
Using Places Autocomplete (New) + Place Details (New) with **session
tokens** is the cheapest pattern — autocomplete calls within the same
session are billed at $0 and a single Place Details call at the end
costs $0.017. Always pass the same UUID `session_token` from the first
keystroke until you commit (the client component does this).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from deps import get_current_user

router = APIRouter(prefix="/geo/places", tags=["geo-places"])

logger = logging.getLogger("allsale.places")

_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
_DETAILS_URL_TPL = "https://places.googleapis.com/v1/places/{place_id}"


def _api_key() -> str:
    k = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not k:
        raise HTTPException(
            status_code=503,
            detail="Address autocomplete is temporarily unavailable.",
        )
    return k


# Buyer regions the platform supports — bias suggestions to these countries
# so we don't get Indian addresses surfacing for NZ buyers.
_SUPPORTED_REGIONS = ["nz", "au", "us", "gb", "ca", "in"]


@router.get("/autocomplete")
async def autocomplete(
    q: str = Query(..., min_length=2, max_length=120),
    session_token: Optional[str] = Query(None),
    country: Optional[str] = Query(
        None,
        description="Optional ISO-2 country code to bias results (e.g. 'nz').",
    ),
    current=Depends(get_current_user),
):
    """Real-time address suggestions for a partial input string."""
    body: dict = {
        "input": q,
        "languageCode": "en",
        # Include both addresses and establishments — buyers often type
        # a business name as a delivery contact.
        "includedPrimaryTypes": ["street_address", "premise", "subpremise", "route"],
    }
    if session_token:
        body["sessionToken"] = session_token
    if country and country.lower() in _SUPPORTED_REGIONS:
        body["includedRegionCodes"] = [country.lower()]
    else:
        body["includedRegionCodes"] = _SUPPORTED_REGIONS

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": _api_key(),
        # Keep the response slim — these are the only fields the client uses.
        "X-Goog-FieldMask": (
            "suggestions.placePrediction.placeId,"
            "suggestions.placePrediction.text,"
            "suggestions.placePrediction.structuredFormat"
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(_AUTOCOMPLETE_URL, json=body, headers=headers)
        if r.status_code != 200:
            logger.warning("Places autocomplete %s: %s", r.status_code, r.text[:200])
            raise HTTPException(status_code=502, detail="Places API error")
        data = r.json()
    except httpx.RequestError as e:
        logger.warning("Places autocomplete network: %s", e)
        raise HTTPException(status_code=504, detail="Places API timeout")

    out = []
    for s in (data.get("suggestions") or []):
        p = s.get("placePrediction") or {}
        sf = p.get("structuredFormat") or {}
        out.append({
            "place_id": p.get("placeId"),
            "primary_text": (sf.get("mainText") or {}).get("text") or "",
            "secondary_text": (sf.get("secondaryText") or {}).get("text") or "",
            "description": (p.get("text") or {}).get("text") or "",
        })
    return {"results": out}


# Reverse map from Google's address-component "types" → our local field names.
_TYPE_TO_FIELD = {
    "street_number": "_street_number",
    "route": "_route",
    "subpremise": "line2",
    "locality": "city",
    "postal_town": "city",
    "sublocality_level_1": "_sublocality",
    "administrative_area_level_1": "region",
    "postal_code": "postal_code",
    "country": "_country",
}


def _flatten_address_components(components: list[dict]) -> dict:
    parts: dict = {}
    iso = None
    for c in components:
        for t in c.get("types") or []:
            field = _TYPE_TO_FIELD.get(t)
            if field == "_country":
                iso = (c.get("shortText") or c.get("longText") or "").upper()[:2]
            elif field:
                parts[field] = c.get("longText") or c.get("shortText") or ""
    # Compose line1 = "street_number route" with sublocality fallback.
    sn = parts.pop("_street_number", "")
    route = parts.pop("_route", "")
    sublocality = parts.pop("_sublocality", "")
    line1 = " ".join([p for p in (sn, route) if p]) or sublocality
    return {
        "line1": line1,
        "line2": parts.get("line2", ""),
        "city": parts.get("city", "") or sublocality,
        "region": parts.get("region", ""),
        "postal_code": parts.get("postal_code", ""),
        "country": iso or "",
    }


@router.get("/details")
async def details(
    place_id: str = Query(..., min_length=4),
    session_token: Optional[str] = Query(None),
    current=Depends(get_current_user),
):
    """Resolve a place_id into normalized address fields + lat/lng."""
    params = {}
    if session_token:
        params["sessionToken"] = session_token
    headers = {
        "X-Goog-Api-Key": _api_key(),
        "X-Goog-FieldMask": (
            "id,formattedAddress,addressComponents,location,displayName"
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                _DETAILS_URL_TPL.format(place_id=place_id),
                params=params,
                headers=headers,
            )
        if r.status_code != 200:
            logger.warning("Places details %s: %s", r.status_code, r.text[:200])
            raise HTTPException(status_code=502, detail="Places API error")
        data = r.json()
    except httpx.RequestError as e:
        logger.warning("Places details network: %s", e)
        raise HTTPException(status_code=504, detail="Places API timeout")

    fields = _flatten_address_components(data.get("addressComponents") or [])
    loc = data.get("location") or {}
    return {
        "place_id": data.get("id") or place_id,
        "formatted_address": data.get("formattedAddress", ""),
        "address": fields,
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
    }
