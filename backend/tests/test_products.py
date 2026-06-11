"""Product & category endpoints."""


def test_list_products_returns_seeded(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products")
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    # Only count platform-owned (seed) products. Seller listings from prior iters may persist.
    platform = [p for p in items if not p.get("seller_id")]
    # June 2026 catalog: 9 heritage + 13 new global = 22 (minus any in
    # currently-hidden categories).
    assert len(platform) >= 9, f"expected at least 9 platform-seeded products, got {len(platform)}"
    p = platform[0]
    for key in ("id", "name", "price_nzd", "price_inr", "category", "image"):
        assert key in p
    assert p["price_inr"] > p["price_nzd"]  # INR should be ~51x


def test_list_categories(api_client, base_url):
    r = api_client.get(f"{base_url}/api/categories")
    assert r.status_code == 200
    cats = r.json()
    assert isinstance(cats, list)
    assert cats == sorted(cats)
    # Heritage + new global taxonomy categories should be present.
    assert {"Ethnic Fashion", "Home & Puja"} <= set(cats)
    assert {"Women's Clothing", "Men's Clothing"} <= set(cats)
    # Hidden categories should NOT appear here.
    assert "Food & Groceries" not in cats
    assert "Wellness" not in cats


def test_products_category_filter(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"category": "Ethnic Fashion"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert all(p["category"] == "Ethnic Fashion" for p in items)


def test_products_search_q(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"q": "saree"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) >= 1
    assert any("saree" in p["name"].lower() for p in items)


def test_get_product_by_id(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products")
    pid = r.json()[0]["id"]
    r2 = api_client.get(f"{base_url}/api/products/{pid}")
    assert r2.status_code == 200
    assert r2.json()["id"] == pid


def test_get_product_404(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products/does-not-exist")
    assert r.status_code == 404
