"""Pydantic request / response models for Allsale."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    full_name: str = Field(..., min_length=1)
    country: Optional[str] = Field(default=None, min_length=2, max_length=2, description="ISO-2 country code (NZ/AU/US/GB/CA)")


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    picture: Optional[str] = None
    provider: str = "email"
    is_seller: bool = False
    seller_verified: bool = False
    country: str = "NZ"
    currency: str = "NZD"


class AuthResponse(BaseModel):
    user: UserPublic
    access_token: str
    token_type: str = "bearer"


class GoogleSessionRequest(BaseModel):
    session_id: str


# ---------------------------------------------------------------------------
# Seller / business
# ---------------------------------------------------------------------------
class SellerBusiness(BaseModel):
    business_type: str = Field(..., min_length=2)
    company_name: str = Field(..., min_length=2)
    # GSTIN is OPTIONAL — only mandatory for entity types other than
    # sole_proprietorship (validated in the registration handler).
    gstin: Optional[str] = Field(default=None)
    pan: str = Field(..., min_length=10, max_length=10)
    cin: Optional[str] = Field(default=None)
    llpin: Optional[str] = Field(default=None)
    address_line1: str = Field(..., min_length=2)
    address_line2: Optional[str] = ""
    city: str = Field(..., min_length=2)
    state: str = Field(..., min_length=2)
    pincode: str = Field(..., min_length=6, max_length=6)
    contact_name: str = Field(..., min_length=2)
    contact_phone: str = Field(..., min_length=6)


class SellerRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    business: SellerBusiness


class SellerUpgrade(BaseModel):
    business: SellerBusiness


class SellerProfile(BaseModel):
    user_id: str
    business_type: str
    company_name: str
    gstin: Optional[str] = None
    pan: str
    cin: Optional[str] = None
    llpin: Optional[str] = None
    address_line1: str
    address_line2: Optional[str] = ""
    city: str
    state: str
    pincode: str
    contact_name: str
    contact_phone: str
    verification_status: str  # auto_verified | pending_review | rejected
    verified_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Products & catalog
# ---------------------------------------------------------------------------
class ListingCreate(BaseModel):
    name: str = Field(..., min_length=2)
    description: str = Field(..., min_length=10)
    category: str = Field(..., min_length=2)
    price_nzd: float = Field(..., gt=0)
    image: Optional[str] = Field(default=None, description="Primary image URL or base64 data URI")
    images: List[str] = Field(default_factory=list, description="Up to 10 image URLs or data URIs")
    shipping_days_min: int = 7
    shipping_days_max: int = 14
    colors: List[str] = Field(default_factory=list, description="Available colors (max 10)")
    stock_count: int = Field(99, ge=0, description="Total stock on hand")
    sizes: List[str] = Field(default_factory=list, description="Available sizes, e.g. ['S','M','L']")


class ListingUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    price_nzd: Optional[float] = Field(default=None, gt=0)
    images: Optional[List[str]] = None
    colors: Optional[List[str]] = None
    sizes: Optional[List[str]] = None
    stock_count: Optional[int] = Field(default=None, ge=0)


class Product(BaseModel):
    id: str
    name: str
    description: str
    category: str
    subcategory: Optional[str] = None
    price_nzd: float
    price_inr: float
    image: str
    images: List[str] = []
    rating: float = 4.5
    reviews_count: int = 0
    in_stock: bool = True
    stock_count: int = 0
    colors: List[str] = []
    sizes: List[str] = []
    shipping_days_min: int = 7
    shipping_days_max: int = 12
    origin: str = "India"
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None
    seller_city: Optional[str] = None


class TaxonomyNode(BaseModel):
    key: str
    name: str
    blurb: str
    subcategories: List[str]


# ---------------------------------------------------------------------------
# NZ duty / prohibited checks
# ---------------------------------------------------------------------------
class DutyItem(BaseModel):
    price_nzd: float
    quantity: int = 1


class DutyEstimateRequest(BaseModel):
    items: List[DutyItem]
    shipping_nzd: float = 0.0


class DutyEstimateResponse(BaseModel):
    goods_nzd: float
    shipping_nzd: float
    gst_nzd: float
    duty_nzd: float
    customs_total_nzd: float  # gst + duty
    grand_total_nzd: float    # goods + shipping + gst + duty
    threshold_nzd: float
    over_threshold: bool


class ProhibitedCheckRequest(BaseModel):
    text: str


class ProhibitedCheckResponse(BaseModel):
    allowed: bool
    matched_term: Optional[str] = None
    reason: Optional[str] = None
    advice: str


# ---------------------------------------------------------------------------
# Cart
# ---------------------------------------------------------------------------
class CartItem(BaseModel):
    product_id: str
    quantity: int


class CartAddRequest(BaseModel):
    product_id: str
    quantity: int = 1


class CartUpdateRequest(BaseModel):
    quantity: int


class CartView(BaseModel):
    items: List[dict]  # product details + quantity
    subtotal_nzd: float
    shipping_nzd: float
    total_nzd: float
    subtotal_inr: float


# ---------------------------------------------------------------------------
# Checkout / orders
# ---------------------------------------------------------------------------
class Address(BaseModel):
    full_name: str
    phone: str
    line1: str
    line2: Optional[str] = ""
    city: str
    region: str
    postcode: str
    country: str = "New Zealand"


class CheckoutRequest(BaseModel):
    address: Address
    origin_url: str  # e.g. https://allsale-shop.preview.emergentagent.com


class OrderItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    quantity: int
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None


class Payout(BaseModel):
    id: str
    order_id: str
    seller_id: str
    company_name: str
    items_count: int
    gross_nzd: float
    commission_nzd: float
    net_payable_nzd: float
    status: str  # pending | paid_out
    created_at: datetime
    paid_out_at: Optional[datetime] = None


class SellerOrderItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    quantity: int


class SellerOrder(BaseModel):
    order_id: str
    buyer_name: str
    buyer_city: str
    buyer_region: str
    items: List[SellerOrderItem]
    seller_subtotal_nzd: float
    status: str
    created_at: datetime
    estimated_delivery: str


class SellerPayoutSummary(BaseModel):
    payouts: List[Payout]
    lifetime_earnings_nzd: float
    pending_nzd: float
    paid_out_nzd: float


class Order(BaseModel):
    id: str
    user_id: str
    items: List[OrderItem]
    subtotal_nzd: float
    shipping_nzd: float
    total_nzd: float
    address: Address
    status: str
    payment_status: str
    session_id: Optional[str] = None
    created_at: datetime
    estimated_delivery: str
    cancellable_until: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    refund_id: Optional[str] = None
    refund_amount_nzd: Optional[float] = None
    # Multi-region: what the buyer was actually charged in their currency.
    buyer_country: Optional[str] = None
    buyer_currency: Optional[str] = None
    charge_amount: Optional[float] = None


class CancelOrderRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=300)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
class Notification(BaseModel):
    id: str
    user_id: str  # recipient user id, or "admin" for admin notifications
    role: str  # buyer | seller | admin
    type: str
    title: str
    body: str
    order_id: Optional[str] = None
    read: bool = False
    created_at: datetime


# ---------------------------------------------------------------------------
# Returns
# ---------------------------------------------------------------------------
class ReturnRequestItem(BaseModel):
    product_id: str
    name: str
    image: str
    price_nzd: float
    quantity: int


class ReturnRequestCreate(BaseModel):
    order_id: str
    reason: str = Field(..., description="One of RETURN_REASONS")
    product_ids: List[str] = Field(default_factory=list)
    note: Optional[str] = Field(None, max_length=600)
    photos: List[str] = Field(default_factory=list, description="base64-encoded images, optional, max 4")
    videos: List[str] = Field(default_factory=list, description="short proof videos (Cloudinary URLs), max 1")
    refund_method: Optional[str] = Field(
        default="original",
        description="'original' = back to card, 'store_credit' = Allsale wallet (5% bonus)",
    )


class ReturnRequest(BaseModel):
    id: str
    order_id: str
    user_id: str
    seller_id: str
    items: List[ReturnRequestItem]
    reason: str
    note: Optional[str] = None
    photos: List[str] = Field(default_factory=list)
    videos: List[str] = Field(default_factory=list)
    status: str  # pending_seller | approved | rejected | refunded | cancelled
    buyer_pays_shipping: bool
    restocking_fee_nzd: float
    refund_amount_nzd: float
    refund_method: str = "original"  # 'original' | 'store_credit'
    store_credit_bonus_nzd: float = 0.0
    created_at: datetime
    decided_at: Optional[datetime] = None
    decision_note: Optional[str] = None
    refund_id: Optional[str] = None


class ReturnDecision(BaseModel):
    note: Optional[str] = Field(None, max_length=300)


# ---------------------------------------------------------------------------
# Shipments
# ---------------------------------------------------------------------------
class Shipment(BaseModel):
    id: str
    order_id: str
    carrier: str
    awb_code: str
    tracking_url: str
    status: str
    estimated_delivery: str
    is_mocked: bool


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Reviews & Ratings
# ---------------------------------------------------------------------------
class ReviewCreate(BaseModel):
    order_id: str
    product_id: str
    rating: int = Field(..., ge=1, le=5)
    title: Optional[str] = Field(default=None, max_length=120)
    comment: str = Field(..., min_length=2, max_length=2000)
    photos: List[str] = Field(default_factory=list, description="Up to 6 image URLs / data URIs")


class ReviewReplyCreate(BaseModel):
    body: str = Field(..., min_length=2, max_length=1000)


class ReviewReply(BaseModel):
    seller_id: str
    seller_name: Optional[str] = None
    body: str
    created_at: datetime


class Review(BaseModel):
    id: str
    product_id: str
    seller_id: Optional[str] = None
    order_id: str
    user_id: str
    user_name: str
    user_country: Optional[str] = None
    rating: int
    title: Optional[str] = None
    comment: str
    photos: List[str] = Field(default_factory=list)
    verified_purchase: bool = True
    helpful_count: int = 0
    helpful_user_ids: List[str] = Field(default_factory=list)
    seller_reply: Optional[ReviewReply] = None
    created_at: datetime


class ReviewSummary(BaseModel):
    product_id: str
    avg_rating: float
    total: int
    distribution: dict  # {"5": 12, "4": 4, "3": 1, "2": 0, "1": 0}


class ReviewsPage(BaseModel):
    summary: ReviewSummary
    items: List[Review]
    can_review: bool = False
    eligible_order_ids: List[str] = Field(default_factory=list)


class EligibleReviewItem(BaseModel):
    order_id: str
    product_id: str
    product_name: str
    product_image: str
    order_status: str
    purchased_at: datetime


# ---------------------------------------------------------------------------
# Uploads
# ---------------------------------------------------------------------------
class UploadImageRequest(BaseModel):
    data: str = Field(..., description="Base64 data URI (e.g. data:image/jpeg;base64,...) OR a remote URL")
    folder: Optional[str] = Field("allsale/products", description="Cloudinary folder")


class UploadImageResponse(BaseModel):
    url: str
    public_id: Optional[str] = None
    provider: str  # "cloudinary" | "passthrough"
    bytes: Optional[int] = None


# ---------------------------------------------------------------------------
# Bulk listing operations (seller)
# ---------------------------------------------------------------------------
class BulkListingOp(BaseModel):
    """A single bulk operation applied to many product_ids at once."""
    product_ids: List[str] = Field(..., min_length=1, max_length=200)
    action: str = Field(
        ...,
        description=(
            "One of: set_price, adjust_price_pct, set_stock, "
            "adjust_stock, set_category, toggle_in_stock, delete"
        ),
    )
    price_nzd: Optional[float] = Field(default=None, gt=0)
    pct: Optional[float] = Field(default=None)
    stock_count: Optional[int] = Field(default=None, ge=0)
    stock_delta: Optional[int] = Field(default=None)
    category: Optional[str] = None
    in_stock: Optional[bool] = None


class BulkListingResult(BaseModel):
    matched: int
    modified: int
    deleted: int
    action: str


# ---------------------------------------------------------------------------
# Bulk import (CSV / XLSX upload)
# ---------------------------------------------------------------------------
class BulkImportRowReport(BaseModel):
    row_number: int
    mode: str  # "create" | "update"
    ok: bool
    errors: List[str] = Field(default_factory=list)
    data: dict


class BulkImportPreviewResponse(BaseModel):
    total: int
    valid: int
    errors: int
    will_create: int
    will_update: int
    rows: List[BulkImportRowReport]


class BulkImportRow(BaseModel):
    """One row that the buyer has confirmed for import."""
    product_id: Optional[str] = None
    name: str = ""
    description: str = ""
    category: str = ""
    subcategory: Optional[str] = None
    price_nzd: Optional[float] = None
    stock_count: Optional[int] = None
    sizes: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)
    shipping_days_min: int = 7
    shipping_days_max: int = 14
    images: List[str] = Field(default_factory=list)


class BulkImportRequest(BaseModel):
    rows: List[BulkImportRow] = Field(..., min_length=1, max_length=1000)


class BulkImportErrorEntry(BaseModel):
    row_number: int
    errors: List[str]


class BulkImportResult(BaseModel):
    created: int
    updated: int
    errors: List[BulkImportErrorEntry] = Field(default_factory=list)
    total_attempted: int


class BulkImagesZipResponse(BaseModel):
    """Result of extracting a ZIP of images and hosting them on Cloudinary.

    `mapping` is keyed by the original filename inside the ZIP (e.g.
    "sku-123_front.jpg") AND by the bare base-name (no path) so sellers
    can reference either form in their CSV/XLSX `image_urls` column.
    """
    mapping: dict
    uploaded: int
    skipped: List[str] = Field(default_factory=list)
    provider: str  # "cloudinary" | "passthrough"
