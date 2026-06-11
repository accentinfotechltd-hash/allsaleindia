"""Seed two listings (stock_count=0 OOS + stock_count=3 low-stock) for UI."""
import asyncio
import time
import requests
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient

BASE = "https://allsale-shop.preview.emergentagent.com"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"


def register():
    suffix = int(time.time() * 1000)
    email = f"TEST_stkui_{suffix}@allsale.co.nz"
    r = requests.post(f"{BASE}/api/auth/register", json={
        "email": email, "password": "Test1234!", "full_name": "Stock UI",
    })
    r.raise_for_status()
    d = r.json()
    return d["user"]["id"], d["access_token"]


async def promote(uid):
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    suf = uid[-6:].upper()
    await db.users.update_one({"id": uid}, {"$set": {"is_seller": True, "seller_verification_status": "auto_verified"}})
    await db.sellers.update_one({"user_id": uid}, {"$set": {
        "user_id": uid,
        "business_type": "private_limited",
        "company_name": f"Stock UI {suf}",
        "gstin": f"07AAA{suf[:3]}1234A1Z5"[:15].ljust(15, "X"),
        "pan": f"AAA{suf[:3]}1234A"[:10],
        "address_line1": "1 Test", "city": "Mumbai", "state": "Maharashtra",
        "pincode": "400001", "contact_name": "T", "contact_phone": "+919811112222",
        "verification_status": "auto_verified", "created_at": datetime.now(timezone.utc),
    }}, upsert=True)
    cli.close()


def list_product(token, **fields):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {
        "name": fields.get("name", "TEST listing"),
        "description": "Stock UI test listing description for verification.",
        "category": "Fashion",
        "price_nzd": 25.0,
        "image": "https://images.unsplash.com/photo-x",
        **fields,
    }
    r = requests.post(f"{BASE}/api/seller/products", headers=headers, json=body)
    r.raise_for_status()
    return r.json()


if __name__ == "__main__":
    uid, tok = register()
    asyncio.run(promote(uid))
    p_oos = list_product(tok, name="TEST OOS UI", stock_count=0)
    p_low = list_product(tok, name="TEST low-stock UI", stock_count=3, colors=["Indigo"], sizes=["M"])
    print("OOS_ID=", p_oos["id"])
    print("LOW_ID=", p_low["id"])
