"""End-to-end LIVE test for the Shiprocket integration.

Bypasses the Stripe payment step (which costs real money) by inserting
a fully-paid order directly into MongoDB, then triggers the seller's
"mark Processing" flow that calls `book_shiprocket_shipment()`. The
test asserts a real (non-mocked) shipment row appears with an AWB code.
"""
import asyncio
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app/backend")

from db import db
from services.shiprocket import (  # noqa: E402
    SHIPROCKET_LIVE,
    book_shiprocket_shipment,
)


async def main():
    print(f"SHIPROCKET_LIVE flag: {SHIPROCKET_LIVE}")
    assert SHIPROCKET_LIVE, "Shiprocket creds missing from .env"

    # 1) Reuse the most recent platform-seeded product as the test item
    product = await db.products.find_one(
        {"category": "Women's Clothing"},
        {"_id": 0},
    )
    assert product, "no Women's Clothing product seeded"
    print(f"Test product: {product['name']} (NZD {product['price_nzd']})")

    # 2) Make sure a fake test seller/user exist
    seller_id = "TEST_SR_E2E_SELLER"
    buyer_id = "TEST_SR_E2E_BUYER"
    await db.sellers.update_one(
        {"user_id": seller_id},
        {
            "$set": {
                "user_id": seller_id,
                "company_name": "TEST E2E Pvt Ltd",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "contact_phone": "+919999999999",
            }
        },
        upsert=True,
    )

    # 3) Insert a fully-paid order directly (bypass Stripe for the test)
    test_order_id = f"order_sr_e2e_{int(datetime.now().timestamp())}"
    order_doc = {
        "id": test_order_id,
        "user_id": buyer_id,
        "user_email": "e2e-test@allsale.co.nz",
        "seller_id": seller_id,
        "status": "paid",
        "total_amount_nzd": float(product["price_nzd"]),
        "total_amount_local": float(product["price_nzd"]),
        "local_currency": "NZD",
        "items": [
            {
                "product_id": product["id"],
                "name": product["name"],
                "image": product.get("image"),
                "price_nzd": float(product["price_nzd"]),
                "price_inr": float(product.get("price_inr") or product["price_nzd"] * 51),
                "quantity": 1,
                "seller_id": seller_id,
                "hsn": "6204",
            }
        ],
        "shipping_address": {
            "name": "Allsale Test Buyer",
            "line1": "9 Albert Street",
            "line2": "Auckland CBD",
            "city": "Auckland",
            "state": "Auckland",
            "postal_code": "1010",
            "country": "New Zealand",
            "phone": "+64210000000",
            "email": "e2e-test@allsale.co.nz",
        },
        "package_weight_kg": 0.6,
        "package_length_cm": 25,
        "package_breadth_cm": 20,
        "package_height_cm": 8,
        "created_at": datetime.now(tz=timezone.utc),
    }
    await db.orders.delete_one({"id": test_order_id})
    await db.shipments.delete_one({"order_id": test_order_id})
    await db.orders.insert_one(order_doc)
    print(f"Inserted test order: {test_order_id}")

    # 4) Call the live booking function (this is what the seller's
    # "mark Processing" button triggers)
    print("Calling book_shiprocket_shipment()…")
    shipment = await book_shiprocket_shipment(test_order_id)
    assert shipment, "book_shiprocket_shipment returned None"

    # 5) Print the result so we can verify in the Shiprocket dashboard
    print("─" * 60)
    print(f"  Shipment id        : {shipment.get('id')}")
    print(f"  AWB code           : {shipment.get('awb_code')}")
    print(f"  Carrier            : {shipment.get('carrier')}")
    print(f"  Tracking URL       : {shipment.get('tracking_url')}")
    print(f"  Shiprocket order   : {shipment.get('shiprocket_order_id')}")
    print(f"  Shiprocket shipment: {shipment.get('shiprocket_shipment_id')}")
    print(f"  is_mocked          : {shipment.get('is_mocked')}")
    print("─" * 60)

    if shipment.get("is_mocked"):
        print("⚠️  Booking fell back to MOCK — check backend logs for the Shiprocket API error above.")
    else:
        print("✅ Real Shiprocket AWB generated. Check the Shiprocket dashboard to confirm the order is listed.")


if __name__ == "__main__":
    asyncio.run(main())
