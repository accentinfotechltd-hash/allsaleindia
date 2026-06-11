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

## Backend refactor (June 2026)
Monolithic `server.py` (2,737 lines) split into modular packages:

```
backend/
  server.py        (92 lines) — thin FastAPI app factory; mounts routers under /api
  config.py        — env vars, taxonomy, regexes, NZ rules, return reasons
  db.py            — Mongo client + ensure_indexes()
  models.py        — All Pydantic request/response schemas
  utils.py         — Pure helpers (hashing, JWT, validate_indian_business, cart math)
  deps.py          — FastAPI auth dependencies
  services/        — DB-aware business logic
    notifications.py, stock.py, payouts.py,
    shiprocket.py, stripe_svc.py, cart.py,
    cloudinary_svc.py, seed.py
  routers/         — Route handlers grouped by domain
    auth, products, cart, seller, orders, checkout,
    returns, shiprocket, uploads, notifications, admin, health
```

Backward compatibility preserved: `server.py` re-exports
`decrement_stock_for_order`, `restock_for_order`, `create_payouts_for_order`,
and `db` so existing tests still work unchanged. All 158 backend tests pass
(plus the 10 `test_seller_payouts` in isolation; same pre-existing async
teardown flake when run together).

## Filters, Bulk-Edit, Analytics & CSV (June 2026)

**Buyer-side: shop catalog filters & sort**
- New `/api/products` query params: `sort` (price_asc | price_desc | newest | top_rated), `min_price`, `max_price`, `brand`, `in_stock`.
- New `GET /api/brands?category=…` returns distinct seller names for chip population.
- Frontend: `src/components/SortFilterSheet.tsx` bottom-sheet with sort options, 5 price presets + custom range, in-stock toggle, brand chips. Active filters render as orange chips above the grid with a "Clear all" pill.

**Seller-side: bulk-edit listings**
- `POST /api/seller/products/bulk` — single op against many products (always scoped to caller's `seller_id`).
- Actions: `set_price`, `adjust_price_pct`, `set_stock`, `adjust_stock`, `set_category`, `set_in_stock`, `delete`.
- Frontend `/seller/bulk-edit.tsx`: multi-select list + action chip strip + contextual input + confirmation dialog for destructive deletes.

**Seller-side: analytics dashboard**
- Anonymous counters: `view_count` (bumped on product detail open) and `cart_add_count` (bumped on add-to-cart).
  - Two unauth endpoints: `POST /api/products/{id}/track-view`, `POST /api/products/{id}/track-cart-add`.
- `GET /api/seller/analytics` returns per-listing rows + summary (total views/carts/sold/revenue/conversion %) + Top 5 by views & by sold.
- Frontend `/seller/analytics.tsx`: 4 summary cards, conversion banner, Top-5 lists, per-listing rows with views/carts/sold/conversion metrics.

**Seller-side: CSV export of orders**
- `GET /api/seller/orders.csv` streams a CSV (one row per item) with columns: order_id, created_at, buyer_name, buyer_city, buyer_region, product_id, product_name, quantity, unit_price_nzd, item_subtotal_nzd, order_status, awb_code.
- Frontend: download button in seller orders header. On web, blob-download via anchor click; on native, write to cache + share sheet via `expo-file-system` + `expo-sharing`.

## Returns visibility (June 2026)
Made returns option discoverable from anywhere a buyer might look:
- **Account tab**: New `My returns` row (just under `My orders`) routes to `/returns`.
- **My Returns screen** (`/app/frontend/app/returns.tsx`): lists every return the user has submitted from `GET /api/returns/me` with status pill, reason, refund amount, and a friendly empty state with a `Go to my orders` CTA.
- **Order detail screen**: returns section is now ALWAYS shown when relevant — when the order is `delivered` it shows the "Request return" CTA (existing); when the order is in any pre-delivered state (paid/shipped/out_for_delivery) it shows a subtle disabled hint card explaining when returns become available and a link to the return policy.
- **Orders list**: delivered rows now show a `↻ Request return` inline link below the row footer (uses `e.stopPropagation()` so it doesn't navigate to order detail).

## Photo proof & cancel discoverability (June 2026)

**Photo proof on returns (mandatory for seller-paid reasons)**
- `/app/frontend/app/order/[id]/return.tsx`: new "Photo proof" section above the seller-notes textarea. Picks images via `expo-image-picker`, uploads to Cloudinary (existing `/api/uploads/image`), and stores URLs on the return doc.
  - Required (1–4 photos) when reason is `damaged_on_arrival` / `wrong_item` / `not_as_described` / `defective`.
  - Optional for `changed_my_mind`.
  - Handles permission denial gracefully (`handle_permissions_contract`).
- Backend `/api/returns/request` enforces the same rule (400 with friendly detail if missing). Validation happens AFTER order-ownership check so unauthorized requests still return 404 instead of leaking that an order exists.
- Seller-side `/seller/returns` now renders the buyer's proof images as a "Buyer's proof photos" tile strip (tap to open in browser).
- 4 new backend tests cover: missing-photos rejection, change-of-mind optional, max-photos enforcement, and seller visibility of submitted photo URLs.

**Cancel discoverability from orders list**
- `/app/frontend/app/orders.tsx`: inline `× Cancel order · 11h left` link below the row footer whenever an order is still within the 12-hour cancellation window. Includes a confirmation dialog before issuing the cancellation.

Test suite: 162 backend tests pass (up from 158).

## Short video proof on returns (June 2026)

**Backend**
- New `POST /api/uploads/video` endpoint — Cloudinary `resource_type=video`, 20 MB / ~30 s cap; rejects clips >35s via server-side cleanup.
- `ReturnRequestCreate` / `ReturnRequest` models gain `videos: List[str]` (max 1).
- `/api/returns/request` validates `len(videos) <= 1`. Videos remain optional even for seller-paid reasons.
- Backend tests: `test_max_one_video_enforced`, `test_video_optional_and_visible_to_seller`.

**Frontend**
- Return request screen: new "Add video" tile in the proof grid (uses `expo-image-picker` with `MediaTypeOptions.Videos` and `videoMaxDuration: 30`). Shows duration limit hint, upload spinner, and a remove button. Uploads via the new `/api/uploads/video` endpoint and stores Cloudinary URL.
- Seller-side returns view: video proof renders as a dark tile with film + play badge; tap opens the Cloudinary URL.
- 164 backend tests pass (up from 162).
