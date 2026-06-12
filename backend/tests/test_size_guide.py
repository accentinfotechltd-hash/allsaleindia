"""Tests for /api/size-guide endpoints."""
import os
from pathlib import Path

import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break


def test_full_size_guide_lists_all_categories():
    r = requests.get(f"{BASE_URL}/api/size-guide")
    assert r.status_code == 200
    data = r.json()
    assert data["countries"] == ["US", "UK", "EU", "AU", "NZ", "CA", "IN"]
    ids = {t["id"] for t in data["categories"]}
    assert {
        "womens_apparel",
        "mens_apparel",
        "kids_apparel",
        "shoes_womens",
        "shoes_mens",
        "heritage_blouse",
        "heritage_lehenga",
        "rings",
        "bangles",
    } <= ids


def test_filter_by_category_returns_relevant_tables_only():
    r = requests.get(f"{BASE_URL}/api/size-guide?category=Women%27s+Clothing")
    data = r.json()
    assert [t["id"] for t in data["categories"]] == ["womens_apparel"]


def test_ethnic_fashion_returns_heritage_charts_and_womens():
    r = requests.get(f"{BASE_URL}/api/size-guide?category=Ethnic+Fashion")
    data = r.json()
    ids = [t["id"] for t in data["categories"]]
    # Women's chart + saree blouse + lehenga
    assert "womens_apparel" in ids
    assert "heritage_blouse" in ids
    assert "heritage_lehenga" in ids


def test_shoes_returns_both_genders_by_default():
    r = requests.get(f"{BASE_URL}/api/size-guide?category=Shoes")
    data = r.json()
    ids = [t["id"] for t in data["categories"]]
    assert "shoes_womens" in ids and "shoes_mens" in ids


def test_shoes_with_gender_filter_narrows_table():
    r = requests.get(f"{BASE_URL}/api/size-guide?category=Shoes&gender=women")
    data = r.json()
    ids = [t["id"] for t in data["categories"]]
    assert ids == ["shoes_womens"]


def test_recommend_women_apparel_returns_size_M():
    r = requests.get(
        f"{BASE_URL}/api/size-guide/recommend",
        params={"kind": "apparel", "bust_cm": 92, "waist_cm": 74, "hip_cm": 100, "gender": "women"},
    )
    data = r.json()
    assert data["match"]["label"] == "M"
    assert data["match"]["NZ"] == "12-14"
    assert data["match"]["IN"] == "40-42"


def test_recommend_men_apparel_chest_picks_L():
    r = requests.get(
        f"{BASE_URL}/api/size-guide/recommend",
        params={"kind": "apparel", "chest_cm": 103, "gender": "men"},
    )
    data = r.json()
    assert data["match"]["label"] == "L"


def test_recommend_shoes_foot_24cm_women():
    r = requests.get(
        f"{BASE_URL}/api/size-guide/recommend",
        params={"kind": "shoes", "foot_cm": 24, "gender": "women"},
    )
    data = r.json()
    assert data["match"]["label"] == "8"
    assert data["match"]["IN"] == "39"


def test_recommend_shoes_foot_27cm_men():
    r = requests.get(
        f"{BASE_URL}/api/size-guide/recommend",
        params={"kind": "shoes", "foot_cm": 27, "gender": "men"},
    )
    data = r.json()
    assert data["match"]["label"] in ("9", "10")  # 27.0 is the US 9 row


def test_recommend_kids_by_height():
    r = requests.get(
        f"{BASE_URL}/api/size-guide/recommend",
        params={"kind": "kids", "height_cm": 100},
    )
    data = r.json()
    assert data["match"]["label"] == "3-4Y"


def test_recommend_returns_null_when_no_match():
    r = requests.get(
        f"{BASE_URL}/api/size-guide/recommend",
        params={"kind": "apparel", "bust_cm": 200},  # absurd outlier
    )
    data = r.json()
    assert data["match"] is None


def test_single_table_endpoint():
    r = requests.get(f"{BASE_URL}/api/size-guide/womens_apparel")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == "womens_apparel"
    assert len(data["rows"]) == 7  # XS through 3XL


def test_jewelry_ring_chart_has_us_uk_eu_in_columns():
    r = requests.get(f"{BASE_URL}/api/size-guide?category=Jewelry+%26+Accessories")
    data = r.json()
    ids = [t["id"] for t in data["categories"]]
    assert "rings" in ids and "bangles" in ids
    rings = next(t for t in data["categories"] if t["id"] == "rings")
    col_keys = {c["key"] for c in rings["columns"]}
    assert {"US", "UK", "EU", "IN"} <= col_keys
