"""Setup helper for iter-9 UI tests: creates a buyer + delivered order eligible
for return. Prints TOKEN and ORDER_ID to stdout so the playwright script can
inject them via localStorage.
"""
import asyncio
import os
import time
from datetime import datetime, timedelta, timezone

import requests
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "allsale_database")
BASE_URL = "https://allsale-shop.preview.emergentagent.com"


def _address():
    return {
        "full_name": "UI Return Tester",
        "phone": "+64211234567",
        "line1": "1 Queen St",
        "city": "Auckland",
        "region": "Auckland",
        "postcode": "1010",
        "country": "New Zealand",
    }


def main():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    suffix = int(time.time())
    email = f"TEST_ui_rtn_{suffix}@allsale.co.nz"

    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "Test1234!", "full_name": "UI Tester"})
    r.raise_for_status()
    data = r.json()
    token = data["access_token"]
    user_id = data["user"]["id"]
    s.headers["Authorization"] = f"Bearer {token}"

    products = s.get(f"{BASE_URL}/api/products").json()
    p = products[0]
    s.post(f"{BASE_URL}/api/cart", json={"product_id": p["id"], "quantity": 1})
    r = s.post(f"{BASE_URL}/api/checkout/session",
               json={"address": _address(), "origin_url": BASE_URL})
    r.raise_for_status()
    order_id = r.json()["order_id"]

    async def force_delivered():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        now = datetime.now(timezone.utc)
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "status": "delivered",
                "payment_status": "paid",
                "paid_at": now - timedelta(days=2),
                "delivered_at": now - timedelta(days=1),
                "return_window_until": now + timedelta(days=6),
            }},
        )
        # Insert a shipment so /order/[id] renders the Tracking card.
        awb = f"SR_UI_{suffix}"
        await db.shipments.insert_one({
            "id": f"shp_ui_{suffix}",
            "order_id": order_id,
            "user_id": user_id,
            "carrier": "Shiprocket X",
            "awb_code": awb,
            "tracking_url": f"https://shiprocket.co/tracking/{awb}",
            "status": "delivered",
            "estimated_delivery": "10 Jun 2026",
            "is_mocked": False,
            "created_at": now,
        })
        await db.orders.update_one({"id": order_id}, {"$set": {"awb_code": awb}})
        cli.close()

    asyncio.run(force_delivered())

    print(f"TOKEN={token}")
    print(f"ORDER_ID={order_id}")
    print(f"USER_ID={user_id}")
    print(f"EMAIL={email}")


if __name__ == "__main__":
    main()
