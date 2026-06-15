"""Email helper using Resend.

Centralises Resend usage so screens don't have to know about the SDK.
Gracefully degrades to a "skipped" result when Resend isn't configured
(missing API key / from email, or the SDK not installed).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger("allsale.email")

try:
    import resend  # type: ignore

    _RESEND_AVAILABLE = True
except Exception:  # pragma: no cover
    _RESEND_AVAILABLE = False


def email_config_status() -> dict:
    """Returns a small diagnostics dict (used by the admin smoke-test page)."""
    api_key = os.getenv("RESEND_API_KEY")
    from_addr = os.getenv("RESEND_FROM_EMAIL")
    return {
        "sdk_installed": _RESEND_AVAILABLE,
        "api_key_set": bool(api_key),
        "api_key_preview": (api_key[:6] + "…") if api_key else None,
        "from_address": from_addr,
        "ready": bool(_RESEND_AVAILABLE and api_key and from_addr),
    }


def send_email(
    to: str,
    subject: str,
    html: str,
    *,
    text: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> dict:
    """Send one transactional email. Returns a small status dict."""
    if not _RESEND_AVAILABLE:
        return {"sent": False, "skipped": True, "reason": "resend_not_installed"}
    api_key = os.getenv("RESEND_API_KEY")
    from_addr = os.getenv("RESEND_FROM_EMAIL")
    if not api_key or not from_addr:
        return {"sent": False, "skipped": True, "reason": "resend_not_configured"}
    resend.api_key = api_key  # type: ignore[attr-defined]
    payload: dict = {
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        resp = resend.Emails.send(payload)  # type: ignore[attr-defined]
        return {"sent": True, "id": (resp or {}).get("id")}
    except Exception as e:  # pragma: no cover — best-effort
        logger.warning("Resend send failed: %s", e)
        return {"sent": False, "error": str(e)[:400]}
