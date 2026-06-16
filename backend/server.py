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
    account_addresses,
    admin,
    admin_team,
    auth,
    auth_pwd_reset,
    auth_email_verify,
    events,
    auth_2fa,
    auth_sso,
    bulk_listings,
    cart,
    chat,
    checkout,
    coupons,
    financing,
    flash_sales,
    geo,
    health,
    notifications,
    orders,
    points,
    policies,
    products,
    recommendations,
    referrals,
    returns,
    reviews,
    seller,
    shiprocket,
    shipping,
    size_guide,
    stripe_connect,
    support,
    uploads,
    wallet,
    wishlist,
)
from services.seed import seed_products
from services.admin_auth import seed_owner_admin

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
api.include_router(auth_2fa.router)
api.include_router(auth_sso.router)
api.include_router(products.router)
api.include_router(cart.router)
api.include_router(seller.router)
api.include_router(size_guide.router)
api.include_router(bulk_listings.router)
api.include_router(orders.router)
api.include_router(checkout.router)
api.include_router(returns.router)
api.include_router(reviews.router)
api.include_router(coupons.router)
api.include_router(flash_sales.router)
api.include_router(wishlist.router)
api.include_router(points.router)
api.include_router(referrals.router)
api.include_router(chat.router)
api.include_router(wallet.router)
api.include_router(shiprocket.router)
api.include_router(shipping.router)
api.include_router(uploads.router)
api.include_router(notifications.router)
api.include_router(admin.router)
api.include_router(admin_team.router)
api.include_router(account_addresses.router)
api.include_router(auth_pwd_reset.router)
api.include_router(auth_email_verify.router)
api.include_router(recommendations.router)
api.include_router(policies.router)
api.include_router(stripe_connect.router)
api.include_router(stripe_connect.webhook_router)
api.include_router(events.router)
api.include_router(geo.router)
api.include_router(health.router)
api.include_router(support.router)
api.include_router(financing.router)

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
    await seed_owner_admin()
    from services.scheduler import init_scheduler
    init_scheduler()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    from services.scheduler import shutdown_scheduler
    shutdown_scheduler()
    client.close()
