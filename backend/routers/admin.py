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
    require_roles,
    _create_admin_token,
)
from utils import now_utc

router = APIRouter(tags=["admin"])


def _require(secret: str | None) -> None:
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/admin/overview")
async def admin_overview(
    admin: dict = Depends(require_roles("manager", "support")),
):
    """One-call dashboard summary.  Available to any signed-in admin."""
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
    admin: dict = Depends(require_roles("manager", "support")),
):
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
    admin: dict = Depends(require_roles("manager", "support")),
):
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
    admin: dict = Depends(require_roles("manager")),
):
    q = {"status": status} if status else {}
    out = []
    async for p in db.payouts.find(q, {"_id": 0}).sort("created_at", -1).limit(100):
        out.append(p)
    return out


@router.post("/admin/payouts/{payout_id}/mark-paid", response_model=Payout)
async def admin_mark_payout_paid(
    payout_id: str,
    admin: dict = Depends(require_roles("manager")),
):
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
    admin: dict = Depends(require_roles("manager")),
):
    """Cron-callable. Promote ``held`` → ``available`` / ``reserve_held``,
    and release matured reserves back into ``available``."""
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
    admin: dict = Depends(require_roles("manager")),
):
    """Returns Resend config diagnostics (no secrets leaked)."""
    from services.email import email_config_status

    return email_config_status()


@router.post("/admin/email/test")
async def admin_email_test(
    body: _TestEmailBody,
    admin: dict = Depends(require_roles("manager")),
):
    """Send a one-off test email through Resend to verify domain + DNS."""
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
    admin: dict = Depends(require_roles("manager", "support")),
):
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
    admin: dict = Depends(require_roles("manager", "support")),
):
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
    admin: dict = Depends(require_roles("manager", "support")),
):
    """List sellers awaiting review (pending_review) sorted by SLA urgency."""
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
async def admin_list_users(
    limit: int = 50,
    skip: int = 0,
    search: Optional[str] = None,
    role: Optional[str] = None,
    admin=Depends(require_roles("manager", "support")),
):
    """List buyer/seller user accounts.

    Server-side pagination + optional search by email/full_name/company_name,
    and optional `role` filter ("buyer" | "seller").

    Response shape:
      {
        "users":  [...],        # current page
        "total":  <int>,        # total matching, ignoring pagination
        "limit":  <int>,        # echo of clamped limit
        "skip":   <int>,        # echo of skip
        "has_more": <bool>      # quick "next page available?" hint
      }
    """
    limit = max(1, min(int(limit), 200))
    skip = max(0, int(skip))

    query: dict = {}
    if role in ("buyer", "seller"):
        if role == "seller":
            query["is_seller"] = True
        else:
            # buyer = not a seller
            query["$or"] = [{"is_seller": {"$exists": False}}, {"is_seller": False}]

    if search:
        # Case-insensitive partial match on the common identifier fields.
        # We escape any regex metacharacters the user might paste in.
        import re
        safe = re.escape(search.strip())
        if safe:
            search_clauses = [
                {"email": {"$regex": safe, "$options": "i"}},
                {"full_name": {"$regex": safe, "$options": "i"}},
                {"company_name": {"$regex": safe, "$options": "i"}},
            ]
            # Combine with the existing role $or by using $and so we don't
            # accidentally OR away the role filter.
            if "$or" in query:
                existing_or = query.pop("$or")
                query["$and"] = [{"$or": existing_or}, {"$or": search_clauses}]
            else:
                query["$or"] = search_clauses

    total = await db.users.count_documents(query)
    out = []
    async for u in (
        db.users.find(query, {"_id": 0, "password_hash": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    ):
        out.append(u)
    return {
        "users": out,
        "total": total,
        "limit": limit,
        "skip": skip,
        "has_more": (skip + len(out)) < total,
    }



# ---------------------------------------------------------------------------
# Reviews moderation (June 2026)
# ---------------------------------------------------------------------------
@router.get("/admin/reviews")
async def admin_list_reviews(
    rating_max: Optional[int] = None,
    rating_min: Optional[int] = None,
    product_id: Optional[str] = None,
    seller_id: Optional[str] = None,
    has_photos: Optional[bool] = None,
    status: Optional[str] = None,
    limit: int = 50,
    skip: int = 0,
    admin: dict = Depends(require_roles("manager", "support")),
):
    """Paginated review feed for moderation.

    Filters:
      * `rating_min` / `rating_max` — narrow to 1★ / 2★ / etc.
      * `product_id`  — all reviews on a specific product
      * `seller_id`   — all reviews of a specific seller's products
      * `has_photos`  — only show reviews with attached photos
      * `status`      — approved | pending | reported  (defaults: show all)
    """
    limit = max(1, min(int(limit), 200))
    skip = max(0, int(skip))

    q: dict = {}
    if rating_min is not None:
        q.setdefault("rating", {})["$gte"] = int(rating_min)
    if rating_max is not None:
        q.setdefault("rating", {})["$lte"] = int(rating_max)
    if product_id:
        q["product_id"] = product_id
    if seller_id:
        q["seller_id"] = seller_id
    if has_photos is True:
        q["photos.0"] = {"$exists": True}
    elif has_photos is False:
        q["$or"] = [{"photos": {"$size": 0}}, {"photos": None}]
    if status:
        s = status.strip().lower()
        if s == "approved":
            # We don't have a moderation flag yet — treat approved as "not
            # reported & not hidden" so the filter is forward-compatible.
            q["$and"] = [
                {"$or": [{"reported": {"$ne": True}}, {"reported": {"$exists": False}}]},
                {"$or": [{"hidden": {"$ne": True}}, {"hidden": {"$exists": False}}]},
            ]
        elif s == "pending":
            q["moderation_status"] = "pending"
        elif s == "reported":
            q["reported"] = True
        elif s == "hidden":
            q["hidden"] = True

    total = await db.reviews.count_documents(q)
    out: list[dict] = []
    async for r in (
        db.reviews.find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    ):
        out.append(r)
    return {
        "reviews": out,
        "total": total,
        "limit": limit,
        "skip": skip,
        "has_more": (skip + len(out)) < total,
    }


@router.delete("/admin/reviews/{review_id}", status_code=204)
async def admin_delete_review(
    review_id: str,
    admin: dict = Depends(require_roles("manager")),
):
    """Owner / manager can scrub abusive or spammy reviews.

    Recomputes the product's aggregate rating after deletion.
    """
    doc = await db.reviews.find_one(
        {"id": review_id}, {"_id": 0, "product_id": 1}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Review not found")
    await db.reviews.delete_one({"id": review_id})
    # Best-effort rating recompute (lazy import to avoid circular deps).
    try:
        from routers.reviews import _recompute_product_rating

        await _recompute_product_rating(doc["product_id"])
    except Exception:
        pass
    await log_admin_action(
        admin_id=admin["id"],
        action="review.delete",
        meta={"review_id": review_id, "product_id": doc.get("product_id")},
    )
    return None
