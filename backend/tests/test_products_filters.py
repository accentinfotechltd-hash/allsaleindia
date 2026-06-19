"""Regression tests for the /products filter fixes (June 2026 mobile-agent
heads-up): seller_id, on_sale, new, bestseller, ambassador_pick were all
silently no-ops before — verify each one now narrows the result set as
expected and unknown seller_ids return [] (not "the entire catalogue")."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone


def _db():
    """Direct Motor handle (we use it to seed checks against the DB)."""
    from db import db
    return db


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_unknown_seller_id_returns_empty(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"seller_id": "does-not-exist", "limit": 5})
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_known_seller_id_returns_only_their_products(api_client, base_url):
    seller = _run(_db().users.find_one({"is_seller": True}, {"_id": 0, "id": 1}))
    assert seller is not None, "Need at least one seller seeded"
    sid = seller["id"]

    r = api_client.get(f"{base_url}/api/products", params={"seller_id": sid, "limit": 200})
    assert r.status_code == 200
    items = r.json()
    for p in items:
        assert p.get("seller_id") == sid


def test_new_filter_only_recent(api_client, base_url):
    """`?new=true` must apply the 30-day cutoff. Since the Product response
    model strips `created_at`, we verify the filter fires by sampling
    returned IDs back against Mongo and confirming each is within 30 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    r = api_client.get(f"{base_url}/api/products", params={"new": "true", "limit": 50})
    assert r.status_code == 200
    items = r.json()
    if not items:
        return  # nothing recent in DB → pass silently
    ids = [p["id"] for p in items[:25]]

    async def _check():
        violations = []
        async for p in _db().products.find(
            {"id": {"$in": ids}}, {"_id": 0, "id": 1, "created_at": 1}
        ):
            ts = p.get("created_at")
            if ts is None:
                continue
            # Mongo returns naive UTC datetimes — normalise both sides.
            ts_utc = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
            if ts_utc < cutoff - timedelta(seconds=2):
                violations.append((p["id"], ts_utc.isoformat()))
        return violations

    bad = _run(_check())
    assert not bad, f"`new=true` returned products older than 30 days: {bad[:3]}"


def test_bestseller_filter_only_high_rated(api_client, base_url):
    r = api_client.get(f"{base_url}/api/products", params={"bestseller": "true", "limit": 50})
    assert r.status_code == 200
    for p in r.json():
        assert (p.get("rating") or 0) >= 4.0
        assert (p.get("reviews_count") or 0) >= 50


def test_on_sale_filter_intersects_flash_sales(api_client, base_url):
    now = datetime.now(timezone.utc)
    active_count = _run(
        _db().flash_sales.count_documents(
            {"active": True, "valid_from": {"$lte": now}, "valid_to": {"$gte": now}}
        )
    )
    if active_count == 0:
        return  # nothing on sale right now → skip silently

    r = api_client.get(f"{base_url}/api/products", params={"on_sale": "true", "limit": 50})
    assert r.status_code == 200
    items = r.json()

    async def _active_pids():
        return {
            fs["product_id"]
            async for fs in _db().flash_sales.find(
                {"active": True, "valid_from": {"$lte": now}, "valid_to": {"$gte": now}},
                {"_id": 0, "product_id": 1},
            )
        }

    active_pids = _run(_active_pids())
    for p in items:
        assert p["id"] in active_pids


def test_ambassador_pick_empty_returns_empty(api_client, base_url):
    """Collection is empty in the seed DB → must return [] (not full catalog)."""
    cnt = _run(_db().ambassador_picks.count_documents({"active": {"$ne": False}}))
    r = api_client.get(f"{base_url}/api/products", params={"ambassador_pick": "true", "limit": 50})
    assert r.status_code == 200
    items = r.json()
    if cnt == 0:
        assert items == []
    else:
        async def _pick_pids():
            return {
                ap["product_id"]
                async for ap in _db().ambassador_picks.find(
                    {"active": {"$ne": False}}, {"_id": 0, "product_id": 1}
                )
            }
        picked = _run(_pick_pids())
        for p in items:
            assert p["id"] in picked


def test_combined_filters_intersect(api_client, base_url):
    """bestseller=true & seller_id=X must AND, not silently drop one."""
    seller = _run(_db().users.find_one({"is_seller": True}, {"_id": 0, "id": 1}))
    sid = seller["id"]
    r = api_client.get(
        f"{base_url}/api/products",
        params={"seller_id": sid, "bestseller": "true", "limit": 50},
    )
    assert r.status_code == 200
    for p in r.json():
        assert p["seller_id"] == sid
        assert (p.get("rating") or 0) >= 4.0
        assert (p.get("reviews_count") or 0) >= 50
