"""Backend tests for Wishlist Collections — Bulk Move (Jan 2026)

Covers:
- POST /api/wishlist/collections (create)
- GET  /api/wishlist/collections
- POST /api/wishlist/{product_id} (add items)
- PATCH /api/wishlist/items/{product_id} (move to collection / back to all saved)
- GET  /api/wishlist?collection_id=... (filter)
- GET  /api/wishlist (all)
- Edge cases: PATCH with non-existent collection / product
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
                    break
    except FileNotFoundError:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
assert BASE_URL, "BASE_URL not configured"

BUYER_EMAIL = "buyer@example.com"
BUYER_PASSWORD = "Buyer2026!"


@pytest.fixture(scope="module")
def buyer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": BUYER_EMAIL, "password": BUYER_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(buyer_token):
    return {"Authorization": f"Bearer {buyer_token}"}


@pytest.fixture(scope="module")
def sample_product_ids():
    r = requests.get(f"{BASE_URL}/api/products?limit=5", timeout=15)
    assert r.status_code == 200
    data = r.json()
    if isinstance(data, dict):
        items = data.get("items") or data.get("products") or []
    else:
        items = data
    ids = [p["id"] for p in items[:3]]
    assert len(ids) >= 3, f"need 3 products, got {ids}"
    return ids


@pytest.fixture(scope="module")
def diwali_collection(headers):
    # Cleanup any pre-existing "Diwali TEST" collections to keep idempotent
    existing = requests.get(
        f"{BASE_URL}/api/wishlist/collections", headers=headers, timeout=15
    ).json()
    for c in existing.get("collections", []):
        if c["name"] == "Diwali TEST":
            requests.delete(
                f"{BASE_URL}/api/wishlist/collections/{c['id']}",
                headers=headers,
                timeout=15,
            )

    r = requests.post(
        f"{BASE_URL}/api/wishlist/collections",
        json={"name": "Diwali TEST"},
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 201, f"{r.status_code} {r.text}"
    data = r.json()
    assert "id" in data
    assert data["name"] == "Diwali TEST"
    assert data["item_count"] == 0
    yield data
    # teardown
    requests.delete(
        f"{BASE_URL}/api/wishlist/collections/{data['id']}",
        headers=headers,
        timeout=15,
    )


class TestCollectionsCRUD:
    def test_create_collection_returns_id(self, diwali_collection):
        assert diwali_collection["id"].startswith("wlc_")

    def test_list_collections_includes_new(self, headers, diwali_collection):
        r = requests.get(
            f"{BASE_URL}/api/wishlist/collections", headers=headers, timeout=15
        )
        assert r.status_code == 200
        body = r.json()
        assert "all_saved_count" in body
        assert "collections" in body
        names = [c["name"] for c in body["collections"]]
        assert "Diwali TEST" in names


class TestMoveFlow:
    def test_seed_wishlist_items(self, headers, sample_product_ids):
        # Clear any leftover wishlist first so counts are predictable
        for pid in sample_product_ids:
            requests.delete(
                f"{BASE_URL}/api/wishlist/{pid}", headers=headers, timeout=15
            )
        # Now add 3
        for pid in sample_product_ids:
            r = requests.post(
                f"{BASE_URL}/api/wishlist/{pid}", headers=headers, timeout=15
            )
            assert r.status_code == 201, f"{pid}: {r.status_code} {r.text}"

        # Verify via GET
        r = requests.get(f"{BASE_URL}/api/wishlist", headers=headers, timeout=15)
        assert r.status_code == 200
        pids_in_wl = {it["product_id"] for it in r.json()}
        for pid in sample_product_ids:
            assert pid in pids_in_wl

    def test_patch_move_item_to_collection(
        self, headers, sample_product_ids, diwali_collection
    ):
        pid = sample_product_ids[0]
        r = requests.patch(
            f"{BASE_URL}/api/wishlist/items/{pid}",
            json={"collection_id": diwali_collection["id"]},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["product_id"] == pid
        assert body["collection_id"] == diwali_collection["id"]

    def test_move_second_item_to_collection(
        self, headers, sample_product_ids, diwali_collection
    ):
        pid = sample_product_ids[1]
        r = requests.patch(
            f"{BASE_URL}/api/wishlist/items/{pid}",
            json={"collection_id": diwali_collection["id"]},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200

    def test_filter_by_collection_id_returns_only_those(
        self, headers, sample_product_ids, diwali_collection
    ):
        r = requests.get(
            f"{BASE_URL}/api/wishlist?collection_id={diwali_collection['id']}",
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200
        ids = {it["product_id"] for it in r.json()}
        # The two moved ones should be in there
        assert sample_product_ids[0] in ids
        assert sample_product_ids[1] in ids
        # The unmoved 3rd should NOT
        assert sample_product_ids[2] not in ids

    def test_collection_count_updated_on_collections_list(
        self, headers, diwali_collection
    ):
        r = requests.get(
            f"{BASE_URL}/api/wishlist/collections", headers=headers, timeout=15
        )
        body = r.json()
        match = next(
            c for c in body["collections"] if c["id"] == diwali_collection["id"]
        )
        assert match["item_count"] == 2

    def test_empty_collection_id_returns_all(self, headers, sample_product_ids):
        # Empty string should be treated like None (or at least return all)
        r = requests.get(
            f"{BASE_URL}/api/wishlist?collection_id=", headers=headers, timeout=15
        )
        assert r.status_code == 200
        ids = {it["product_id"] for it in r.json()}
        # All three should be visible (collection_id="" is not a real collection)
        # Note: backend currently uses `Optional[str]=None` so empty string is a STRING.
        # If filter matches collection_id == "" literal, returns 0.  We assert
        # both branches and let the test surface the real behaviour.
        # Spec says "empty string treated as None" so should return all.
        for pid in sample_product_ids:
            assert pid in ids, (
                f"GET /api/wishlist?collection_id= should return all items "
                f"(treat empty as None) but {pid} missing"
            )

    def test_get_wishlist_no_filter_returns_all(self, headers, sample_product_ids):
        r = requests.get(f"{BASE_URL}/api/wishlist", headers=headers, timeout=15)
        assert r.status_code == 200
        ids = {it["product_id"] for it in r.json()}
        for pid in sample_product_ids:
            assert pid in ids

    def test_patch_move_item_back_to_all_saved(
        self, headers, sample_product_ids, diwali_collection
    ):
        pid = sample_product_ids[0]
        r = requests.patch(
            f"{BASE_URL}/api/wishlist/items/{pid}",
            json={"collection_id": None},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["collection_id"] is None

        # Verify only 1 item left in the collection
        r2 = requests.get(
            f"{BASE_URL}/api/wishlist?collection_id={diwali_collection['id']}",
            headers=headers,
            timeout=15,
        )
        ids = {it["product_id"] for it in r2.json()}
        assert pid not in ids
        assert sample_product_ids[1] in ids


class TestEdgeCases:
    def test_patch_nonexistent_collection_returns_404(
        self, headers, sample_product_ids
    ):
        pid = sample_product_ids[2]
        r = requests.patch(
            f"{BASE_URL}/api/wishlist/items/{pid}",
            json={"collection_id": "wlc_does_not_exist_zzz"},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 404, f"{r.status_code} {r.text}"

    def test_patch_product_not_in_wishlist_returns_404(
        self, headers, diwali_collection
    ):
        # Use a guaranteed-not-in-wishlist product id
        r = requests.patch(
            f"{BASE_URL}/api/wishlist/items/prd_not_in_wl_zzz999",
            json={"collection_id": diwali_collection["id"]},
            headers=headers,
            timeout=15,
        )
        assert r.status_code == 404


class TestCleanup:
    def test_cleanup_wishlist(self, headers, sample_product_ids):
        for pid in sample_product_ids:
            requests.delete(
                f"{BASE_URL}/api/wishlist/{pid}", headers=headers, timeout=15
            )
