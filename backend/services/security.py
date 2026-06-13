"""Brute-force lockout & rate-limiting helpers backed by Mongo.

Kept dependency-free (no Redis required) so it works in any Emergent deployment.
All state lives in two small TTL-indexed collections:

* ``login_attempts``  — per-email failed-login tracker for account lockout
* ``ip_rate_limit``   — per-IP per-endpoint counter for short-window throttling
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Optional

from fastapi import HTTPException, Request
from pymongo import ASCENDING

from db import db
from utils import now_utc

logger = logging.getLogger("allsale.security")

# Tunables ------------------------------------------------------------------
MAX_FAILED_LOGINS = 5  # failed attempts within window triggers lockout
LOCKOUT_MINUTES = 15  # how long the account stays locked
FAILED_LOGIN_WINDOW_MINUTES = 15  # how far back to count failures

IP_RATE_LIMIT_REQUESTS = 10  # per IP per endpoint per minute
IP_RATE_LIMIT_WINDOW_SECONDS = 60

_indexes_ready = False


async def ensure_security_indexes() -> None:
    """Create the TTL + lookup indexes needed by the helpers below."""
    global _indexes_ready
    if _indexes_ready:
        return
    # login_attempts: TTL by expires_at, lookup by email
    await db.login_attempts.create_index(
        [("expires_at", ASCENDING)], expireAfterSeconds=0
    )
    await db.login_attempts.create_index([("email", ASCENDING)])
    # ip_rate_limit: TTL by expires_at, compound lookup
    await db.ip_rate_limit.create_index(
        [("expires_at", ASCENDING)], expireAfterSeconds=0
    )
    await db.ip_rate_limit.create_index(
        [("ip", ASCENDING), ("endpoint", ASCENDING)]
    )
    _indexes_ready = True


def client_ip(request: Request) -> str:
    """Best-effort client IP behind Cloudflare / proxies."""
    return (
        request.headers.get("cf-connecting-ip")
        or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


async def enforce_login_lockout(email: str) -> None:
    """Raise 429 if the email has too many recent failed login attempts."""
    await ensure_security_indexes()
    window_start = now_utc() - timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES)
    failures = await db.login_attempts.count_documents(
        {"email": email, "at": {"$gte": window_start}}
    )
    if failures >= MAX_FAILED_LOGINS:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Too many failed login attempts. Account temporarily locked. "
                f"Please try again in {LOCKOUT_MINUTES} minutes or reset your password."
            ),
        )


async def record_failed_login(email: str) -> None:
    """Log a failed attempt; auto-expires from Mongo via TTL."""
    await ensure_security_indexes()
    await db.login_attempts.insert_one(
        {
            "email": email,
            "at": now_utc(),
            "expires_at": now_utc() + timedelta(minutes=LOCKOUT_MINUTES),
        }
    )


async def clear_login_attempts(email: str) -> None:
    """Wipe the failure log for an email after a successful login."""
    await db.login_attempts.delete_many({"email": email})


async def enforce_ip_rate_limit(
    request: Request,
    endpoint: str,
    *,
    max_requests: int = IP_RATE_LIMIT_REQUESTS,
    window_seconds: int = IP_RATE_LIMIT_WINDOW_SECONDS,
) -> None:
    """Throttle a given (ip, endpoint) pair to N requests per window."""
    await ensure_security_indexes()
    ip = client_ip(request)
    window_start = now_utc() - timedelta(seconds=window_seconds)
    count = await db.ip_rate_limit.count_documents(
        {"ip": ip, "endpoint": endpoint, "at": {"$gte": window_start}}
    )
    if count >= max_requests:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please slow down and try again shortly.",
        )
    await db.ip_rate_limit.insert_one(
        {
            "ip": ip,
            "endpoint": endpoint,
            "at": now_utc(),
            "expires_at": now_utc() + timedelta(seconds=window_seconds * 2),
        }
    )
