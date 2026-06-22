"""Seed a realistic ambassador-conversion-attribution demo for live UI testing.

Creates (idempotently):
  • Ambassador "Sarah Jenkins" with B2C code SARAHJ25, active status, password set.
  • A B2C coupon row keyed to her code.
  • 18 click rows spread across instagram (10), whatsapp (5), direct (3) in the
    last 7 days so the "Daily clicks" series and "Top channels" card both have
    something to render.
  • 5 paid orders: 3 from instagram (1 NZD 80, 1 NZD 120, 1 NZD 60), 1 from
    whatsapp (NZD 95), 1 legacy with no attribution_source (NZD 40 → "direct").
  • 1 unpaid order from instagram (NZD 999) — must NOT count toward conversions.

After seeding, sign in as `sarah-ambassador@allsale.co.nz / SarahAmb2026!` and
visit /ambassadors/dashboard to see the live conversion-attribution rollup in
the "Top channels" card.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

# Make the backend package importable.
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, "..", "backend"))
sys.path.insert(0, BACKEND)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND, ".env"))

from db import db  # noqa: E402
from utils import hash_password  # noqa: E402


AMB_EMAIL = "sarah-ambassador@allsale.co.nz"
AMB_PASSWORD = "SarahAmb2026!"
AMB_CODE = "SARAHJ25"


async def main():
    now = datetime.now(timezone.utc)

    # ----- Ambassador -----
    existing = await db.users.find_one({"email": AMB_EMAIL})
    if existing:
        amb_id = existing["id"]
        print(f"[seed] ambassador exists: {AMB_EMAIL} id={amb_id}")
    else:
        amb_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "id": amb_id,
            "email": AMB_EMAIL,
            "full_name": "Sarah Jenkins",
            "country": "NZ",
            "is_seller": False,
            "is_admin": False,
            "email_verified": True,
            "password_hash": hash_password(AMB_PASSWORD),
            "created_at": now,
        })
        print(f"[seed] created ambassador {AMB_EMAIL} id={amb_id}")

    # Ensure ambassador_profile is set / active.
    await db.users.update_one(
        {"id": amb_id},
        {"$set": {
            "ambassador_profile": {
                "code": AMB_CODE,
                "code_b2b": None,
                "country": "NZ",
                "program": "B2C",
                "status": "active",
                "primary_platform": "instagram",
                "social_handle": "@sarahjenkins.nz",
                "phone": "+64 21 123 4567",
                "audience_size": 12_500,
                "payout_currency": "NZD",
                "terms_accepted_at": now,
                "terms_version": "v1",
                "joined_at": now - timedelta(days=45),
            },
            "country": "NZ",
            "email_verified": True,
        }, "$setOnInsert": {"created_at": now}},
    )

    # ----- Coupon for her code -----
    await db.coupons.update_one(
        {"code": AMB_CODE},
        {"$set": {
            "code": AMB_CODE,
            "label": "Sarah · 5% off",
            "type": "percent",
            "value": 5.0,
            "scope": "all",
            "active": True,
            "valid_from": now - timedelta(days=45),
            "min_order_nzd": 0.0,
            "max_discount_nzd": None,
            "per_user_limit": 999,
            "coupon_type": "ambassador_b2c",
            "ambassador_user_id": amb_id,
        }, "$setOnInsert": {"id": f"cpn_{uuid.uuid4().hex[:8]}", "used_count": 0, "created_at": now}},
        upsert=True,
    )

    # ----- Wipe and re-seed click rows + orders so demo is deterministic -----
    await db.ambassador_link_clicks.delete_many({"user_id": amb_id})
    await db.orders.delete_many({"ambassador_user_id": amb_id})

    # 10 instagram clicks (6 unique IPs), 5 whatsapp (4 unique), 3 direct (3 unique).
    click_rows = []
    ip_pool_ig = ["ig-ip-A", "ig-ip-A", "ig-ip-B", "ig-ip-B", "ig-ip-C", "ig-ip-D", "ig-ip-E", "ig-ip-E", "ig-ip-F", "ig-ip-F"]
    for i, ip in enumerate(ip_pool_ig):
        click_rows.append({
            "user_id": amb_id,
            "code": AMB_CODE,
            "type": "b2c",
            "ts": now - timedelta(days=i % 7, hours=i),
            "ip_hash": hashlib.sha256(ip.encode()).hexdigest()[:32],
            "user_agent": "Mozilla/5.0",
            "source": "instagram",
            "utm_medium": "story",
            "referrer": "https://l.instagram.com/?u=...",
        })
    ip_pool_wa = ["wa-ip-G", "wa-ip-G", "wa-ip-H", "wa-ip-I", "wa-ip-J"]
    for i, ip in enumerate(ip_pool_wa):
        click_rows.append({
            "user_id": amb_id,
            "code": AMB_CODE,
            "type": "b2c",
            "ts": now - timedelta(days=i % 5, hours=i + 1),
            "ip_hash": hashlib.sha256(ip.encode()).hexdigest()[:32],
            "user_agent": "Mozilla/5.0",
            "source": "whatsapp",
            "utm_medium": "dm",
            "referrer": "https://wa.me/64...",
        })
    for i, ip in enumerate(["dir-ip-K", "dir-ip-L", "dir-ip-M"]):
        click_rows.append({
            "user_id": amb_id,
            "code": AMB_CODE,
            "type": "b2c",
            "ts": now - timedelta(days=i, hours=2),
            "ip_hash": hashlib.sha256(ip.encode()).hexdigest()[:32],
            "user_agent": "Mozilla/5.0",
            "source": "direct",
        })
    await db.ambassador_link_clicks.insert_many(click_rows)
    print(f"[seed] inserted {len(click_rows)} click rows")

    # ----- Orders: 3 paid IG, 1 paid WA, 1 paid direct/legacy, 1 unpaid IG -----
    orders = [
        # IG conversions
        {"id": f"ord_{uuid.uuid4().hex[:10]}", "user_id": "buyer_demo_1",
         "ambassador_user_id": amb_id, "attribution_source": "instagram",
         "payment_status": "paid", "status": "delivered",
         "created_at": now - timedelta(days=4), "total_nzd": 80.0,
         "buyer_country": "NZ", "buyer_currency": "NZD",
         "coupon_code": AMB_CODE, "items": []},
        {"id": f"ord_{uuid.uuid4().hex[:10]}", "user_id": "buyer_demo_2",
         "ambassador_user_id": amb_id, "attribution_source": "instagram",
         "payment_status": "succeeded", "status": "shipped",
         "created_at": now - timedelta(days=2), "total_nzd": 120.0,
         "buyer_country": "NZ", "buyer_currency": "NZD",
         "coupon_code": AMB_CODE, "items": []},
        {"id": f"ord_{uuid.uuid4().hex[:10]}", "user_id": "buyer_demo_3",
         "ambassador_user_id": amb_id, "attribution_source": "instagram",
         "payment_status": "paid", "status": "paid",
         "created_at": now - timedelta(hours=12), "total_nzd": 60.0,
         "buyer_country": "NZ", "buyer_currency": "NZD",
         "coupon_code": AMB_CODE, "items": []},
        # WA conversion
        {"id": f"ord_{uuid.uuid4().hex[:10]}", "user_id": "buyer_demo_4",
         "ambassador_user_id": amb_id, "attribution_source": "whatsapp",
         "payment_status": "paid", "status": "shipped",
         "created_at": now - timedelta(days=3), "total_nzd": 95.0,
         "buyer_country": "NZ", "buyer_currency": "NZD",
         "coupon_code": AMB_CODE, "items": []},
        # Legacy direct conversion (no attribution_source set)
        {"id": f"ord_{uuid.uuid4().hex[:10]}", "user_id": "buyer_demo_5",
         "ambassador_user_id": amb_id,
         "payment_status": "paid", "status": "delivered",
         "created_at": now - timedelta(days=6), "total_nzd": 40.0,
         "buyer_country": "NZ", "buyer_currency": "NZD",
         "coupon_code": AMB_CODE, "items": []},
        # Unpaid IG order — MUST NOT count
        {"id": f"ord_{uuid.uuid4().hex[:10]}", "user_id": "buyer_demo_unpaid",
         "ambassador_user_id": amb_id, "attribution_source": "instagram",
         "payment_status": "initiated", "status": "pending",
         "created_at": now - timedelta(hours=2), "total_nzd": 999.0,
         "buyer_country": "NZ", "buyer_currency": "NZD",
         "coupon_code": AMB_CODE, "items": []},
    ]
    await db.orders.insert_many(orders)
    paid_count = sum(1 for o in orders if o["payment_status"] in ("paid", "succeeded"))
    print(f"[seed] inserted {len(orders)} orders ({paid_count} paid)")

    # ----- Seed ambassador_sales rows so the dashboard's Sales tab also has data -----
    await db.ambassador_sales.delete_many({"ambassador_user_id": amb_id})
    sales_rows = []
    for o in orders:
        if o["payment_status"] not in ("paid", "succeeded"):
            continue
        sales_rows.append({
            "id": f"asale_{uuid.uuid4().hex[:10]}",
            "ambassador_user_id": amb_id,
            "order_id": o["id"],
            "buyer_user_id": o["user_id"],
            "subtotal_nzd": o["total_nzd"],
            "commission_nzd": round(o["total_nzd"] * 0.05, 2),
            "currency": "NZD",
            "status": "released",
            "placed_at": o["created_at"],
            "locked_at": o["created_at"] + timedelta(days=7),
            "released_at": o["created_at"] + timedelta(days=8),
        })
    if sales_rows:
        await db.ambassador_sales.insert_many(sales_rows)
    print(f"[seed] inserted {len(sales_rows)} ambassador_sales rows")

    print()
    print("=" * 70)
    print(f"Ambassador login → {AMB_EMAIL} / {AMB_PASSWORD}")
    print(f"Code            → {AMB_CODE}")
    print(f"Dashboard URL   → /ambassadors/dashboard")
    print("Top channels    → instagram (10 clicks, 6 unique, 3 orders, 30.0%)")
    print("                  whatsapp  (5 clicks,  4 unique, 1 order,  20.0%)")
    print("                  direct    (3 clicks,  3 unique, 1 order,  33.3%)")
    print("Unpaid IG order should NOT be reflected in the conversion count.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
