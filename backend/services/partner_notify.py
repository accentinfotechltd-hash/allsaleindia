"""Partner notification dispatch.

When an admin marks a financing application as ``submitted_to_partner``,
we attempt to notify the NBFC via:

1. Signed HTTPS webhook (preferred) — POST with HMAC-SHA256 header
2. Email via Resend (if configured)

Both are best-effort and idempotent. We record on the application doc:

  partner_notified_at: datetime    — when we tried
  partner_notification_status: str — "sent" | "skipped_no_channel" | "failed"
  partner_notification_error: str  — optional error message

Webhook configuration (env vars):
  ALLSALE_WEBHOOK_SECRET           — HMAC signing key (shared with partners)
  KREDX_WEBHOOK_URL / KREDX_INTAKE_EMAIL
  CASHINVOICE_WEBHOOK_URL / CASHINVOICE_INTAKE_EMAIL
  FLEXILOANS_WEBHOOK_URL / FLEXILOANS_INTAKE_EMAIL

Any partner without both a webhook URL *and* an intake email results in a
"skipped_no_channel" record. Failures don't break the admin status update.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from typing import Optional

import httpx

from db import db
from utils import now_utc

logger = logging.getLogger("allsale.partner_notify")

# Resend is optional; if unavailable we skip email gracefully.
try:
    import resend  # type: ignore

    _RESEND_AVAILABLE = True
except Exception:  # pragma: no cover
    _RESEND_AVAILABLE = False


def _partner_channels(partner_id: str) -> tuple[Optional[str], Optional[str]]:
    """Return (webhook_url, intake_email) for the given partner id."""
    key = partner_id.upper()
    return (
        os.getenv(f"{key}_WEBHOOK_URL"),
        os.getenv(f"{key}_INTAKE_EMAIL"),
    )


def _sign(payload: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


async def _send_webhook(url: str, app: dict) -> dict:
    secret = os.getenv("ALLSALE_WEBHOOK_SECRET") or "dev-allsale-webhook-secret"
    body = {
        "event": "financing.submitted_to_partner",
        "application_id": app["id"],
        "partner_id": app["partner_id"],
        "partner_name": app["partner_name"],
        "seller_email": app.get("user_email"),
        "seller_tier": app.get("seller_tier"),
        "desired_advance_nzd": float(app.get("desired_advance_nzd") or 0),
        "monthly_invoices_inr": app.get("monthly_invoices_inr"),
        "business_age_months": app.get("business_age_months"),
        "notes": app.get("notes"),
        "submitted_at": now_utc().isoformat(),
    }
    payload = json.dumps(body, separators=(",", ":"), default=str)
    sig = _sign(payload, secret)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Allsale/Partner-Notify",
        "X-Allsale-Signature": sig,
        "X-Allsale-Event": body["event"],
        "X-Allsale-Timestamp": str(int(time.time())),
    }
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(url, content=payload, headers=headers)
    return {"status_code": r.status_code, "text": (r.text or "")[:300]}


def _send_email(to_addr: str, app: dict) -> dict:
    if not _RESEND_AVAILABLE:
        return {"skipped": True, "reason": "resend_not_installed"}
    api_key = os.getenv("RESEND_API_KEY")
    from_addr = os.getenv("RESEND_FROM_EMAIL")
    if not api_key or not from_addr:
        return {"skipped": True, "reason": "resend_not_configured"}
    resend.api_key = api_key  # type: ignore[attr-defined]
    html = f"""
      <h2>New financing application from Allsale</h2>
      <p><strong>Partner:</strong> {app['partner_name']}</p>
      <p><strong>Seller:</strong> {app.get('user_email')}</p>
      <p><strong>Tier:</strong> {app.get('seller_tier')}</p>
      <p><strong>Desired advance:</strong> NZD
         {float(app.get('desired_advance_nzd') or 0):,.2f}</p>
      <p><strong>Monthly invoices:</strong> ₹{(app.get('monthly_invoices_inr') or 'N/A')}</p>
      <p><strong>Business age:</strong> {app.get('business_age_months') or 'N/A'} months</p>
      <p><strong>Application ID:</strong> {app['id']}</p>
      <p><strong>Notes from seller:</strong><br>{app.get('notes') or '—'}</p>
    """
    try:
        resp = resend.Emails.send(
            {  # type: ignore[attr-defined]
                "from": from_addr,
                "to": [to_addr],
                "subject": f"[Allsale] New financing app — {app['partner_name']}",
                "html": html,
            }
        )
        return {"sent": True, "id": (resp or {}).get("id")}
    except Exception as e:  # pragma: no cover — best-effort
        return {"error": str(e)[:300]}


async def notify_partner_submitted(application_id: str) -> dict:
    """Best-effort partner notification. Idempotent — won't re-notify if
    ``partner_notified_at`` is already set on the application.

    Returns a small status dict for logging / admin UI display.
    """
    app = await db.financing_applications.find_one({"id": application_id}, {"_id": 0})
    if not app:
        return {"skipped": True, "reason": "not_found"}
    if app.get("partner_notified_at"):
        return {"skipped": True, "reason": "already_notified"}

    webhook_url, intake_email = _partner_channels(app["partner_id"])
    if not webhook_url and not intake_email:
        await db.financing_applications.update_one(
            {"id": application_id},
            {
                "$set": {
                    "partner_notified_at": now_utc(),
                    "partner_notification_status": "skipped_no_channel",
                    "partner_notification_error": None,
                }
            },
        )
        return {"status": "skipped_no_channel"}

    webhook_result: dict = {}
    email_result: dict = {}
    errors: list[str] = []

    if webhook_url:
        try:
            webhook_result = await _send_webhook(webhook_url, app)
            if int(webhook_result.get("status_code", 0)) >= 400:
                errors.append(
                    f"webhook {webhook_result['status_code']}: "
                    f"{webhook_result.get('text', '')}"
                )
        except Exception as e:
            errors.append(f"webhook_exception: {str(e)[:200]}")

    if intake_email:
        try:
            email_result = _send_email(intake_email, app)
            if email_result.get("error"):
                errors.append(f"email_error: {email_result['error']}")
        except Exception as e:
            errors.append(f"email_exception: {str(e)[:200]}")

    # Success if at least one channel reported OK
    webhook_ok = (
        webhook_url is not None
        and 200 <= int(webhook_result.get("status_code", 0)) < 400
    )
    email_ok = bool(email_result.get("sent"))
    final_status = "sent" if (webhook_ok or email_ok) else "failed"

    await db.financing_applications.update_one(
        {"id": application_id},
        {
            "$set": {
                "partner_notified_at": now_utc(),
                "partner_notification_status": final_status,
                "partner_notification_error": "; ".join(errors)[:600] or None,
                "partner_notification_channels": {
                    "webhook_url_used": bool(webhook_url),
                    "intake_email_used": bool(intake_email),
                    "webhook_status_code": webhook_result.get("status_code"),
                    "email_sent": email_ok,
                },
            }
        },
    )
    logger.info(
        "partner_notify %s status=%s errors=%s",
        application_id,
        final_status,
        errors,
    )
    return {
        "status": final_status,
        "errors": errors,
        "webhook": webhook_result,
        "email": email_result,
    }
