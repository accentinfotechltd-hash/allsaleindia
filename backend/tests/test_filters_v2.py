"""Tests for the new buyer-side filters: gender, age_group, sizes, colors."""
import os
from pathlib import Path

import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


def _get(params: str = "") -> list[dict]:
    r = requests.get(f"{BASE_URL}/api/products{params}")
    assert r.status_code == 200, r.text
    return r.json()


def test_gender_women_returns_only_womens_clothing():
    items = _get("?gender=women")
    assert items, "should have at least one Women's Clothing product"
    assert all(p["category"] == "Women's Clothing" for p in items)


def test_gender_men_returns_only_mens_clothing():
    items = _get("?gender=men")
    assert items
    assert all(p["category"] == "Men's Clothing" for p in items)


def test_gender_kids_returns_only_kids_fashion():
    items = _get("?gender=kids")
    assert items
    assert all(p["category"] == "Kids' Fashion" for p in items)


def test_size_filter_returns_matching_sku():
    items = _get("?category=Women%27s+Clothing&sizes=L")
    assert any("L" in p.get("sizes", []) for p in items)


def test_multiple_sizes_filter():
    """A size filter with multiple values is an OR — match items that have ANY of them."""
    items = _get("?category=Women%27s+Clothing&sizes=XS&sizes=L")
    for p in items:
        assert any(s in p.get("sizes", []) for s in ("XS", "L"))


def test_color_filter_is_case_insensitive():
    items_lower = _get("?colors=black")
    items_upper = _get("?colors=Black")
    items_mixed = _get("?colors=BLACK")
    assert len(items_lower) == len(items_upper) == len(items_mixed)
    assert all(
        any(c.lower() == "black" for c in p.get("colors", []))
        for p in items_lower
    )


def test_age_group_kids_returns_kids_fashion():
    items = _get("?age_group=kids")
    assert items
    assert all(p["category"] == "Kids' Fashion" for p in items)


def test_taxonomy_excludes_hidden_categories():
    """`/api/taxonomy` must NOT include Food & Groceries / Wellness anymore."""
    r = requests.get(f"{BASE_URL}/api/taxonomy")
    assert r.status_code == 200
    names = {n["name"] for n in r.json()}
    assert "Food & Groceries" not in names
    assert "Wellness" not in names
    # Heritage + new global categories present
    assert "Ethnic Fashion" in names
    assert "Women's Clothing" in names


def test_products_endpoint_excludes_hidden_categories():
    """`/api/products` must NOT surface any product whose category is hidden."""
    items = _get("")
    hidden_cats = {"Food & Groceries", "Wellness"}
    for p in items:
        assert p.get("category") not in hidden_cats, (
            f"hidden product leaked into buyer catalog: {p['name']}"
        )


def test_explicit_hidden_category_query_returns_empty():
    """Even if a buyer probes for a hidden category by name, return []."""
    items = _get("?category=Food+%26+Groceries")
    assert items == []
    items = _get("?category=Wellness")
    assert items == []
