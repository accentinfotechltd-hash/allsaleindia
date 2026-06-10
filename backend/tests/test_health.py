"""Health and meta endpoints."""
import requests


def test_root_health(base_url, api_client):
    r = api_client.get(f"{base_url}/api/")
    assert r.status_code == 200
    body = r.json()
    assert body.get("app") == "Allsale"
    assert body.get("status") == "ok"
    assert body.get("currency") == "NZD"
