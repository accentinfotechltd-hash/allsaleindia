"""Admin operations (payouts, seller approval). Guarded by x-admin-secret header."""
from __future__ import annotations

from typing import Annotated, Optional, List

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr

from config import ADMIN_SECRET
from db import db
from models import Payout
from services.admin_auth import (
    authenticate_admin,
    get_current_admin,
    log_admin_action,
    _create_admin_token,
)
from utils import now_utc

router = APIRouter(tags=["admin"])


def _require(secret: str | None) -> None:
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/admin/overview")
async def admin_overview(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    """One-call dashboard summary."""
    _require(x_admin_secret)
    users = await db.users.count_documents({})
    sellers = await db.users.count_documents({"is_seller": True})
    products = await db.products.count_documents({})
    orders = await db.orders.count_documents({"payment_status": "paid"})
    pending_payouts = await db.payouts.count_documents(
        {"status": {"$in": ["held", "available", "reserve_held", "pending"]}}
    )
    pending_sellers = await db.users.count_documents(
        {"is_seller": True, "seller_verification_status": "pending"}
    )
    open_returns = await db.returns.count_documents(
        {"status": {"$in": ["requested", "approved"]}}
    )
    # Revenue (paid orders, sum of total_nzd)
    revenue = 0.0
    async for o in db.orders.find(
        {"payment_status": "paid"}, {"_id": 0, "total_nzd": 1}
    ):
        revenue += float(o.get("total_nzd") or 0)
    return {
        "users": users,
        "sellers": sellers,
        "products": products,
        "orders_paid": orders,
        "revenue_nzd": round(revenue, 2),
        "pending_payouts": pending_payouts,
        "pending_sellers": pending_sellers,
        "open_returns": open_returns,
    }


@router.get("/admin/sellers")
async def admin_list_sellers(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    _require(x_admin_secret)
    out = []
    async for u in db.users.find(
        {"is_seller": True},
        {"_id": 0, "id": 1, "email": 1, "full_name": 1, "seller_verification_status": 1, "country": 1, "created_at": 1},
    ).sort("created_at", -1).limit(100):
        sp = await db.sellers.find_one(
            {"user_id": u["id"]}, {"_id": 0, "company_name": 1, "city": 1}
        )
        out.append({**u, "company_name": (sp or {}).get("company_name"), "city": (sp or {}).get("city")})
    return out


@router.get("/admin/orders")
async def admin_list_orders(
    limit: int = 50,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    _require(x_admin_secret)
    limit = max(1, min(int(limit), 200))
    out = []
    async for o in db.orders.find(
        {}, {"_id": 0, "id": 1, "user_id": 1, "total_nzd": 1, "status": 1, "payment_status": 1, "buyer_country": 1, "created_at": 1}
    ).sort("created_at", -1).limit(limit):
        out.append(o)
    return out


@router.get("/admin/payouts")
async def admin_list_payouts(
    status: Optional[str] = None,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    _require(x_admin_secret)
    q = {"status": status} if status else {}
    out = []
    async for p in db.payouts.find(q, {"_id": 0}).sort("created_at", -1).limit(100):
        out.append(p)
    return out


@router.post("/admin/payouts/{payout_id}/mark-paid", response_model=Payout)
async def admin_mark_payout_paid(
    payout_id: str,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    po = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Payout not found")
    if po.get("status") == "paid_out":
        return Payout(**po)
    if po.get("status") not in {"available", "pending"}:
        raise HTTPException(
            status_code=400,
            detail=f"Payout is {po.get('status')} — not yet eligible for payout. "
            "It must be 'available' first.",
        )
    await db.payouts.update_one(
        {"id": payout_id},
        {"$set": {"status": "paid_out", "paid_out_at": now_utc()}},
    )
    fresh = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    # Best-effort payout-sent email to the seller
    try:
        from services.email import send_email

        seller = await db.users.find_one(
            {"id": fresh.get("seller_id")}, {"_id": 0, "email": 1, "full_name": 1}
        )
        if seller and seller.get("email"):
            send_email(
                seller["email"],
                f"Payout sent — NZD {fresh.get('net_payable_nzd', 0):.2f}",
                f"""<div style='font-family:system-ui,sans-serif;padding:24px;background:#f8fafc;color:#0f172a'>
                <h1 style='color:#10b981;margin:0 0 8px'>💰 Payout on its way</h1>
                <p>Hi {seller.get('full_name') or 'there'}, we&#39;ve just sent your payout of
                <strong>NZD {fresh.get('net_payable_nzd', 0):.2f}</strong>
                for order #{fresh.get('order_id', '').replace('order_', '')[:8].upper()}.</p>
                <p>It should reflect in your bank account within 1-3 business days.</p>
                <p style='color:#64748b;font-size:12px;margin-top:24px'>Allsale — Indian Bazaar</p></div>""",
            )
    except Exception:
        pass
    return Payout(**fresh)


@router.post("/admin/payouts/process-due")
async def admin_process_due_payouts(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    """Cron-callable. Promote ``held`` → ``available`` / ``reserve_held``,
    and release matured reserves back into ``available``."""
    _require(x_admin_secret)
    from services.payouts import release_due_payouts

    return await release_due_payouts()


# ---------------------------------------------------------------------------
# Email diagnostics — used after Resend DNS verification.
# ---------------------------------------------------------------------------
class _TestEmailBody(BaseModel):
    to: str
    subject: Optional[str] = "Allsale Resend test ✉️"


@router.get("/admin/email/status")
async def admin_email_status(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    """Returns Resend config diagnostics (no secrets leaked)."""
    _require(x_admin_secret)
    from services.email import email_config_status

    return email_config_status()


@router.post("/admin/email/test")
async def admin_email_test(
    body: _TestEmailBody,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    """Send a one-off test email through Resend to verify domain + DNS."""
    _require(x_admin_secret)
    from services.email import send_email

    html = (
        "<div style='font-family:system-ui,sans-serif;padding:24px;"
        "background:#f8fafc;color:#0f172a'>"
        "<h2 style='margin:0 0 12px;color:#7c3aed'>Allsale ✓ Resend wired up</h2>"
        "<p>This is a test email sent from your Allsale backend via "
        "Resend. If you can read it, your <strong>shop.allsale.co.nz</strong> "
        "DNS is verified and transactional email is fully working.</p>"
        "<p style='font-size:12px;color:#64748b;margin-top:24px'>"
        "Sent from Allsale admin → Email diagnostics</p></div>"
    )
    result = send_email(body.to, body.subject or "Allsale Resend test", html)
    if not result.get("sent") and not result.get("skipped"):
        # Surface the error message back to the admin tool
        raise HTTPException(status_code=502, detail=result.get("error", "send failed"))
    return result


@router.post("/admin/sellers/{user_id}/approve")
async def admin_approve_seller(
    user_id: str,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    res1 = await db.users.update_one(
        {"id": user_id, "is_seller": True},
        {"$set": {"seller_verification_status": "approved"}},
    )
    if res1.matched_count == 0:
        raise HTTPException(status_code=404, detail="Seller not found")
    await db.sellers.update_one(
        {"user_id": user_id},
        {"$set": {"verification_status": "approved", "approved_at": now_utc()}},
    )
    # In-app notification (best-effort)
    try:
        from services.notifications import create_notification
        await create_notification(
            user_id,
            title="Seller application approved 🎉",
            body="Your Allsale seller account is now active. Start listing products!",
            link="/seller/dashboard",
        )
    except Exception:
        pass
    return {"approved": True}


class SellerRejectRequest(BaseModel):
    reason: str


@router.post("/admin/sellers/{user_id}/reject")
async def admin_reject_seller(
    user_id: str,
    body: SellerRejectRequest,
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    reason = (body.reason or "").strip() or "Application did not meet our requirements."
    res = await db.users.update_one(
        {"id": user_id, "is_seller": True},
        {"$set": {"seller_verification_status": "rejected"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Seller not found")
    await db.sellers.update_one(
        {"user_id": user_id},
        {"$set": {
            "verification_status": "rejected",
            "rejected_at": now_utc(),
            "rejection_reason": reason,
        }},
    )
    try:
        from services.notifications import create_notification
        await create_notification(
            user_id,
            title="Seller application update",
            body=f"Your seller application was not approved. Reason: {reason}",
            link="/seller/onboarding",
        )
    except Exception:
        pass
    return {"rejected": True, "reason": reason}


@router.get("/admin/sellers/pending")
async def admin_list_pending_sellers(
    x_admin_secret: Annotated[Optional[str], Header()] = None,
):
    """List sellers awaiting review (pending_review) sorted by SLA urgency."""
    if x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    from datetime import timedelta, timezone
    now = now_utc()
    sla_cutoff = now - timedelta(days=7)
    out = []
    async for s in db.sellers.find(
        {"verification_status": "pending_review"}, {"_id": 0}
    ).sort("submitted_at", 1):
        submitted = s.get("submitted_at")
        if submitted is not None and submitted.tzinfo is None:
            submitted = submitted.replace(tzinfo=timezone.utc)
        overdue = bool(submitted and submitted < sla_cutoff)
        user = await db.users.find_one(
            {"id": s["user_id"]},
            {"_id": 0, "email": 1, "full_name": 1, "country": 1},
        )
        out.append({
            "user_id": s["user_id"],
            "email": (user or {}).get("email"),
            "full_name": (user or {}).get("full_name"),
            "country": (user or {}).get("country"),
            "company_name": s.get("company_name"),
            "business_type": s.get("business_type"),
            "gstin": s.get("gstin"),
            "pan": s.get("pan"),
            "id_proof_url": s.get("id_proof_url"),
            "business_proof_url": s.get("business_proof_url"),
            "submitted_at": submitted,
            "sla_days_remaining": max(
                0, 7 - (now - submitted).days
            ) if submitted else None,
            "overdue": overdue,
        })
    return {"sellers": out, "total": len(out)}


# ============================================================================
# Owner / Sub-admin login (JWT-based, replaces x-admin-secret going forward)
# ============================================================================
class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/admin/login")
async def admin_login(body: AdminLoginRequest):
    """Owner / sub-admin login. Returns short-lived JWT (8 hr TTL)."""
    admin = await authenticate_admin(body.email, body.password)
    token = _create_admin_token(admin["id"], admin.get("role", "owner"))
    await log_admin_action(admin["id"], "login")
    return {
        "access_token": token,
        "token_type": "bearer",
        "admin": {
            "id": admin["id"],
            "email": admin["email"],
            "full_name": admin.get("full_name"),
            "role": admin.get("role", "owner"),
        },
    }


@router.get("/admin/me")
async def admin_me(admin=Depends(get_current_admin)):
    return {
        "id": admin["id"],
        "email": admin["email"],
        "full_name": admin.get("full_name"),
        "role": admin.get("role", "owner"),
        "last_login_at": admin.get("last_login_at"),
    }


@router.get("/admin/activity-log")
async def admin_activity_log(limit: int = 100, admin=Depends(get_current_admin)):
    limit = max(1, min(int(limit), 500))
    out = []
    async for row in db.admin_activity_log.find({}, {"_id": 0}).sort("at", -1).limit(limit):
        actor = await db.admin_users.find_one(
            {"id": row["admin_id"]}, {"_id": 0, "email": 1, "full_name": 1}
        )
        row["actor_email"] = (actor or {}).get("email", "(deleted admin)")
        out.append(row)
    return {"events": out, "total": len(out)}


@router.get("/admin/users")
async def admin_list_users(limit: int = 100, admin=Depends(get_current_admin)):
    """Owner-only: list all buyer/seller user accounts (read-only)."""
    limit = max(1, min(int(limit), 500))
    out = []
    async for u in db.users.find(
        {}, {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).limit(limit):
        out.append(u)
    return {"users": out, "total": len(out)}
