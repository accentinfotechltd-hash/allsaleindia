"""Seed the platform catalog (products without a `seller_id`)."""
from __future__ import annotations

import logging
import uuid

from config import INR_PER_NZD
from db import db

logger = logging.getLogger("allsale")

SEED_PRODUCTS: list[dict] = [
    # Ethnic Fashion → Sarees
    {
        "name": "Handwoven Silk Saree — Royal Maroon",
        "description": "Authentic Banarasi silk saree handwoven by artisans in Varanasi. Comes with matching blouse piece. Perfect for weddings and festive occasions.",
        "category": "Ethnic Fashion", "subcategory": "Sarees",
        "price_nzd": 89.00,
        "image": "https://images.unsplash.com/photo-1717585679395-bbe39b5fb6bc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
        "rating": 4.8, "reviews_count": 312,
    },
    {
        "name": "Embroidered Anarkali Suit Set",
        "description": "Three-piece Anarkali suit with intricate zari embroidery. Includes dupatta and bottoms. Imported directly from Jaipur.",
        "category": "Ethnic Fashion", "subcategory": "Kurtis",
        "price_nzd": 65.50,
        "image": "https://images.unsplash.com/photo-1503160865267-af4660ce7bf2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
        "rating": 4.7, "reviews_count": 184,
    },
    {
        "name": "Designer Lehenga Choli — Pastel Pink",
        "description": "Bridal-grade lehenga with mirror work and sequins. Three-piece set. Custom alterations available on request.",
        "category": "Ethnic Fashion", "subcategory": "Lehengas",
        "price_nzd": 149.00,
        "image": "https://images.pexels.com/photos/14928074/pexels-photo-14928074.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "rating": 4.9, "reviews_count": 92,
    },
    {
        "name": "Brass Ganesha Idol — 6 inch",
        "description": "Hand-cast brass Ganesha idol from Moradabad. Polished finish, weighs 850g. Perfect for home temple or as a gift.",
        "category": "Home & Puja", "subcategory": "Idols",
        "price_nzd": 42.00,
        "image": "https://images.unsplash.com/photo-1650383044645-5d32141ad1a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
        "rating": 4.9, "reviews_count": 207,
    },
    {
        "name": "Antique Brass Diya Set (Pack of 5)",
        "description": "Traditional oil lamps for Diwali and daily worship. Hand-engraved with floral motifs.",
        "category": "Home & Puja", "subcategory": "Brass Items",
        "price_nzd": 28.50,
        "image": "https://images.unsplash.com/photo-1652960018678-1f19799996c5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
        "rating": 4.6, "reviews_count": 145,
    },
    {
        "name": "Brass Pooja Thali Complete Set",
        "description": "Full pooja kit: thali, bell, incense holder, kalash and diya. Wedding gift favourite.",
        "category": "Home & Puja", "subcategory": "Kitchenware",
        "price_nzd": 56.00,
        "image": "https://images.pexels.com/photos/15755947/pexels-photo-15755947.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "rating": 4.8, "reviews_count": 78,
    },
    {
        "name": "Premium Darjeeling Tea — 250g",
        "description": "First-flush Darjeeling loose-leaf tea, sourced directly from Makaibari estate. Sealed, branded — MPI-compliant.",
        "category": "Food & Groceries", "subcategory": "Tea & Coffee",
        "price_nzd": 18.90,
        "image": "https://images.unsplash.com/photo-1623193893878-656ec0391ea1?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwyfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.9, "reviews_count": 524,
    },
    {
        "name": "Whole Spice Collection — 12 jars",
        "description": "Cardamom, cloves, turmeric, cumin, coriander, fenugreek and more. Air-tight commercial packs — MPI-compliant.",
        "category": "Food & Groceries", "subcategory": "Spices",
        "price_nzd": 47.00,
        "image": "https://images.unsplash.com/photo-1589536677029-c0aa1808fba6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.8, "reviews_count": 263,
    },
    {
        "name": "Masala Chai Blend — 500g",
        "description": "Strong Assam black tea blended with cardamom, ginger, clove and cinnamon. Sealed, branded.",
        "category": "Food & Groceries", "subcategory": "Tea & Coffee",
        "price_nzd": 22.50,
        "image": "https://images.unsplash.com/photo-1683533698664-12ee473e8c9d?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTN8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBzcGljZXMlMjB0ZWF8ZW58MHx8fHwxNzgxMTMyMjY5fDA&ixlib=rb-4.1.0&q=85",
        "rating": 4.7, "reviews_count": 318,
    },
]


def _demo_extras(p: dict) -> dict:
    cat = (p.get("category") or "").lower()
    name = (p.get("name") or "").lower()
    if (
        "fashion" in cat
        or "saree" in name
        or "kurti" in name
        or "kurta" in name
        or "shirt" in name
    ):
        colors = ["Indigo", "Maroon", "Saffron", "Emerald"]
        sizes = ["Free Size"] if "saree" in name else ["S", "M", "L", "XL"]
        return {"colors": colors, "sizes": sizes, "stock_count": 24}
    if "jewell" in cat or "jewelry" in cat:
        return {"colors": ["Gold", "Rose Gold", "Silver"], "sizes": [], "stock_count": 12}
    if "home" in cat or "puja" in cat or "brass" in name:
        return {"colors": ["Brass", "Antique Brass"], "sizes": [], "stock_count": 30}
    if "food" in cat or "grocer" in cat or "spice" in name or "tea" in name:
        return {"colors": [], "sizes": [], "stock_count": 100}
    return {"colors": [], "sizes": [], "stock_count": 25}


async def seed_products() -> None:
    """Idempotent reseed of platform-owned (no seller) products.

    Preserves per-product analytics counters (`view_count`, `cart_add_count`)
    across reseeds — looked up by product `name` so that the seller analytics
    dashboard isn't reset on every backend restart.
    """
    expected = len(SEED_PRODUCTS)
    existing = await db.products.count_documents({"seller_id": None})
    if existing == expected:
        for p in SEED_PRODUCTS:
            extras = _demo_extras(p)
            await db.products.update_many(
                {"seller_id": None, "name": p["name"]},
                {
                    "$set": {
                        "category": p["category"],
                        "subcategory": p["subcategory"],
                        "colors": extras["colors"],
                        "sizes": extras["sizes"],
                    }
                },
            )
            await db.products.update_many(
                {"seller_id": None, "name": p["name"], "stock_count": {"$exists": False}},
                {"$set": {"stock_count": extras["stock_count"], "in_stock": True}},
            )
        return

    # Snapshot counters keyed by product name so we can restore them after
    # the reseed (products are deleted + re-inserted with fresh UUIDs).
    counters_by_name: dict[str, dict] = {}
    async for old in db.products.find(
        {"seller_id": None},
        {"_id": 0, "name": 1, "view_count": 1, "cart_add_count": 1},
    ):
        n = old.get("name")
        if not n:
            continue
        counters_by_name[n] = {
            "view_count": int(old.get("view_count") or 0),
            "cart_add_count": int(old.get("cart_add_count") or 0),
        }

    await db.products.delete_many({"seller_id": None})
    docs = []
    for p in SEED_PRODUCTS:
        pid = str(uuid.uuid4())
        extras = _demo_extras(p)
        prev = counters_by_name.get(p["name"], {})
        docs.append(
            {
                "id": pid,
                "name": p["name"],
                "description": p["description"],
                "category": p["category"],
                "subcategory": p["subcategory"],
                "price_nzd": p["price_nzd"],
                "price_inr": round(p["price_nzd"] * INR_PER_NZD, 0),
                "image": p["image"],
                "images": [p["image"]],
                "rating": p.get("rating", 4.5),
                "reviews_count": p.get("reviews_count", 0),
                "in_stock": True,
                "stock_count": extras["stock_count"],
                "colors": extras["colors"],
                "sizes": extras["sizes"],
                "shipping_days_min": 7,
                "shipping_days_max": 12,
                "origin": "India",
                "seller_id": None,
                "seller_name": None,
                # Carry over per-product analytics counters so dashboards
                # don't reset on reseed.
                "view_count": prev.get("view_count", 0),
                "cart_add_count": prev.get("cart_add_count", 0),
            }
        )
    await db.products.insert_many(docs)
    logger.info(
        "seeded %d products across new taxonomy (carried over counters for %d)",
        len(docs),
        len(counters_by_name),
    )
