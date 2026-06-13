"""Sign in with Apple — native iOS identity-token verification.

No Apple secret keys required for the native flow: we only need to validate
the RS256 identity token Apple hands the device, using their public JWKS.

MongoDB collection used: ``apple_jwks_cache`` is **not** used; keys are kept
in a module-level dict (sufficient for a single backend instance; if you
scale horizontally, every replica fetches its own copy — still tiny).
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Optional

import httpx
from fastapi import HTTPException
from jose import jwk, jwt
from jose.utils import base64url_decode  # noqa: F401  (jose pulls cryptography)

logger = logging.getLogger("allsale.apple_auth")

APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_AUDIENCE = "com.allsale.shop"  # must match ios.bundleIdentifier
JWKS_CACHE_SECONDS = 3600  # 1 hour

_keys_by_kid: Dict[str, Any] = {}
_keys_fetched_at: float = 0.0


async def _fetch_jwks() -> None:
    global _keys_by_kid, _keys_fetched_at
    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.get(APPLE_JWKS_URL)
        r.raise_for_status()
        data = r.json()
    keys: Dict[str, Any] = {}
    for k in data.get("keys", []):
        kid = k.get("kid")
        if not kid:
            continue
        keys[kid] = jwk.construct(k, algorithm="RS256")
    if not keys:
        raise HTTPException(
            status_code=503,
            detail="Apple JWKS returned no usable keys",
        )
    _keys_by_kid = keys
    _keys_fetched_at = time.time()
    logger.info("Apple JWKS refreshed (%d keys)", len(keys))


async def _get_key(kid: str) -> Optional[Any]:
    if not _keys_by_kid or (time.time() - _keys_fetched_at) > JWKS_CACHE_SECONDS:
        await _fetch_jwks()
    key = _keys_by_kid.get(kid)
    if key is None:
        # Possibly a brand-new key id — force one refresh.
        await _fetch_jwks()
        key = _keys_by_kid.get(kid)
    return key


async def verify_apple_identity_token(identity_token: str) -> Dict[str, Any]:
    """Verify Apple's RS256 identity token. Returns the decoded claims.

    Raises HTTP 401 on any verification failure.
    """
    try:
        header = jwt.get_unverified_header(identity_token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Bad Apple token header: {exc}")

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Apple token header missing 'kid'")

    key = await _get_key(kid)
    if key is None:
        raise HTTPException(
            status_code=401, detail="No matching Apple public key for token"
        )

    try:
        claims = jwt.decode(
            identity_token,
            key,
            algorithms=["RS256"],
            audience=APPLE_AUDIENCE,
            issuer=APPLE_ISSUER,
            options={"verify_at_hash": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Apple token has expired")
    except jwt.JWTClaimsError as e:
        raise HTTPException(status_code=401, detail=f"Apple token invalid claims: {e}")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Apple token verification failed: {e}")

    if not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Apple token missing subject")
    return claims
