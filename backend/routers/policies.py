"""Public policy content endpoints.

Single source of truth for static legal & policy text.  Mobile app + web
app (and any future surface — Help Center email auto-responder, support
chat snippets, etc.) all consume the same content from here.

  GET /api/policies              → list metadata for all policies
  GET /api/policies/{slug}       → full policy (structured + markdown)

The content is deliberately stored inline (not in DB) so there is no
admin UI required and so the version is git-tracked.  When a policy
changes you bump `LAST_UPDATED` and the front-end automatically picks up
the new version.

Both shapes are returned in every policy response so consumers can pick
the rendering they prefer:

  • `sections`  — list of {heading, paragraph?, bullets?} for structured render
  • `markdown`  — flat Markdown string for `react-markdown` etc. on web
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["policies"])

LAST_UPDATED = "2026-06-16"
EFFECTIVE = "June 2026"
SUPPORT_EMAIL = "support@allsale.co.nz"
SELLER_EMAIL = "sellers@allsale.co.nz"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class PolicySection(BaseModel):
    heading: str
    paragraph: Optional[str] = None
    bullets: Optional[List[str]] = None


class PolicyResponse(BaseModel):
    slug: str
    title: str
    effective: str
    last_updated: str
    intro: Optional[str] = None
    sections: List[PolicySection]
    markdown: str
    contact_email: str


class PolicyListItem(BaseModel):
    slug: str
    title: str
    effective: str
    last_updated: str
    description: str


# ---------------------------------------------------------------------------
# Content (single source of truth)
# ---------------------------------------------------------------------------
POLICIES: dict = {
    # -----------------------------------------------------------------------
    "terms": {
        "title": "Terms & Conditions",
        "description": "Acceptance, eligibility, our marketplace role, liability, governing law.",
        "intro": None,
        "contact_email": SUPPORT_EMAIL,
        "sections": [
            {"heading": "1. Acceptance", "bullets": [
                "By using Allsale (the mobile app or website), you agree to these Terms. If you don't agree, please don't use the platform.",
                f"Allsale is operated by Allsale Ltd, registered in New Zealand. Contact: {SUPPORT_EMAIL}",
            ]},
            {"heading": "2. Eligibility", "bullets": [
                "You must be 16+ to use Allsale.",
                "Buyer accounts are open to residents of NZ, AU, US, UK, CA and IN.",
                "Seller accounts are restricted to verified Indian businesses with valid GST and address proof.",
            ]},
            {"heading": "3. Our role", "bullets": [
                "Allsale is a marketplace platform. We connect Indian sellers with global buyers, but we are NOT the seller of the products.",
                "Each seller is responsible for the accuracy of their listings, product quality, and after-sale support.",
                "Allsale collects payments on behalf of sellers and routes them after the return window closes (see Seller Policy).",
            ]},
            {"heading": "4. Pricing & currency", "bullets": [
                "Product base prices are set in NZD (or INR for the seller). Prices in AUD/USD/GBP/CAD are auto-calculated using live FX rates (refreshed daily via Frankfurter API).",
                "Final price you pay = product + shipping + taxes (if any) + customs duties (for international orders).",
                "Any flash sale or coupon discount is shown clearly at checkout before you pay.",
            ]},
            {"heading": "5. Orders & payment", "bullets": [
                "All payments are processed by Stripe in your local currency.",
                "Once paid, you receive an order confirmation. If we can't fulfill the order (out of stock etc.), we'll refund within 7 business days.",
                "Loyalty Points: 1 pt earned per $1 NZD spent · 100 pts = $1 NZD discount · 50% max redemption per order · 12-month expiry.",
            ]},
            {"heading": "6. Shipping & delivery", "bullets": [
                "International shipping is handled by Shiprocket X. Estimated delivery: 7-21 days depending on region.",
                "Customs duties or import taxes (if any) are the buyer's responsibility unless explicitly marked DDP at checkout.",
                "If your order is delayed or lost, contact us within 30 days of the ship-out date for resolution.",
            ]},
            {"heading": "7. Returns & refunds", "bullets": [
                "Returns are accepted within 14 days of delivery for genuine product issues (wrong item, damaged, not as described).",
                "Buyer chooses refund method: original payment OR store credit (Allsale Wallet).",
                "See Return Policy for full details.",
            ]},
            {"heading": "8. Prohibited behaviour", "bullets": [
                "Fake reviews, fake referrals, abusing coupons/points, scraping, or attempting to defraud sellers or buyers — all may result in account termination.",
                "Reselling without seller permission, listing counterfeit products, or violating intellectual property rights.",
            ]},
            {"heading": "9. Liability", "bullets": [
                "To the maximum extent permitted by law, Allsale's total liability for any claim is capped at the value of the order in question.",
                "We are not liable for indirect or consequential damages.",
                "Acts of God, war, customs delays beyond our control are excluded.",
            ]},
            {"heading": "10. Governing law", "bullets": [
                "These Terms are governed by the laws of New Zealand. Disputes are subject to NZ courts.",
            ]},
            {"heading": "11. Changes", "bullets": [
                "We may update these Terms occasionally. We'll notify you in-app for material changes. Continued use = acceptance.",
            ]},
        ],
    },
    # -----------------------------------------------------------------------
    "privacy": {
        "title": "Privacy Policy",
        "description": "What data we collect, how we use it, your rights and retention.",
        "intro": None,
        "contact_email": SUPPORT_EMAIL,
        "sections": [
            {"heading": "1. Who we are", "bullets": [
                "Allsale is operated by Allsale Ltd (NZ), connecting verified Indian sellers with buyers in New Zealand, Australia, the United States, the United Kingdom, Canada and India.",
                f"Contact: {SUPPORT_EMAIL}",
            ]},
            {"heading": "2. Information we collect", "bullets": [
                "Account info — name, email, password (hashed), phone (optional), country, profile photo (if you sign in with Google).",
                "Order info — shipping address, billing details, items purchased, payment method (we never store full card numbers; that's handled by Stripe).",
                "Device info — IP address, device type, browser, app version, approximate location (used for currency & shipping estimates).",
                "Usage info — pages viewed, items wishlisted, reviews left, chats with sellers.",
                "Photos & videos you upload — review photos, return evidence, profile picture (stored on Cloudinary).",
            ]},
            {"heading": "3. How we use your data", "bullets": [
                "Process orders and arrange shipping via Shiprocket.",
                "Detect your country to show the right currency and shipping options.",
                "Send transactional emails (order confirmations, refund updates, returns).",
                "Detect fraud and abuse.",
                "Improve product recommendations (no AI training on personal data).",
            ]},
            {"heading": "4. Who we share with", "bullets": [
                "Sellers — only the shipping address and order details for products you bought from them.",
                "Stripe — for processing payments (their privacy policy applies).",
                "Shiprocket — for shipping labels and tracking.",
                "Cloudinary — for image hosting.",
                "Government authorities — only when legally required.",
                "We do NOT sell your data to advertisers.",
            ]},
            {"heading": "5. Your rights", "bullets": [
                "Access — request a copy of your data via Account → Privacy & data → Download data.",
                "Delete — close your account from Account → Privacy & data → Delete account. We remove personal data within 30 days (some order records kept for tax/legal reasons).",
                "Correct — update your profile anytime from Account settings.",
                "Opt-out — turn off promotional emails from Notifications settings.",
                f"Email {SUPPORT_EMAIL} to exercise any of these rights.",
            ]},
            {"heading": "6. Data retention", "bullets": [
                "Account data — kept while your account is active and for 12 months after closure.",
                "Order records — 7 years (legal/tax requirement).",
                "Marketing data — deleted on opt-out.",
            ]},
            {"heading": "7. Cookies", "bullets": [
                "We use essential cookies for login and cart. Analytics cookies are anonymised. No third-party ad cookies.",
            ]},
            {"heading": "8. Cross-border transfers", "bullets": [
                "Your data may be processed in India (sellers), New Zealand (us), Singapore (Cloudinary CDN) and the US (Stripe). All transfers use industry-standard encryption (TLS 1.2+).",
            ]},
            {"heading": "9. Children", "bullets": [
                "Allsale is not intended for users under 16. We don't knowingly collect data from minors.",
            ]},
            {"heading": "10. Updates", "bullets": [
                "We'll notify you in-app when this policy changes materially. Continued use means acceptance.",
            ]},
        ],
    },
    # -----------------------------------------------------------------------
    "return": {
        "title": "Return Policy",
        "description": "7-day return window, acceptable reasons, who pays shipping, refund timing.",
        "intro": "Cross-border returns from New Zealand to India are expensive and slow, so please choose carefully. Where the law or our policy entitles you to a return, we make it as simple as we can.",
        "contact_email": SUPPORT_EMAIL,
        "sections": [
            {"heading": "7-day return window",
             "paragraph": "You can request a return within 7 days of the parcel being delivered. Requests received after this window cannot be accepted, except where required by the NZ Consumer Guarantees Act (e.g. major defects)."},
            {"heading": "Acceptable return reasons", "bullets": [
                "Damaged on arrival (report within 48 hours with photos)",
                "Wrong item received",
                "Not as described on the listing",
                "Defective or not working as intended",
                "Changed your mind (buyer-paid return shipping + 15% restocking fee)",
            ]},
            {"heading": "Who pays return shipping?", "bullets": [
                "Defective, damaged or wrong item: the seller pays — we issue a prepaid return label",
                "Change of mind: you pay the return shipping cost back to our NZ consolidation hub",
                "International return courier to India is arranged by Allsale on behalf of the seller",
            ]},
            {"heading": "Restocking fee",
             "paragraph": "For change-of-mind returns a 15% restocking fee is deducted from your refund. This covers cross-border re-handling, repackaging and re-listing costs. There is no restocking fee for defective or wrong items."},
            {"heading": "Items we cannot accept back", "bullets": [
                "Perishables, food and groceries (sealed or unsealed)",
                "Personal hygiene and intimate apparel",
                "Custom-made or personalised items (e.g. tailored sarees, engraved gifts)",
                "Opened software, digital downloads and activation keys",
                "Gift cards and vouchers",
            ]},
            {"heading": "How to request a return", "bullets": [
                "Open the order under My Orders",
                "Tap \u201cRequest return\u201d (available while you are within the 7-day window)",
                "Select a reason, attach up to 4 photos and submit",
                "The seller has 48 hours to approve; if not, Allsale Trust & Safety steps in",
            ]},
            {"heading": "When you receive your refund",
             "paragraph": "Once the returned item is received at our NZ hub and inspected, your refund is issued to your original Stripe payment method (in NZD) within 5\u201310 business days. For change-of-mind returns the restocking fee and original outbound shipping are non-refundable."},
            {"heading": "Damaged in transit",
             "paragraph": "If the parcel arrives visibly damaged, photograph it before opening, refuse delivery if possible, and contact us within 48 hours. Cross-border parcels are insured via Shiprocket X and you are fully protected."},
        ],
    },
    # -----------------------------------------------------------------------
    "payment": {
        "title": "Payment Policy",
        "description": "Accepted methods, taxes, when you're charged, currency, security.",
        "intro": "Allsale is a cross-border marketplace connecting verified India-registered sellers with buyers in New Zealand. All prices and charges are shown in NZD (New Zealand Dollars).",
        "contact_email": SUPPORT_EMAIL,
        "sections": [
            {"heading": "Accepted payment methods", "bullets": [
                "Visa, Mastercard, American Express (via Stripe NZ)",
                "Apple Pay and Google Pay where supported by your device",
                "All payments are processed in NZD with 3D Secure where required by your bank",
            ]},
            {"heading": "Pricing and taxes", "bullets": [
                "All product prices on Allsale are listed in NZD and include GST where applicable",
                "New Zealand GST (15%) is applied at checkout in line with NZ IRD rules for cross-border supplies",
                "Orders over NZD 1,000 may incur additional NZ Customs duty (10%); see the Duty Calculator before you check out",
                "Shipping is free for orders over NZD 100, otherwise a flat NZD 12 fee applies",
            ]},
            {"heading": "When you are charged",
             "paragraph": "You are charged in full at the time of placing the order. Funds are held by Allsale and released to the seller only after the goods are confirmed delivered and the 10-day buyer-protection window has elapsed."},
            {"heading": "Currency and FX", "bullets": [
                "You always pay in NZD — Allsale absorbs the FX risk between NZD and INR",
                "Sellers are paid in INR after conversion at the rate prevailing on the payout date",
                "We never charge a hidden FX markup to buyers",
            ]},
            {"heading": "Security",
             "paragraph": "We never see or store your full card number. All card data is tokenised by Stripe and held to PCI-DSS Level 1 standards. Your transactions are protected by Stripe Radar fraud detection and 3D Secure 2."},
            {"heading": "Failed payments and chargebacks", "bullets": [
                "If a payment fails, no order is created and no funds are captured",
                "If you do not recognise a charge, please contact us first — chargebacks may delay refunds by 30+ days",
                "Allsale cooperates fully with your bank and Stripe on any chargeback case",
            ]},
            {"heading": "Refunds",
             "paragraph": "Refunds are always issued in NZD to your original payment method. Most refunds appear on your statement within 5\u201310 business days. See our Return Policy and Cancellation Policy for when refunds apply."},
        ],
    },
    # -----------------------------------------------------------------------
    "cancellation": {
        "title": "Cancellation Policy",
        "description": "12-hour cancellation window, how to cancel, refund timing.",
        "intro": "You can cancel any paid order for a full refund within 12 hours of placing it, provided the seller has not yet dispatched the parcel. After that window the order moves into preparation and standard returns rules apply.",
        "contact_email": SUPPORT_EMAIL,
        "sections": [
            {"heading": "12-hour cancellation window", "bullets": [
                "You have 12 hours from the moment your payment is confirmed to cancel",
                "The exact deadline is shown on the order screen as a live countdown",
                "Once the courier has picked up the parcel (status \u201cShipped\u201d), cancellation is no longer possible \u2014 please request a return instead",
            ]},
            {"heading": "How to cancel", "bullets": [
                "Open the order under My Orders",
                "Tap \u201cCancel order\u201d while the countdown is still running",
                "Choose a reason (optional) and confirm",
                "You\u2019ll receive an in-app notification immediately, and the seller and Allsale support are notified too",
            ]},
            {"heading": "Refunds for cancellations",
             "paragraph": "Cancellations within the 12-hour window receive a full refund to your original Stripe payment method in NZD. Most refunds appear on your statement within 5\u201310 business days."},
            {"heading": "Seller-initiated cancellations", "bullets": [
                "If a seller is unable to fulfil an order (out of stock, NZ MPI compliance failure, etc.) they may cancel it within 24 hours of receiving it",
                "You will be notified instantly and refunded in full",
                "Allsale credits the seller a strike against their service-level rating",
            ]},
            {"heading": "What if I miss the window?",
             "paragraph": f"Once the 12-hour window passes the order cannot be cancelled. If it has not yet shipped, you can email {SUPPORT_EMAIL} \u2014 we will try our best, but cannot guarantee a refund. After dispatch, please wait for delivery and follow the Return Policy."},
            {"heading": "Subscriptions and pre-orders",
             "paragraph": "Pre-ordered items can be cancelled at any time before the seller marks them as dispatched. Allsale does not currently offer subscription products."},
        ],
    },
    # -----------------------------------------------------------------------
    "seller": {
        "title": "Seller Policy",
        "description": "Eligibility, escrow payouts, commission, listing & fulfilment rules.",
        "intro": "Built on trust. Your earnings are protected and released after every buyer's return window closes — automatically.",
        "contact_email": SELLER_EMAIL,
        "sections": [
            {"heading": "1. Eligibility", "bullets": [
                "Sellers must be registered Indian businesses with valid GST and PAN.",
                "Verification includes: business name, GSTIN, address proof, bank account, owner KYC.",
                "We may reject or pause an account at any time for fraud, IP infringement, or repeated quality issues.",
            ]},
            {"heading": "2. Payment hold — IMPORTANT", "bullets": [
                "Allsale collects the full order amount from the buyer at checkout via Stripe.",
                "Your earnings are HELD in escrow until the return window closes (typically 14 days after delivery).",
                "After the return window, your earnings are released to your Shiprocket payout wallet (or bank if configured).",
                "This protects buyers from non-delivery and protects sellers from chargebacks after dispatch.",
            ]},
            {"heading": "3. When you DON'T get paid", "bullets": [
                "Order cancelled by buyer before dispatch — 100% refund to buyer, no payout to seller.",
                "Order cancelled by you (out of stock etc.) — 100% refund to buyer, plus a 5% inconvenience fee may apply.",
                "Order lost in transit — Shiprocket insurance kicks in; you still get paid once insurance settles.",
                "Buyer returns the item with valid reason (wrong/damaged/not as described) — full refund to buyer, you don't get paid for that item.",
                "Buyer returns with invalid reason — payout proceeds normally after Allsale review.",
                "Chargeback raised by buyer — payment frozen until resolution. If you win the dispute, payout resumes.",
            ]},
            {"heading": "4. Marketplace commission", "bullets": [
                "Allsale takes 12% commission on the product price (excluding shipping).",
                "Shiprocket shipping cost is passed through at actual cost.",
                "Payment processor fee (Stripe ~2.9%) is borne by Allsale.",
            ]},
            {"heading": "5. Listing standards", "bullets": [
                "Photos must be your own or licensed. No watermarks of competitors.",
                "Descriptions must be accurate. Misleading listings (wrong material, wrong size, fake brand) are grounds for delisting.",
                "Prohibited categories: counterfeits, weapons, drugs, hazardous materials, restricted exports.",
            ]},
            {"heading": "6. Fulfilment timelines", "bullets": [
                "You must dispatch within 2 business days of receiving the order.",
                "Repeated delays (>3 in 30 days) may result in account suspension.",
                "Use the Bulk Upload feature to keep inventory accurate.",
            ]},
            {"heading": "7. Returns handling", "bullets": [
                "You'll receive a notification when a buyer requests a return.",
                "You have 48 hours to approve or dispute the return.",
                "Disputes go to Allsale review — we'll evaluate evidence (photos/videos) and decide within 5 business days.",
            ]},
            {"heading": "8. Cancellation handling", "bullets": [
                "Buyer can cancel for free until the order is marked 'shipped'.",
                "After dispatch, cancellation is treated as a return.",
                "You can refuse a return only with clear evidence (e.g. wrong item claimed but tracking shows correct item delivered).",
            ]},
            {"heading": "9. Payouts schedule", "bullets": [
                "Payouts process every Tuesday for orders whose return window has closed.",
                "Minimum payout: ₹1,000.",
                "Failed payouts (wrong bank details) retry the next cycle. No fees.",
            ]},
            {"heading": "10. Termination", "bullets": [
                "You can leave anytime — your pending orders complete, your final payout processes 14 days after the last delivery.",
                "We may terminate immediately for fraud, IP violations, or repeated quality complaints.",
            ]},
        ],
    },
    # -----------------------------------------------------------------------
    "prohibited": {
        "title": "Prohibited Items",
        "description": "What we won't ship to New Zealand — biosecurity, customs and IP rules.",
        "intro": "New Zealand has the strictest biosecurity laws in the world. Any of the items below will be refused at the border, destroyed and the order refunded minus inspection fees.",
        "contact_email": SUPPORT_EMAIL,
        "sections": [
            {"heading": "Biosecurity — auto-rejected by NZ MPI", "bullets": [
                "Fresh fruit, vegetables, plants, seeds, flowers",
                "Honey and beekeeping equipment",
                "Animal hides, fur, feathers, untreated wool, bone",
                "Wooden artefacts not heat-treated (ISPM-15 compliant)",
                "Soil-contaminated items (used boots, gardening tools)",
                "Eggs (any state), dairy products",
                "Live animals, insects, or biological samples",
            ]},
            {"heading": "Food restrictions", "bullets": [
                "Meat products (raw, cooked, dried, jerky)",
                "Spices containing seeds (whole cumin pods etc.) — ground is OK",
                "Tea: loose-leaf accepted; herbal teas with whole flowers/seeds rejected",
                "Pickles with whole fruit — strained pickles OK",
            ]},
            {"heading": "Customs prohibited", "bullets": [
                "Weapons, ammunition, replicas (including airsoft, knuckle-dusters)",
                "Drugs, narcotics, kava root",
                "Counterfeit branded goods (will be seized & destroyed)",
                "Tobacco, vaping liquids, e-cigarettes",
                "Pornographic material",
                "Items endangered under CITES (ivory, rhino horn, certain corals)",
            ]},
            {"heading": "IP & marketplace rules", "bullets": [
                "Counterfeit branded goods are prohibited regardless of customs rules.",
                "Items violating active trademarks, copyrights or patents will be removed.",
                "If unsure, use our \u201cAllowed in NZ?\u201d checker before you order.",
            ]},
            {"heading": "Penalties",
             "paragraph": "Items refused at NZ customs are destroyed or returned to sender at the buyer's expense. Allsale will refund the product price (minus inspection and return fees) but cannot refund shipping. Repeat offenders may have their accounts suspended."},
        ],
    },
}


# ---------------------------------------------------------------------------
# Markdown renderer
# ---------------------------------------------------------------------------
def _to_markdown(policy: dict) -> str:
    """Render the structured policy to a clean Markdown string.

    Mirrors the on-screen layout: `# Title`, optional intro paragraph, then
    `## Heading` for each section followed by either a paragraph or a `- `
    bullet list.  We append a footer with the support email so the file is
    self-contained.
    """
    out: list[str] = [f"# {policy['title']}", ""]
    out.append(f"*Effective {EFFECTIVE} · Last updated {LAST_UPDATED}*")
    out.append("")
    if policy.get("intro"):
        out.append(policy["intro"])
        out.append("")
    for sec in policy["sections"]:
        out.append(f"## {sec['heading']}")
        out.append("")
        if sec.get("paragraph"):
            out.append(sec["paragraph"])
            out.append("")
        if sec.get("bullets"):
            for b in sec["bullets"]:
                out.append(f"- {b}")
            out.append("")
    out.append(f"---")
    out.append(f"Questions? Email **{policy['contact_email']}**.")
    return "\n".join(out).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/policies", response_model=List[PolicyListItem])
async def list_policies():
    """Catalogue of all available policies for navigation menus."""
    out: list[PolicyListItem] = []
    for slug, p in POLICIES.items():
        out.append(
            PolicyListItem(
                slug=slug,
                title=p["title"],
                effective=EFFECTIVE,
                last_updated=LAST_UPDATED,
                description=p["description"],
            )
        )
    return out


@router.get("/policies/{slug}", response_model=PolicyResponse)
async def get_policy(slug: str):
    """Return one policy in both structured and Markdown form."""
    key = slug.strip().lower()
    # Friendly aliases so common URL guesses work too.
    aliases = {
        "terms-and-conditions": "terms",
        "terms-conditions": "terms",
        "tos": "terms",
        "privacy-policy": "privacy",
        "return-policy": "return",
        "returns": "return",
        "payment-policy": "payment",
        "payments": "payment",
        "cancellation-policy": "cancellation",
        "cancellations": "cancellation",
        "seller-policy": "seller",
        "sellers": "seller",
        "prohibited-items": "prohibited",
        "prohibited-list": "prohibited",
    }
    key = aliases.get(key, key)
    policy = POLICIES.get(key)
    if not policy:
        raise HTTPException(status_code=404, detail=f"Unknown policy: {slug}")
    return PolicyResponse(
        slug=key,
        title=policy["title"],
        effective=EFFECTIVE,
        last_updated=LAST_UPDATED,
        intro=policy.get("intro"),
        sections=[PolicySection(**s) for s in policy["sections"]],
        markdown=_to_markdown(policy),
        contact_email=policy["contact_email"],
    )
