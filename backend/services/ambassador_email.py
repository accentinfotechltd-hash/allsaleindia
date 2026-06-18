"""Email templates for the Ambassador Approval Flow.

Five touchpoints, all sent via Resend (see ``services.email.send_email``):

  1. ``send_application_received``       — applicant, fires on /join
  2. ``send_new_application_to_admin``   — admin/owner, fires on /join
  3. ``send_terms_accepted``             — applicant, fires on /accept-terms
  4. ``send_application_approved``       — applicant, fires on /approve
  5. ``send_application_rejected``       — applicant, fires on /reject

All templates are inline (no external service / no template IDs needed).
Variables are interpolated via simple ``str.format`` calls so the templates
stay readable. Each helper returns the dict from ``send_email`` so callers
can log the outcome.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime

from services.email import send_email

logger = logging.getLogger("allsale.ambassadors.email")

# ---------------------------------------------------------------------------
# Shared brand snippet — kept tiny so we can render in any inbox.
# ---------------------------------------------------------------------------
_BRAND = "Allsale Indian Bazaar"
_FOOTER = """
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
<p style="color:#9ca3af;font-size:12px;line-height:18px">
  {brand} &middot; Cross-border Indian shopping &middot;
  <a href="https://allsale.co.nz" style="color:#9ca3af">allsale.co.nz</a><br>
  You're receiving this because you applied to the Allsale Ambassador Programme.
</p>
""".strip()


def _wrap(html_body: str) -> str:
    """Light HTML wrapper — keeps inline-styling so it renders in Gmail/Outlook."""
    return (
        '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,'
        'Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;'
        'color:#111827;line-height:1.55">'
        + html_body
        + _FOOTER.format(brand=_BRAND)
        + "</div>"
    )


# ---------------------------------------------------------------------------
# 1. Application received  (sent to applicant immediately after join)
# ---------------------------------------------------------------------------
def send_application_received(to: str, name: str, code: str,
                              code_b2b: str | None = None) -> dict:
    subject = "✨ Your Allsale Ambassador application is in review"
    codes_html = f"<p><strong>Your code:</strong> {code}</p>"
    if code_b2b:
        codes_html += f"<p><strong>Your B2B code:</strong> {code_b2b}</p>"
    html = _wrap(
        f"<h2 style='margin:0 0 12px;font-size:22px'>Welcome, {name}!</h2>"
        "<p>Thanks for applying to join the Allsale Ambassador Programme. "
        "We've received your application and our team will review it within "
        "<strong>2 business days</strong>.</p>"
        + codes_html
        + "<p style='color:#6b7280'>Your code is <strong>not active yet</strong>. "
        "We'll email you the moment it goes live.</p>"
        "<p>In the meantime, please review and accept our Ambassador Terms — "
        "you can do that from the dashboard inside the Allsale app.</p>"
    )
    return send_email(to, subject, html)


# ---------------------------------------------------------------------------
# 2. New application to review  (sent to admin/owner)
# ---------------------------------------------------------------------------
def send_new_application_to_admin(applicant_name: str, applicant_email: str,
                                  country: str, social_handle: str | None,
                                  primary_platform: str | None,
                                  code: str) -> dict:
    """BCC-style nudge to the owner admin. The recipient is whatever's in
    ``OWNER_ADMIN_EMAIL`` env (already used elsewhere in the codebase)."""
    admin_email = os.getenv("OWNER_ADMIN_EMAIL")
    if not admin_email:
        logger.info("OWNER_ADMIN_EMAIL not set — skipping admin notify")
        return {"sent": False, "skipped": True, "reason": "no_admin_email"}
    subject = f"🆕 New ambassador application: {applicant_name}"
    html = _wrap(
        "<h2 style='margin:0 0 12px;font-size:20px'>New ambassador application</h2>"
        "<table style='border-collapse:collapse;width:100%'>"
        f"<tr><td style='padding:6px 0;color:#6b7280;width:40%'>Name</td>"
        f"<td style='padding:6px 0'><strong>{applicant_name}</strong></td></tr>"
        f"<tr><td style='padding:6px 0;color:#6b7280'>Email</td>"
        f"<td style='padding:6px 0'>{applicant_email}</td></tr>"
        f"<tr><td style='padding:6px 0;color:#6b7280'>Country</td>"
        f"<td style='padding:6px 0'>{country}</td></tr>"
        f"<tr><td style='padding:6px 0;color:#6b7280'>Social</td>"
        f"<td style='padding:6px 0'>{social_handle or '—'} on {primary_platform or '—'}</td></tr>"
        f"<tr><td style='padding:6px 0;color:#6b7280'>Code</td>"
        f"<td style='padding:6px 0;font-family:monospace'><strong>{code}</strong></td></tr>"
        "</table>"
        "<p style='margin-top:16px'>"
        '<a href="https://allsale.co.nz/admin/ambassagers" '
        'style="background:#EA580C;color:#fff;text-decoration:none;'
        'padding:10px 18px;border-radius:999px;font-weight:700">'
        "Review in admin ›</a></p>"
    )
    return send_email(admin_email, subject, html)


# ---------------------------------------------------------------------------
# 3. Terms accepted  (sent to applicant immediately after /accept-terms)
# ---------------------------------------------------------------------------
def send_terms_accepted(to: str, name: str, version: str) -> dict:
    subject = "✅ Allsale Ambassador Terms accepted"
    html = _wrap(
        f"<h2 style='margin:0 0 12px;font-size:20px'>Thanks, {name}.</h2>"
        f"<p>You accepted the Ambassador Programme Terms "
        f"(version <code>{version}</code>) on "
        f"{datetime.utcnow().strftime('%-d %B %Y')}.</p>"
        "<p>One step closer to going live! Your application is now "
        "awaiting final approval from our team.</p>"
    )
    return send_email(to, subject, html)


# ---------------------------------------------------------------------------
# 4. Application approved  (sent to applicant on /approve)
# ---------------------------------------------------------------------------
def send_application_approved(to: str, name: str, code: str,
                              code_b2b: str | None = None,
                              tier_label: str = "Starter",
                              rate_pct: float = 5.0) -> dict:
    subject = "🎉 You're an Allsale Ambassador — your code is LIVE"
    codes_html = (
        f"<div style='background:#F9FAFB;border:1px solid #E5E7EB;"
        f"border-radius:8px;padding:16px;margin:16px 0;text-align:center'>"
        f"<div style='color:#6b7280;font-size:11px;font-weight:700;"
        f"letter-spacing:1px;text-transform:uppercase'>Your code</div>"
        f"<div style='font-size:28px;font-weight:800;letter-spacing:3px;"
        f"margin-top:6px'>{code}</div>"
    )
    if code_b2b:
        codes_html += (
            f"<div style='margin-top:12px;color:#6b7280;font-size:11px;"
            f"font-weight:700;letter-spacing:1px;text-transform:uppercase'>"
            f"Your B2B code</div>"
            f"<div style='font-size:22px;font-weight:800;letter-spacing:3px;"
            f"margin-top:4px'>{code_b2b}</div>"
        )
    codes_html += "</div>"
    html = _wrap(
        f"<h2 style='margin:0 0 12px;font-size:22px'>Welcome aboard, {name}!</h2>"
        "<p>Your application has been approved. Your code is now live and "
        "ready to share — every order placed with it earns you commission.</p>"
        + codes_html +
        f"<p>You're at <strong>{tier_label} tier — {rate_pct:.0f}% per sale</strong>. "
        "Hit higher volume to unlock Gold (8%) and Platinum (12%).</p>"
        '<p style="margin-top:20px">'
        '<a href="https://allsale.co.nz/ambassadors/dashboard" '
        'style="background:#EA580C;color:#fff;text-decoration:none;'
        'padding:12px 22px;border-radius:999px;font-weight:700">'
        "Open dashboard ›</a></p>"
        "<p style='color:#6b7280;font-size:13px'>Remember to post at least "
        "<strong>4 times per month</strong> tagging "
        "<strong>@allsale.co.nz</strong> to stay on tier.</p>"
    )
    return send_email(to, subject, html)


# ---------------------------------------------------------------------------
# 5. Application rejected  (sent to applicant on /reject)
# ---------------------------------------------------------------------------
def send_application_rejected(to: str, name: str, reason: str,
                              can_reapply_at: datetime | None) -> dict:
    subject = "Your Allsale Ambassador application"
    reapply_html = ""
    if can_reapply_at:
        reapply_html = (
            "<p style='color:#6b7280;font-size:13px;background:#F9FAFB;"
            "padding:12px;border-radius:6px;border-left:3px solid #EA580C'>"
            "You're welcome to apply again after "
            f"<strong>{can_reapply_at.strftime('%-d %B %Y')}</strong> "
            "(30 days). Use the same email and we'll restart the review.</p>"
        )
    else:
        reapply_html = (
            "<p style='color:#6b7280;font-size:13px'>"
            "Unfortunately this decision is final.</p>"
        )
    html = _wrap(
        f"<h2 style='margin:0 0 12px;font-size:20px'>Hi {name},</h2>"
        "<p>Thanks for your interest in becoming an Allsale Ambassador. "
        "After review, we're unable to move forward with your application "
        "at this time.</p>"
        f"<p style='background:#FEF3C7;padding:12px;border-radius:6px;"
        f"color:#92400E;font-size:13px'><strong>Reason:</strong> {reason}</p>"
        + reapply_html
    )
    return send_email(to, subject, html)
