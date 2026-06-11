"""Iteration 7 — NZ cross-border features: taxonomy, duty estimator, prohibited checker."""
import pytest

# Three heritage categories still anchor the taxonomy. Food & Wellness are
# now buyer-hidden so they don't appear in /api/taxonomy. Books & Gifts,
# Jewelry & Accessories and Electronics live alongside the new global
# categories.
EXPECTED_HERITAGE = [
    ("Ethnic Fashion", ["Sarees", "Lehengas", "Kurtis", "Mens Wear", "Kids Wear"]),
    ("Home & Puja", ["Brass Items", "Wall Decor", "Kitchenware", "Idols", "Incense"]),
    ("Books & Gifts", ["Books", "Rakhis", "Diwali Gifts", "Wedding Favors"]),
]


# --- Taxonomy ----------------------------------------------------------------
def test_taxonomy_returns_full_catalog(api_client, base_url):
    r = api_client.get(f"{base_url}/api/taxonomy")
    assert r.status_code == 200
    nodes = r.json()
    assert isinstance(nodes, list)
    # Heritage + 15 new categories = 18, minus 2 hidden (Food, Wellness) = 18
    assert len(nodes) >= 18
    names = {n["name"] for n in nodes}
    # Heritage retained
    assert "Ethnic Fashion" in names
    assert "Home & Puja" in names
    # New global categories present
    for must_have in (
        "Women's Clothing",
        "Men's Clothing",
        "Kids' Fashion",
        "Shoes",
        "Bags & Luggage",
        "Home & Kitchen",
        "Beauty & Health",
        "Toys & Games",
        "Sports & Outdoors",
        "Pet Supplies",
        "Automotive",
        "Office & School Supplies",
        "Tools & Home Improvement",
    ):
        assert must_have in names, f"missing {must_have}"
    # Hidden categories should NOT appear in the buyer taxonomy
    assert "Food & Groceries" not in names
    assert "Wellness" not in names


@pytest.mark.parametrize("expected", EXPECTED_HERITAGE)
def test_taxonomy_heritage_subcategories(api_client, base_url, expected):
    nodes = api_client.get(f"{base_url}/api/taxonomy").json()
    name, subs = expected
    node = next((n for n in nodes if n["name"] == name), None)
    assert node, f"heritage node {name} missing"
    assert node["subcategories"] == subs
    assert node["key"]
    assert node["blurb"]


# --- Products with subcategory filter ----------------------------------------
def test_products_subcategory_filter_sarees(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"subcategory": "Sarees"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert all(p.get("subcategory") == "Sarees" for p in items)


def test_products_category_filter_ethnic_fashion(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"category": "Ethnic Fashion"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert all(p["category"] == "Ethnic Fashion" for p in items)


def test_products_search_q_still_works(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"q": "saree"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert any("saree" in p["name"].lower() for p in items)


def test_platform_seeded_products_count_nine(api_client, base_url):
    # June 2026 catalog: 9 heritage Indian products + 13 new global =
    # at least 9 platform-owned (food-and-wellness hidden from buyer view).
    r = api_client.get(f"{base_url}/api/products")
    items = r.json()
    platform = [p for p in items if not p.get("seller_id")]
    assert len(platform) >= 9, f"expected at least 9 platform-seeded items, got {len(platform)}"
    cats = {p["category"] for p in platform}
    # Heritage retained
    assert {"Ethnic Fashion", "Home & Puja"} <= cats
    # New global categories seeded too
    assert {"Women's Clothing", "Men's Clothing", "Electronics"} <= cats
    # Hidden categories should NOT appear in the buyer-facing list
    assert "Food & Groceries" not in cats
    assert "Wellness" not in cats


# --- Duty estimate -----------------------------------------------------------
def test_duty_under_threshold(api_client, base_url):
    body = {"items": [{"price_nzd": 80, "quantity": 2}], "shipping_nzd": 12}
    r = api_client.post(f"{base_url}/api/duty/estimate", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["goods_nzd"] == 160.0
    assert d["shipping_nzd"] == 12.0
    assert d["gst_nzd"] == 25.80
    assert d["duty_nzd"] == 0.0
    assert d["over_threshold"] is False
    assert d["grand_total_nzd"] == 197.80
    assert d["threshold_nzd"] == 1000.0


def test_duty_over_threshold(api_client, base_url):
    body = {"items": [{"price_nzd": 1500, "quantity": 1}], "shipping_nzd": 12}
    r = api_client.post(f"{base_url}/api/duty/estimate", json=body)
    assert r.status_code == 200
    d = r.json()
    assert d["goods_nzd"] == 1500.0
    assert d["shipping_nzd"] == 12.0
    assert d["gst_nzd"] == 226.80
    assert d["duty_nzd"] == 150.00
    assert d["over_threshold"] is True
    assert d["grand_total_nzd"] == 1888.80


def test_duty_empty_items(api_client, base_url):
    body = {"items": [], "shipping_nzd": 0}
    r = api_client.post(f"{base_url}/api/duty/estimate", json=body)
    assert r.status_code == 200
    d = r.json()
    assert d["goods_nzd"] == 0.0
    assert d["gst_nzd"] == 0.0
    assert d["duty_nzd"] == 0.0
    assert d["over_threshold"] is False


# --- Prohibited checker ------------------------------------------------------
@pytest.mark.parametrize("text,expected_term", [
    ("homemade laddu", "homemade"),
    ("fresh milk powder", "milk powder"),  # 'milk powder' or 'fresh' could match; first hit wins
    ("beef pickle", "beef"),
    ("seed pack", "seed"),
    ("honey jar", "honey"),
])
def test_prohibited_banned(api_client, base_url, text, expected_term):
    r = api_client.post(f"{base_url}/api/prohibited/check", json={"text": text})
    assert r.status_code == 200
    d = r.json()
    assert d["allowed"] is False, f"expected banned for {text!r}, got {d}"
    assert d["matched_term"] is not None
    assert d["reason"]


@pytest.mark.parametrize("text", ["sealed saree silk", "darjeeling tea"])
def test_prohibited_allowed(api_client, base_url, text):
    r = api_client.post(f"{base_url}/api/prohibited/check", json={"text": text})
    assert r.status_code == 200
    d = r.json()
    assert d["allowed"] is True, f"expected allowed for {text!r}, got {d}"
    assert d["matched_term"] in (None,)
    assert d["advice"]


def test_prohibited_empty_text(api_client, base_url):
    r = api_client.post(f"{base_url}/api/prohibited/check", json={"text": "   "})
    assert r.status_code == 200
    d = r.json()
    assert d["allowed"] is True
    assert d["advice"]
