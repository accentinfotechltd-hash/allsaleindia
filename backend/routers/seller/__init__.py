"""Seller router package.

The original 1000-line ``routers/seller.py`` has been broken up into four
focused submodules:

* ``onboarding`` — register / upgrade / fetch seller profile
* ``listings``  — product CRUD + bulk edit
* ``orders``    — per-seller orders, payouts, CSV export
* ``analytics`` — traffic counters, time-series, insights

This package re-exposes a single ``router`` so existing imports
(``from routers import seller; seller.router``) keep working.
"""
from __future__ import annotations

from fastapi import APIRouter

from . import analytics, listings, onboarding, orders

router = APIRouter()
router.include_router(onboarding.router)
router.include_router(listings.router)
router.include_router(orders.router)
router.include_router(analytics.router)

__all__ = ["router", "onboarding", "listings", "orders", "analytics"]
