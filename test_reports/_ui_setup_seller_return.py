"""Setup seller for iter-9 UI tests:
- creates a fresh buyer + delivered order
- creates a fresh seller, makes them the owner of the order's product
- submits a defective return request as the buyer
Prints SELLER_TOKEN, ORDER_ID, RETURN_ID for the playwright UI test.
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


def _register(email):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/register",
               json={"email": email, "password": "Test1234!", "full_name": "UI Tester"})
    r.raise_for_status()
    d = r.json()
    s.headers["Authorization"] = f"Bearer {d['access_token']}"
    return s, d["access_token"], d["user"]["id"]


def main():
    suffix = int(time.time())
    buyer_s, _, buyer_id = _register(f"TEST_ui_buyer_{suffix}@allsale.co.nz")
    seller_s, seller_token, seller_id = _register(f"TEST_ui_seller_{suffix}@allsale.co.nz")

    products = buyer_s.get(f"{BASE_URL}/api/products").json()
    p = products[0]
    buyer_s.post(f"{BASE_URL}/api/cart", json={"product_id": p["id"], "quantity": 1})
    r = buyer_s.post(f"{BASE_URL}/api/checkout/session",
                     json={"address": _address(), "origin_url": BASE_URL})
    r.raise_for_status()
    order_id = r.json()["order_id"]

    async def go():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        now = datetime.now(timezone.utc)
        # Promote seller in Mongo
        await db.users.update_one({"id": seller_id},
            {"$set": {"is_seller": True, "seller_verification_status": "auto_verified"}})
        unique_suffix = seller_id[-6:].upper()
        try:
            await db.sellers.insert_one({
                "user_id": seller_id,
                "business_type": "private_limited",
                "company_name": f"UI Seller {unique_suffix}",
                "gstin": f"07AAA{unique_suffix[:3]}1234A1Z5"[:15].ljust(15, "X"),
                "pan": f"AAA{unique_suffix[:3]}1234A"[:10],
                "address_line1": "10 Test Rd",
                "city": "Mumbai", "state": "Maharashtra", "pincode": "400001",
                "contact_name": "Tester", "contact_phone": "+919811112222",
                "verification_status": "auto_verified",
                "created_at": datetime.now(timezone.utc),
            })
        except Exception as e:
            print(f"sellers insert: {e}")
        # Relink product → seller, and order's item.seller_id
        await db.products.update_one({"id": p["id"]},
            {"$set": {"seller_id": seller_id, "seller_name": "UI Seller Co"}})
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "status": "delivered",
                "payment_status": "paid",
                "paid_at": now - timedelta(days=2),
                "delivered_at": now - timedelta(days=1),
                "return_window_until": now + timedelta(days=6),
                "items.$[elem].seller_id": seller_id,
            }},
            array_filters=[{"elem.product_id": p["id"]}],
        )
        cli.close()

    asyncio.run(go())

    # Buyer files a defective return
    r = buyer_s.post(f"{BASE_URL}/api/returns/request",
                    json={"order_id": order_id, "reason": "defective", "note": "Won't power on"})
    r.raise_for_status()
    rtn = r.json()[0]
    print(f"SELLER_TOKEN={seller_token}")
    print(f"SELLER_ID={seller_id}")
    print(f"ORDER_ID={order_id}")
    print(f"RETURN_ID={rtn['id']}")


if __name__ == "__main__":
    main()
