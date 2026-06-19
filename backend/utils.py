"""Pure helpers (no DB I/O) shared across routers and services."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional

import bcrypt
from fastapi import HTTPException
from jose import jwt

from config import (
    BUSINESS_TYPES_NEEDS_CIN,
    BUSINESS_TYPES_NEEDS_LLPIN,
    CANCELLATION_WINDOW_HOURS,
    CIN_RE,
    DEFAULT_COUNTRY,
    FLAT_SHIPPING_NZD,
    FREE_SHIPPING_THRESHOLD_NZD,
    FX_RATES_FROM_NZD,
    GSTIN_RE,
    INR_PER_NZD,
    JWT_ALG,
    JWT_EXPIRE_DAYS,
    JWT_SECRET,
    LLPIN_RE,
    PAN_RE,
    SUPPORTED_COUNTRIES,
    VALID_BUSINESS_TYPES,
)
from models import CartView, SellerBusiness, UserPublic


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, token_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "tv": int(token_version or 0),
        "iat": int(now_utc().timestamp()),
        "exp": int((now_utc() + timedelta(days=JWT_EXPIRE_DAYS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def estimate_delivery_window(days_min: int = 7, days_max: int = 14) -> str:
    start = now_utc() + timedelta(days=days_min)
    end = now_utc() + timedelta(days=days_max)
    return f"{start.strftime('%d %b')} – {end.strftime('%d %b %Y')}"


def cancellable_until_from(paid_at: datetime) -> datetime:
    return paid_at + timedelta(hours=CANCELLATION_WINDOW_HOURS)


def public_user(doc: dict) -> UserPublic:
    country = (doc.get("country") or DEFAULT_COUNTRY).upper()
    currency_map = {c["code"]: c["currency"] for c in SUPPORTED_COUNTRIES}
    # Email is considered "verified" implicitly for any non-email provider
    # (Google + Apple already proved the address before issuing the token).
    provider = doc.get("provider", "email")
    email_verified = bool(doc.get("email_verified")) or provider in ("google", "apple")
    return UserPublic(
        id=doc["id"],
        email=doc["email"],
        full_name=doc["full_name"],
        picture=doc.get("picture"),
        provider=provider,
        is_seller=bool(doc.get("is_seller")),
        seller_verified=doc.get("seller_verification_status") == "auto_verified",
        country=country,
        currency=currency_map.get(country, "NZD"),
        email_verified=email_verified,
        seen_onboarding=bool(doc.get("seen_onboarding")),
    )


def convert_from_nzd(amount_nzd: float, currency: str) -> float:
    """Convert an NZD amount to the requested currency using hardcoded rates."""
    rate = FX_RATES_FROM_NZD.get((currency or "NZD").upper(), 1.0)
    return round(float(amount_nzd) * rate, 2)


def localize_price(amount_nzd: float, country: str) -> dict:
    """Return both the NZD original and the buyer's-currency converted price."""
    country = (country or DEFAULT_COUNTRY).upper()
    info = next(
        (c for c in SUPPORTED_COUNTRIES if c["code"] == country),
        SUPPORTED_COUNTRIES[0],
    )
    return {
        "nzd": round(float(amount_nzd), 2),
        "amount": convert_from_nzd(amount_nzd, info["currency"]),
        "currency": info["currency"],
        "symbol": info["symbol"],
        "country": country,
    }


def validate_indian_business(b: SellerBusiness) -> dict:
    """Return cleaned/uppercased dict; raise HTTPException on invalid formats."""
    btype = b.business_type.strip().lower()
    if btype not in VALID_BUSINESS_TYPES:
        raise HTTPException(status_code=400, detail="Invalid business type")
    raw_gstin = (b.gstin or "").strip().upper() or None
    pan = b.pan.strip().upper()
    cin = b.cin.strip().upper() if b.cin else None
    llpin = b.llpin.strip().upper() if b.llpin else None
    pincode = b.pincode.strip()

    # GSTIN is OPTIONAL for sole proprietors.
    gstin: Optional[str]
    if btype == "sole_proprietorship":
        gstin = raw_gstin
        if gstin and not GSTIN_RE.match(gstin):
            raise HTTPException(status_code=400, detail="Invalid GSTIN format (15 chars)")
    else:
        if not raw_gstin:
            raise HTTPException(status_code=400, detail="GSTIN is required for this business type")
        if not GSTIN_RE.match(raw_gstin):
            raise HTTPException(status_code=400, detail="Invalid GSTIN format (15 chars)")
        gstin = raw_gstin
    if not PAN_RE.match(pan):
        raise HTTPException(status_code=400, detail="Invalid PAN format (10 chars)")
    if not pincode.isdigit() or len(pincode) != 6:
        raise HTTPException(status_code=400, detail="Pincode must be 6 digits")
    if gstin and pan != gstin[2:12]:
        raise HTTPException(status_code=400, detail="PAN must match the PAN inside the GSTIN")

    if btype in BUSINESS_TYPES_NEEDS_CIN:
        if not cin or not CIN_RE.match(cin):
            raise HTTPException(status_code=400, detail="Valid CIN (21 chars) is required for this business type")
        if llpin:
            raise HTTPException(status_code=400, detail="LLPIN does not apply to this business type")
    elif btype in BUSINESS_TYPES_NEEDS_LLPIN:
        if not llpin or not LLPIN_RE.match(llpin):
            raise HTTPException(status_code=400, detail="Valid LLPIN (7 chars: AAA-1234) is required for an LLP")
        if cin:
            raise HTTPException(status_code=400, detail="CIN does not apply to an LLP — use LLPIN")
    else:
        if cin or llpin:
            raise HTTPException(status_code=400, detail="CIN/LLPIN do not apply to this business type")
    return {
        "business_type": btype,
        "company_name": b.company_name.strip(),
        "gstin": gstin,
        "pan": pan,
        "cin": cin,
        "llpin": llpin,
        "address_line1": b.address_line1.strip(),
        "address_line2": (b.address_line2 or "").strip(),
        "city": b.city.strip(),
        "state": b.state.strip(),
        "pincode": pincode,
        "contact_name": b.contact_name.strip(),
        "contact_phone": b.contact_phone.strip(),
    }


def compute_cart_totals(items_with_products: List[dict]) -> CartView:
    subtotal_nzd = sum(it["price_nzd"] * it["quantity"] for it in items_with_products)
    shipping = (
        0.0
        if subtotal_nzd >= FREE_SHIPPING_THRESHOLD_NZD or subtotal_nzd == 0
        else FLAT_SHIPPING_NZD
    )
    total = subtotal_nzd + shipping
    return CartView(
        items=items_with_products,
        subtotal_nzd=round(subtotal_nzd, 2),
        shipping_nzd=round(shipping, 2),
        total_nzd=round(total, 2),
        subtotal_inr=round(subtotal_nzd * INR_PER_NZD, 0),
    )


def clean_string_list(values: Optional[List[str]], limit: int) -> List[str]:
    """Dedupe (case-insensitive, preserve original order) + trim empties."""
    seen: set[str] = set()
    out: list[str] = []
    for v in values or []:
        t = (v or "").strip()
        if not t:
            continue
        k = t.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(t)
        if len(out) >= limit:
            break
    return out
