# Allsale — Product Requirements (MVP)

## What it is
Cross-border e-commerce mobile app: New Zealand customers buy authentic Indian
products (ethnic wear, brass handicrafts, spices & tea, …) directly from India.
Inspired by AliExpress/Temu, but India-only origin and NZ-focused (NZD pricing
with INR reference, shipping to NZ).

## MVP scope (this iteration)

### Backend (FastAPI + MongoDB, Stripe via emergentintegrations)
- JWT email/password auth: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`
- Products catalog (9 seeded items across 3 categories)
  - GET `/api/products?category=&q=`
  - GET `/api/products/{id}`
  - GET `/api/categories`
- Cart (per-user, server-side)
  - GET `/api/cart`, POST `/api/cart`, PUT `/api/cart/{product_id}`, DELETE `/api/cart/{product_id}`
- Stripe Checkout
  - POST `/api/checkout/session` (creates Stripe Checkout Session + order)
  - GET `/api/checkout/status/{session_id}` (polled by app)
  - POST `/api/webhooks/stripe`
- Orders: GET `/api/orders`, GET `/api/orders/{id}`
- Shipping: free over NZD 100, else NZD 12 flat
- Currency: NZD primary, INR display (1 NZD ≈ 51 INR, fixed for MVP)

### Frontend (Expo Router)
- Welcome / Register / Login
- Bottom tabs: Home, Categories, Cart, Account
- Product detail screen
- Category detail screen
- Multi-field checkout form → Stripe Checkout (opened via expo-web-browser)
- Checkout status (polls backend, max 8 attempts)
- Orders list + Order detail (with tracking timeline)

## Not in this MVP (next iterations)
- Connect to existing allsale.co.nz account/API
- Wishlist
- Live currency conversion rate
- Reviews/ratings input (display only for now)
- Multi-image gallery / variants (size, colour)
- Admin panel for product CRUD

## Iteration 2 — Google OAuth (DONE)
- `POST /api/auth/google-session` exchanges an Emergent `session_id` for our JWT
- Users upserted by email; `provider` field distinguishes `google` vs `email`
- `Continue with Google` button on Welcome, Login and Register screens
- On web, redirects via `window.location.href`; on mobile, uses
  `expo-web-browser.openAuthSessionAsync` and parses the deep-link result
- App mount detects `session_id` in URL hash/query before falling back to
  `/auth/me`, supporting the web post-redirect flow

## Iteration 3 — Seller accounts (DONE)
- Two seller-onboarding entry points:
  - `Sell on Allsale` banner on Welcome → full seller signup with business form
  - `Become a seller` row in Account tab → upgrade an existing buyer to seller
- Indian-business verification at submission time:
  - GSTIN 15-char format + state-prefix regex
  - PAN 10-char format; cross-checked against GSTIN positions 3–12
  - CIN 21-char format (optional)
  - 6-digit Indian pincode
  - Auto-verified on format match; admin endpoint
    `POST /api/admin/sellers/{user_id}/approve` (X-Admin-Secret header) for
    manual approval
- Sellers CRUD listings: `POST/GET/DELETE /api/seller/products` (verified
  sellers only). Listings appear in main `/api/products` catalog with
  `seller_id` + `seller_name` so buyers see who they're buying from.
- Duplicate GSTIN returns 409 (not 500) — `pymongo.DuplicateKeyError` wrapped
  cleanly.

## Iteration 4 — Seller order routing + payouts (DONE)
- `OrderItem` snapshots `seller_id`/`seller_name` at order creation so the
  payout ledger is stable even if a listing is later edited or deleted.
- `GET /api/seller/orders` returns orders containing the current seller's
  items only — and within each order **filters to that seller's items**, so
  one seller never sees another seller's items in a shared order.
- `create_payouts_for_order(order_id)` runs on every payment-paid event
  (both `/api/checkout/status` poll AND `/api/webhooks/stripe`). It groups
  the order by `seller_id`, applies the 15% platform commission, and
  inserts one `Payout` per seller with status=`pending`. Idempotent — both
  via an early-return and a compound unique index on
  `(order_id, seller_id)`.
- `GET /api/seller/payouts` returns the seller's payout list plus
  lifetime/pending/paid_out NZD summary.
- `POST /api/admin/payouts/{payout_id}/mark-paid` (X-Admin-Secret) flips
  a payout to `paid_out` and stamps `paid_out_at`. Safe to retry.
- Frontend: seller dashboard now has Orders + Payouts quick cards;
  `/seller/orders` and `/seller/payouts` screens with rich summary card.

## Iteration 5 — Indian business types (DONE)
## Iteration 5 — Indian business types (DONE)
Seller signup/upgrade now requires picking one of the 7 Indian business
entity types. Validation is conditional on the type:

| Type | Key | MCA? | Required ID |
| --- | --- | --- | --- |
| Sole Proprietorship | `sole_proprietorship` | No | – |
| Partnership Firm | `partnership_firm` | No | – |
| LLP | `llp` | Yes | LLPIN (`AAA-1234` / `AAA1234`) |
| Private Limited | `private_limited` | Yes | CIN (21 chars) |
| Public Limited | `public_limited` | Yes | CIN (21 chars) |
| OPC | `opc` | Yes | CIN (21 chars) |
| Section 8 | `section_8` | Yes | CIN (21 chars) |

GSTIN + PAN remain required for all types (PAN must equal GSTIN[2:12]).
Backend: 400 if an MCA id is supplied for a non-MCA type, missing for an
MCA-required type, or wrong format. Unknown business_type returns 400.

Frontend `BusinessFields` now starts with a horizontal chip picker
(7 chips) and a hint box describing the active type. The CIN / LLPIN
input is rendered conditionally; non-MCA types show no MCA ID input at
all.

### Test data shortcuts
- Pvt/Public/OPC/Section 8 sample: GSTIN `27ABCDE1234F1Z5`, PAN
  `ABCDE1234F`, CIN `U74999MH2020PTC123456`.
- LLP sample: GSTIN `27ACDEF1234F1Z5`, PAN `ACDEF1234F`,
  LLPIN `AAB-1234` (or `AAB1234`).

## Smart business enhancement
Free-shipping unlock progress bar on cart — encourages users to add more items
to reach NZD 100 threshold, increasing average order value.
