"""Seed a couple of low-stock + out-of-stock products for the verified seller
so the UI banner and LowStockAlerts section have something to render.

Idempotent: matches by `id` prefix `TEST_LOWSTOCK_`.
"""
import asyncio
import uuid
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "allsale_database"
SELLER_ID = "user_f37c688bce13"  # verified-seller@example.com


async def main():
    cli = AsyncIOMotorClient(MONGO_URL)
    db = cli[DB_NAME]
    await db.products.delete_many({"id": {"$regex": "^TEST_LOWSTOCK_"}})
    docs = [
        {
            "id": f"TEST_LOWSTOCK_OUT_{uuid.uuid4().hex[:6]}",
            "name": "TEST Out-of-stock Saree",
            "image": "https://placehold.co/200x200/png",
            "seller_id": SELLER_ID,
            "price_nzd": 49.0,
            "stock_count": 0,
            "in_stock": True,
            "category": "fashion",
            "view_count": 5,
            "cart_add_count": 1,
        },
        {
            "id": f"TEST_LOWSTOCK_LOW_{uuid.uuid4().hex[:6]}",
            "name": "TEST Low-stock Spice Box",
            "image": "https://placehold.co/200x200/png",
            "seller_id": SELLER_ID,
            "price_nzd": 19.0,
            "stock_count": 4,
            "in_stock": True,
            "category": "food",
            "view_count": 12,
            "cart_add_count": 3,
        },
    ]
    await db.products.insert_many(docs)
    cnt = await db.products.count_documents({"id": {"$regex": "^TEST_LOWSTOCK_"}})
    print(f"Seeded {cnt} low-stock products for seller {SELLER_ID}")
    cli.close()


if __name__ == "__main__":
    asyncio.run(main())
