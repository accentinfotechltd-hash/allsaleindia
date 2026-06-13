"""Seed the platform catalog (products without a `seller_id`)."""
from __future__ import annotations

import logging
import os
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
    # ---------- New global taxonomy demo products (June 2026) ----------
    {
        "name": "Flowy Midi Summer Dress",
        "description": "Lightweight cotton midi dress with adjustable straps. Perfect for warm Auckland summers.",
        "category": "Women's Clothing", "subcategory": "Dresses",
        "price_nzd": 39.90,
        "image": "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800",
        "rating": 4.6, "reviews_count": 142,
    },
    {
        "name": "Men's Classic Oxford Shirt",
        "description": "Tailored-fit oxford in long staple cotton. Easy iron, all-day comfort.",
        "category": "Men's Clothing", "subcategory": "Tops",
        "price_nzd": 49.00,
        "image": "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=800",
        "rating": 4.7, "reviews_count": 211,
    },
    {
        "name": "Kids Cotton T-Shirt Pack (3)",
        "description": "Soft 100% cotton tees for everyday wear. Comes in three bright colours.",
        "category": "Kids' Fashion", "subcategory": "Boys Clothing",
        "price_nzd": 24.50,
        "image": "https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=800",
        "rating": 4.8, "reviews_count": 89,
    },
    {
        "name": "Lightweight Running Sneakers",
        "description": "Breathable knit upper with cushioned EVA midsole. Built for daily 5K runs.",
        "category": "Shoes", "subcategory": "Sports Shoes",
        "price_nzd": 79.00,
        "image": "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800",
        "rating": 4.7, "reviews_count": 526,
    },
    {
        "name": "Genuine Leather Crossbody Bag",
        "description": "Full-grain leather crossbody with adjustable strap and three internal compartments.",
        "category": "Bags & Luggage", "subcategory": "Women's Bags",
        "price_nzd": 89.00,
        "image": "https://images.unsplash.com/photo-1591561954557-26941169b49e?w=800",
        "rating": 4.8, "reviews_count": 174,
    },
    {
        "name": "Bluetooth Noise-Cancelling Earbuds",
        "description": "Active noise cancellation, 32-hour battery with case, USB-C fast charging.",
        "category": "Electronics", "subcategory": "Audio",
        "price_nzd": 99.00,
        "image": "https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=800",
        "rating": 4.6, "reviews_count": 902,
    },
    {
        "name": "Scandinavian Linen Bedding Set",
        "description": "100% French linen — duvet cover plus two pillowcases. Stone-washed for a relaxed look.",
        "category": "Home & Kitchen", "subcategory": "Bedding",
        "price_nzd": 149.00,
        "image": "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800",
        "rating": 4.9, "reviews_count": 320,
    },
    {
        "name": "Vitamin C Brightening Serum",
        "description": "20% Vitamin C with hyaluronic acid and ferulic acid. Cruelty-free, vegan formula.",
        "category": "Beauty & Health", "subcategory": "Skincare",
        "price_nzd": 34.50,
        "image": "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800",
        "rating": 4.7, "reviews_count": 612,
    },
    {
        "name": "Lego-Compatible 320-Piece Building Set",
        "description": "Build cars, robots and houses with this open-ended construction kit. Ages 5+.",
        "category": "Toys & Games", "subcategory": "Building Toys",
        "price_nzd": 29.90,
        "image": "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800",
        "rating": 4.8, "reviews_count": 154,
    },
    {
        "name": "Yoga Mat — Eco Cork 6mm",
        "description": "Non-slip cork surface on natural tree rubber base. Hand-wash, biodegradable.",
        "category": "Sports & Outdoors", "subcategory": "Exercise & Fitness",
        "price_nzd": 54.00,
        "image": "https://images.unsplash.com/photo-1591291621164-2c6367723315?w=800",
        "rating": 4.9, "reviews_count": 287,
    },
    {
        "name": "Dog Plush Memory-Foam Bed (Medium)",
        "description": "Orthopedic memory-foam dog bed with washable removable cover. Fits dogs up to 18kg.",
        "category": "Pet Supplies", "subcategory": "Dogs",
        "price_nzd": 69.00,
        "image": "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=800",
        "rating": 4.8, "reviews_count": 219,
    },
    {
        "name": "Premium Stationery Set — 8 piece",
        "description": "Fountain pen, refills, journal, sticky tabs and washi tape — boxed gift set.",
        "category": "Office & School Supplies", "subcategory": "Stationery",
        "price_nzd": 39.50,
        "image": "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800",
        "rating": 4.6, "reviews_count": 98,
    },
    {
        "name": "Cordless Drill Driver Kit — 20V",
        "description": "Brushless motor, 2 batteries, 30+ accessories. Includes hard storage case.",
        "category": "Tools & Home Improvement", "subcategory": "Power Tools",
        "price_nzd": 129.00,
        "image": "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800",
        "rating": 4.7, "reviews_count": 412,
    },
]


def _demo_extras(p: dict) -> dict:
    cat = (p.get("category") or "").lower()
    sub = (p.get("subcategory") or "").lower()
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
    # Global taxonomy (June 2026)
    if "women's clothing" in cat or "men's clothing" in cat:
        return {
            "colors": ["Black", "White", "Navy", "Olive"],
            "sizes": ["XS", "S", "M", "L", "XL", "XXL"],
            "stock_count": 35,
        }
    if "kids' fashion" in cat:
        return {
            "colors": ["Red", "Blue", "Yellow", "Green"],
            "sizes": ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-12Y"],
            "stock_count": 40,
        }
    if cat == "shoes":
        return {
            "colors": ["Black", "White", "Grey", "Navy"],
            "sizes": ["6", "7", "8", "9", "10", "11"],
            "stock_count": 22,
        }
    if "bags" in cat:
        return {"colors": ["Black", "Tan", "Cognac", "Burgundy"], "sizes": [], "stock_count": 18}
    if "home & kitchen" in cat:
        return {"colors": ["White", "Sand", "Charcoal"], "sizes": ["Single", "Queen", "King"], "stock_count": 25}
    if "beauty" in cat or "health" in cat:
        return {"colors": [], "sizes": ["30ml", "50ml", "100ml"], "stock_count": 80}
    if "electronics" in cat:
        return {"colors": ["Black", "White"], "sizes": [], "stock_count": 60}
    if "toys" in cat:
        return {"colors": [], "sizes": [], "stock_count": 45}
    if "sports" in cat:
        return {"colors": ["Black", "Purple", "Teal"], "sizes": [], "stock_count": 35}
    if "pet" in cat:
        return {"colors": ["Grey", "Beige"], "sizes": ["S", "M", "L"], "stock_count": 20}
    if "office" in cat:
        return {"colors": [], "sizes": [], "stock_count": 50}
    if "tools" in cat:
        return {"colors": [], "sizes": [], "stock_count": 25}
    return {"colors": [], "sizes": [], "stock_count": 25}


async def seed_products() -> None:
    """Idempotent reseed of platform-owned (no seller) products.

    Skipped entirely when ``DISABLE_SEED=1`` is set — this is the
    production safety guard so the live Atlas database never gets
    polluted with demo sarees/brass/idols. Real sellers add their own
    listings via the seller portal.

    Preserves per-product analytics counters (`view_count`, `cart_add_count`)
    across reseeds — looked up by product `name` so that the seller analytics
    dashboard isn't reset on every backend restart.
    """
    if os.environ.get("DISABLE_SEED", "").strip().lower() in {"1", "true", "yes"}:
        logger.info("DISABLE_SEED is set — skipping demo product seeding (production mode)")
        return

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
