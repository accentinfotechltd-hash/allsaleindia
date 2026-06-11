"""Set up a paid order in the 12-hour cancellation window for UI testing.

Prints two lines:
  TOKEN=<jwt>
  ORDER_ID=<id>

Usage: python /app/test_reports/_ui_setup_paid_order.py
"""
import asyncio
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE = "https://allsale-shop.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"

email = f"TEST_ui_iter8_{int(time.time()*1000)}@allsale.co.nz"
r = requests.post(
    f"{BASE}/api/auth/register",
    json={"email": email, "password": "Test1234!", "full_name": "UI Iter8 Tester"},
    timeout=15,
)
r.raise_for_status()
data = r.json()
token = data["access_token"]
user_id = data["user"]["id"]
headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}

products = requests.get(f"{BASE}/api/products", timeout=15).json()
p = products[0]
requests.post(f"{BASE}/api/cart", headers=headers, json={"product_id": p["id"], "quantity": 1}, timeout=15)

addr = {
    "full_name": "UI Iter8 Tester",
    "phone": "+64211234567",
    "line1": "1 Queen St",
    "city": "Auckland",
    "region": "Auckland",
    "postcode": "1010",
    "country": "New Zealand",
}
chk = requests.post(
    f"{BASE}/api/checkout/session",
    headers=headers,
    json={"address": addr, "origin_url": BASE},
    timeout=20,
)
chk.raise_for_status()
order_id = chk.json()["order_id"]


async def mark_paid():
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    paid_at = datetime.now(timezone.utc)
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "paid",
            "payment_status": "paid",
            "paid_at": paid_at,
            "cancellable_until": paid_at + timedelta(hours=12),
        }},
    )
    cli.close()

asyncio.run(mark_paid())
print(f"TOKEN={token}")
print(f"ORDER_ID={order_id}")
print(f"EMAIL={email}")
print(f"USER_ID={user_id}")
