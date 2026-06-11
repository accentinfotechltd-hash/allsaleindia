"""Health / index route."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/")
async def root():
    return {"app": "Allsale", "status": "ok", "currency": "NZD", "origin": "India"}
