"""Allsale backend \u2014 thin FastAPI app factory.

The actual business logic lives in:
  * `routers/`   \u2014 FastAPI route handlers, grouped by domain
  * `services/`  \u2014 Reusable DB-aware helpers (notifications, payouts,
                   shiprocket, stripe, cart hydration, seeding, etc.)
  * `models.py`  \u2014 Pydantic request/response schemas
  * `utils.py`   \u2014 Pure helpers (hashing, JWT, business validation)
  * `deps.py`    \u2014 FastAPI dependencies (auth)
  * `db.py`      \u2014 Mongo client singleton + index bootstrap
  * `config.py`  \u2014 Env-driven constants, taxonomy, MPI keyword list

Routes are all mounted under the `/api` prefix to match the Kubernetes
ingress rules.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter

from db import client, db, ensure_indexes
from routers import (
    admin,
    auth,
    cart,
    checkout,
    health,
    notifications,
    orders,
    products,
    returns,
    seller,
    shiprocket,
    uploads,
)
from services.seed import seed_products

# Backward-compatibility re-exports for tests that do
# `from server import decrement_stock_for_order, restock_for_order,
#  create_payouts_for_order, db`.
from services.payouts import create_payouts_for_order  # noqa: F401
from services.stock import (  # noqa: F401
    decrement_stock_for_order,
    restock_for_order,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("allsale")

app = FastAPI(title="Allsale API", version="1.0.0")

# Group all routes under the /api prefix.
api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(products.router)
api.include_router(cart.router)
api.include_router(seller.router)
api.include_router(orders.router)
api.include_router(checkout.router)
api.include_router(returns.router)
api.include_router(shiprocket.router)
api.include_router(uploads.router)
api.include_router(notifications.router)
api.include_router(admin.router)
api.include_router(health.router)

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    await ensure_indexes()
    await seed_products()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    client.close()
