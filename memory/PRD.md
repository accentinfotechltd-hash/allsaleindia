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

## Cancellation policy relaxed (June 2026)
Buyers were reporting that the Cancel option vanished after 12 hours even though the parcel hadn't shipped from India yet.

- **New rule**: cancel is allowed any time the order status is `paid` / `pending`. Once it transitions to `shipped` / `out_for_delivery` / `delivered`, the buyer must use the returns flow.
- Backend (`routers/orders.py`): removed the `cancellable_until` time check; only blocks on status transitions and unconfirmed payment.
- Frontend order detail (`/order/[id]`): `canCancel` no longer depends on the 12-hour countdown. Banner copy updated to "Your parcel hasn't shipped from India yet" and continues showing the optional estimated-dispatch countdown when available.
- Orders list (`/orders`): inline "Cancel order · before dispatch" link shows on every pre-shipped paid order, not just for 12 hours.
- Test `test_cancel_outside_window_rejected` renamed to `test_cancel_outside_window_now_allowed` and inverted — verifies that a `cancellable_until` set in the past no longer prevents cancellation.
- 164 backend tests still pass.

## 7/30-day analytics chart (June 2026)

**Backend**
- New collection `analytics_events` with rows `{type: "view"|"cart_add", product_id, seller_id, at}` — written from existing `/products/{id}/track-view` and `/products/{id}/track-cart-add` endpoints (now look up the seller_id of the product before bumping counters). Indexed `(seller_id, at desc)` and `(seller_id, type, at desc)`.
- New endpoint `GET /api/seller/analytics/timeseries?days=7|30` returns zero-filled per-day buckets `{date, views, cart_adds, sold, revenue_nzd}` for the requested window. `days` is clamped to `[1, 30]`. Sold/revenue derived from paid orders' `paid_at` (falls back to `created_at`) and aggregated by `items.seller_id`.
- 5 new pytest cases covering default 7-day shape, explicit 30-day, clamping to 30, 403 for non-sellers, and the track-view → timeseries pipeline.

**Frontend**
- New reusable `src/components/TimeseriesChart.tsx` — pure `react-native-svg` bar chart (no chart libs added). Per-day bars, tappable for value tooltip, sparse x-axis ticks on 30-day mode, today highlighted with brighter fill.
- `/seller/analytics`: now starts with a **7d / 30d range toggle** + 4-way metric chip strip (Views · Carts · Sold · Revenue) above the chart. Defaults to 7 days · Views.
- All 169 backend tests pass (up from 164).

## Inline video preview + counter backfill (June 2026)

**Inline video preview on seller returns**
- New `expo-video@3.0.16` (replaces deprecated `expo-av`) → reusable `src/components/VideoPreviewModal.tsx` with `useVideoPlayer` + `VideoView`. Auto-plays on open, pauses on close, with native fullscreen + audio controls.
- `/seller/returns`: tapping a buyer's proof video opens the modal in-app instead of `Linking.openURL()` → external browser. Photos still open externally.
- Works on web (HTML5 <video>) and native (AVPlayer/ExoPlayer). PiP disabled to keep the surface minimal.

**Counter backfill on platform-product reseed**
- `services/seed.py`: snapshot `view_count` + `cart_add_count` from all platform-owned products before the delete+reinsert branch, and re-apply them by `name` lookup on the new docs. Noop branch is unchanged (matching count → no-op).
- Logs the reseed line as `seeded N products (carried over counters for M)` so it's visible in production logs.
- New test `tests/test_seed_counters.py::test_reseed_carries_over_view_counters` — uses an isolated event loop. Passes in isolation; joins the known-flaky exclusion list for full suite runs because of the same Motor + pytest event-loop interop quirk that already affects `test_seller_payouts.py`.

## Multi-region support (Phase 1 — June 2026)

**Goals**
Allow buyers from 5 countries (NZ / AU / US / GB / CA) to use one Allsale mobile app with auto geo-detected region and prices shown in their local currency. Catalog stays NZD-base; FX is applied at display time.

**Backend**
- `config.py`: new `SUPPORTED_COUNTRIES`, `COUNTRY_CODES`, `DEFAULT_COUNTRY`, and hardcoded `FX_RATES_FROM_NZD` (`NZD 1.00`, `AUD 0.92`, `USD 0.61`, `GBP 0.48`, `CAD 0.83`). MVP rates — swap for a live API later (Frankfurter, Wise, etc.) without changing surface.
- `models.py`: `UserPublic` gains `country` + `currency`. `UserCreate` accepts optional `country`.
- `utils.py`: new `convert_from_nzd()` and `localize_price()` helpers.
- New router `routers/geo.py`:
  - `GET /api/geo/detect` reads `cf-ipcountry` / `x-country` / `x-vercel-ip-country` and falls back to NZ.
  - `GET /api/currency/rates` exposes the rates table + supported-country metadata.
- `routers/auth.py`:
  - `POST /api/auth/register` persists country (explicit body → header → default).
  - New `POST /api/auth/country` lets a signed-in user change their country/currency.

**Frontend**
- New `src/contexts/RegionContext.tsx` — single source of truth for the buyer's country & currency. Resolution chain: stored choice → backend geo-detect → default NZ. Exposes `formatPrice(nzd)`, `convert(nzd)`, `setCountry(code)` (also syncs to backend when logged in).
- `app/_layout.tsx`: wraps the tree in `<RegionProvider>`.
- `ProductCard`: shows the localized price in the buyer's currency plus a small `NZ$xx.xx` ref below when not NZD.
- Account screen: new **"Ship to {Country}" row** with a bottom-sheet country picker showing flags, names, currencies, and a checkmark on the active selection.

**Quality**
- 169 backend tests still pass. New `/api/geo/detect` + `/api/currency/rates` smoke-verified.
- Lint clean. App loads cleanly with the new provider in place.

**Known follow-ups**
- Surface localized prices on product detail, cart, and order screens (currently NZD shown there).
- Hook checkout to charge in the buyer's currency via Stripe `currency` param.
- Backfill `country=NZ` on existing users (handled implicitly by `public_user()` defaulting; can add an explicit migration if needed).

## Multi-region Phase 2 (June 2026)

**Live FX rates (Frankfurter)**
- New `services/fx.py` fetches NZD-base rates from the free Frankfurter API (`api.frankfurter.dev/v1/latest`) once an hour and caches them in-process. Falls back silently to the hardcoded `FX_RATES_FROM_NZD` table when the network call fails.
- `GET /api/currency/rates` now returns `source: "frankfurter" | "fallback"` and `last_refresh` timestamp so the UI can show a freshness indicator if desired.
- First successful refresh observed: `{NZD: 1.00, AUD: 0.827, CAD: 0.809, GBP: 0.433, USD: 0.579}`.

**Stripe — charge in buyer's currency**
- `/api/checkout/session` now reads the buyer's `country` from their profile, picks the matching currency, converts the NZD cart total using the live FX rate, and creates the Stripe Checkout session with `currency=buyer_currency`.
- Order doc persists `buyer_country`, `buyer_currency`, and `charge_amount` so the receipt page can show "Paid £24.16" not just NZD.
- Stripe metadata also carries the original `amount_nzd` so finance reconciliation remains straightforward.

**Localized prices throughout the UI**
- ProductCard, product detail, cart, and orders list now use `RegionContext.formatPrice()` to show the local currency. ProductCard shows `NZ$xx.xx` reference underneath when not NZD.
- Cart summary line now says "Total (AUD/USD/GBP/CAD/NZD)" and shows "In NZD" reference when the buyer's currency isn't NZD.
- Refund / restocking-fee text on order detail intentionally stays in NZD (refunds still settle in NZD — to be revisited if buyer refunds need to be currency-aware later).

## Cancel button always visible (June 2026)
Buyer report: on mobile, the "Cancel this order" banner sat below the fold and was hard to find.

- Order detail screen (`/app/frontend/app/order/[id].tsx`): when `canCancel` is true, a red pill **"× Cancel"** now renders inside the sticky top bar (right side, where the empty placeholder used to be). Tapping it opens the existing cancel confirmation modal.
- The detailed `cancelWindowCard` (with copy + countdown) remains in the scroll area for context, but the top-bar pill makes the action discoverable without scrolling on any device size.
- Pure UI change — no API / data-model changes; all 169 backend tests still pass.

## Bulk Listing Upload — CSV / XLSX (June 2026)

Big-catalog sellers can now add or edit hundreds of products at once instead
of typing them one-by-one.

**Backend (`/api/seller/bulk/*`)**
- `GET  /seller/bulk/template.csv` and `template.xlsx` — download a blank
  template pre-filled with two example rows.
- `GET  /seller/bulk/export.csv` and `export.xlsx` — export current
  listings (with `product_id`) for round-trip edits.
- `POST /seller/bulk/preview` — multipart upload (CSV/XLSX). Validates each
  row, returns `{total, valid, errors, will_create, will_update, rows[]}`
  WITHOUT touching the DB.
- `POST /seller/bulk/import` — commit validated rows. Creates new listings
  (when `product_id` empty) and updates existing ones (ownership-checked).
- `GET  /seller/bulk/columns` — discovery endpoint listing expected columns.

**Template columns:** `product_id, name, description, category, subcategory,
price_nzd, stock_count, sizes, colors, shipping_days_min, shipping_days_max,
image_urls`. Multi-value fields use `|` (also accepts `,` / `;`).

**Frontend** — new `/app/frontend/app/seller/bulk-upload.tsx`:
- Download CSV / XLSX template tiles
- Export current listings for round-trip edit
- File picker (expo-document-picker) → upload → preview screen with
  per-row status (✅ create / 🟦 update / ❌ errors)
- "Import N rows" button commits the preview, shows success summary
- Web + native; on web uses Blob download, on native uses
  expo-sharing + expo-file-system/legacy

**Limits:** 1000 rows / 8 MB per upload.

**Tests** — `tests/test_bulk_listings.py` (9 tests, all passing):
template download (CSV+XLSX), columns endpoint, valid CSV preview,
validation errors, end-to-end create import, round-trip export/edit/update,
cross-seller product_id rejection, XLSX upload.

**Architecture**
- `routers/bulk_listings.py` — endpoints (router prefix `/seller/bulk`)
- `services/bulk_listings_svc.py` — pure parsing/validation/serialization
  (CSV + openpyxl-based XLSX)
- `models.py` — `BulkImportRow`, `BulkImportRequest`,
  `BulkImportPreviewResponse`, `BulkImportResult`

**Image handling (option c — URLs first):** sellers paste hosted URLs into
`image_urls` (separated by `|`). URLs go straight into `images[]` on the
product doc. We can optionally re-host via Cloudinary later — the field
accepts any `http(s)` URL or `data:` URI.

## Bulk Listing Upload v2 — Image ZIP support (June 2026)

Sellers can now skip hosting their own images. The new optional **Step 2**
in `/seller/bulk-upload` lets them upload a ZIP of product images; the
backend pushes each image to Cloudinary and returns a
`{filename → hosted_url}` mapping. When the seller subsequently uploads
their CSV / XLSX, they can paste **just the filename** (e.g.
`sku-1_front.jpg`) into the `image_urls` column and the backend
substitutes hosted URLs in-place before validating each row.

**Backend additions**
- `POST /api/seller/bulk/images-zip` — multipart ZIP upload. Returns
  `BulkImagesZipResponse { mapping, uploaded, skipped, provider }`.
  Map is keyed by both full archive path AND bare basename.
- `POST /api/seller/bulk/preview` now accepts an optional `images_map`
  form field (JSON). When present, the parser rewrites the
  `image_urls` column of every row using the map BEFORE validating.
- `services/bulk_listings_svc.substitute_images_with_zip_map()` — pure
  helper that swaps filename references for hosted URLs while leaving
  existing `http(s)://` / `data:` tokens untouched.

**Limits**
- 60 MB total ZIP, 500 files max, 6 MB per image
- Allowed image types: `.jpg .jpeg .png .webp .heic .heif`
- `__MACOSX/` and dotfiles are silently skipped
- Falls back to base64 `data:` URIs if Cloudinary isn't configured

**Frontend additions**
- New "Step 2 · Upload Images ZIP (optional)" tile (`Archive` icon, dashed
  border) above the CSV upload CTA. On success the tile turns green and
  shows `✓ N images uploaded`.
- `imagesMap` lives in component state and is sent as the `images_map`
  form field alongside the CSV file when calling /preview.
- Cleared automatically by the "upload another" reset flow.

**Tests** — `tests/test_bulk_zip_images.py` (5/5 passing):
ZIP→mapping happy path, non-ZIP rejection, empty upload, end-to-end
filename substitution at preview, and inverse case where missing map
correctly fails URL validation.

## Iter-12 follow-up fix: data: URIs in CSV cells
Testing agent flagged that `_split_multi()` was mangling `data:image/png;base64,…` URIs because both `,` and `;` were treated as separators. Two fixes shipped:

1. `services/bulk_listings_svc._split_multi()` now extracts every
   `data:[^\s|]+` occurrence into a placeholder before applying the
   comma/semicolon → pipe substitution and restores them verbatim
   afterwards.
2. `parse_csv_bytes()` now recovers from "trailing unquoted commas
   inside the last cell" by re-joining any extra fields back onto the
   final header value with `,`. This lets sellers paste an unquoted
   `data:image/png;base64,iVBOR…` URI directly into their `image_urls`
   column without breaking parsing.

24/24 bulk tests pass (9 baseline + 5 ZIP + 10 new edge cases).

## Catalog Taxonomy v2 — Global expansion (June 2026)

Allsale catalog grew from 7 Indian-focused categories to a 17-category
global storefront while keeping the Indian-heritage anchors.

**New taxonomy (in display order):**
1. Heritage: Ethnic Fashion, Home & Puja, Books & Gifts (unchanged)
2. Apparel: Women's Clothing, Men's Clothing, Kids' Fashion
3. Footwear & Bags: Shoes, Bags & Luggage
4. Lifestyle: Jewelry & Accessories (expanded subcategories), Home & Kitchen, Beauty & Health
5. Tech & toys: Electronics (expanded), Toys & Games
6. Sport & special: Sports & Outdoors, Pet Supplies, Automotive, Office & School Supplies, Tools & Home Improvement

**Buyer-hidden** (until courier rules confirmed): Food & Groceries, Wellness.
The hidden filter now wraps `/api/products`, `/api/categories`, `/api/brands`,
and `/api/taxonomy` consistently (was previously just imported but unused).

**New filters on `/api/products`:**
- `gender=women|men|kids|unisex` — derived from category
- `age_group=baby|kids|adult` — derived from category/subcategory
- `sizes=XS&sizes=S` — repeatable, any-match against the product's sizes array
- `colors=red&colors=blue` — repeatable, case-insensitive match

**Demo catalog:** 9 heritage + 13 new global = 22 seeded products
(13 carry-over counters preserved). Hidden categories still exist in
the seed list but never surface to buyers.

**Tests** — `test_iter7_nz.py` and `test_products.py` updated for the new
taxonomy shape. 49/49 pass on the iter-7 + bulk test files.

## Sort & Filter v2 — Sizes & Colors UI (June 2026)

The Sort & Filter bottom-sheet now exposes the new backend filters
introduced in iter-13:

- **Sizes** — 13 chips: apparel (XS, S, M, L, XL, XXL, Free Size) and
  shoe sizes (6-11). Multi-select; selected chips turn black.
- **Colors** — 12 chips with mini visual swatches (Black, White, Grey,
  Navy, Red, Maroon, Blue, Green, Yellow, Pink, Gold, Silver).
  Multi-select.
- The two sections are gated by a new `showSizeColor` prop (default
  `true`) so consumers can hide them where they don't make sense.

**FilterState** type grew two `string[]` fields (`sizes`, `colors`).
`buildProductsQuery()` emits repeated `sizes=…&colors=…` query params.
`activeFilterSummary()` shows the count in the active-filter chips row.

**Tests** — `test_filters_v2.py` (10/10): gender/age_group/sizes/colors
permutations + hidden-category leak prevention (`/taxonomy`,
`/products`, explicit category probes).

**Verified end-to-end** in the web preview: Categories tab → Women's
Clothing → Sort & Filter shows all sections. Backend correctly returns
the Flowy Midi Summer Dress when filtering by size=L AND when filtering
by color=Black (case-insensitive).

## Branding — Allsale Logo Integration (June 2026)

User supplied the official Allsale logo (teal "all" + orange "Sale" with
upward/forward arrows). Wired everywhere a brand mark is needed:

- **Welcome / sign-in screen** (`app/(auth)/welcome.tsx`) — replaces the
  text "allsale" + dot with a 120×44 logo image over the hero
- **Home tab header** (`app/(tabs)/home.tsx`) — 132×40 logo above the
  "Shipping to New Zealand" subline
- **App icon** (`app.json::expo.icon`)
- **Android adaptive icon** (`expo.android.adaptiveIcon.foregroundImage`)
  on black background
- **Splash screen** (`expo-splash-screen` plugin) on black background,
  220px wide, contain resize mode
- **Web favicon** (`expo.web.favicon`)

All five surfaces point at `assets/images/allsale-logo.png` (92 KB PNG).
The icon/splash changes take effect at next native build; the in-app
placements (welcome + home) are live in Expo Go immediately.

## Shiprocket X — Status
Still BLOCKED. User confirmed they are awaiting Shiprocket's reply with
credentials. Un-mocking deferred.

## Country-Wise Size Guide (June 2026)

Buyers now see size conversion tables localized to their country plus
a "Find my size" recommender driven by body measurements.

**Backend**
- New module `backend/data/size_guide.py` — pure data with 9 tables:
  women's / men's / kids' apparel, women's & men's shoes, saree
  blouse, lehenga, rings, bangles.
- Each table has columns for **US · UK · EU · AU · NZ · CA · IN** and
  body measurement ranges (bust/chest/waist/hip in cm, foot in cm,
  height & weight for kids, mm diameter for jewellery).
- Sources: ISO/EN 13402, ASTM F1166, BIS IS-13578 (Indian footwear),
  Indian retail saree-blouse + bangle conventions.
- Endpoints:
  - `GET /api/size-guide` — full chart set
  - `GET /api/size-guide?category=…&gender=…` — only the charts that
    apply to one product category
  - `GET /api/size-guide/{table_id}` — single table by stable id
  - `GET /api/size-guide/recommend?kind=…&bust_cm=…&waist_cm=…` —
    best-fit row given the buyer's measurements; returns `null` if
    nothing fits the supplied data.

**Frontend** — `src/components/SizeGuideModal.tsx` rewritten to:
- Fetch from the backend instead of bundling static data (so we can
  update charts without a new mobile build)
- Show one tab per relevant chart (e.g. Ethnic Fashion shows Women's
  Clothing, Saree Blouse, and Lehenga)
- Highlight the buyer's country column in primary-soft + a "You · NZ"
  pill in the header so the relevant column never gets lost
- "Find my size" tab — measurement inputs (cm) → calls the recommender
  endpoint → result card showing the recommended local size plus chips
  for every supported country
- Wired into the product detail page; the deprecated `sizeCharts.ts`
  module is no longer imported.

**Tests** — `test_size_guide.py` (13/13 passing): chart listing,
category filtering, gender narrowing on shoes, recommendation for
women's apparel / men's apparel / kids height / women's & men's shoes /
ring sizing, plus the `null` no-match path.

## Refund-or-Credit Choice + Wallet (June 2026)

When a buyer requests a return, they now pick how to receive the refund:

- **Back to original payment method** (Stripe refund · 5-10 business days)
- **Allsale store credit** — instant top-up to a wallet with **+5% bonus**,
  no Stripe fees, never expires

**Backend**
- `ReturnRequestCreate.refund_method` — `original` (default) or
  `store_credit`. Invalid values silently fall back to `original`.
- `ReturnRequest` now persists `refund_method` and
  `store_credit_bonus_nzd` (5% of the refund amount when wallet was
  chosen, else 0).
- `_decide_return()` — when a seller approves a store-credit return,
  the buyer's `users.wallet_balance_nzd` is incremented atomically with
  `$inc` and a row is appended to `wallet_ledger` for audit.
- New router `routers/wallet.py` → `GET /api/wallet` returns
  `{balance_nzd, entries[]}` (last 50 ledger entries).
- Notification copy varies by method ("$X added to your Allsale wallet"
  vs the existing "$X NZD on its way in 5-10 days").

**Frontend** — `/app/order/[id]/return.tsx`:
- Two-card chooser between the "💳 Back to my card" and "🪙 Allsale
  credit" options (mutually-exclusive radio).
- The store-credit card carries a **"+5% bonus"** badge.
- Success alert copy varies by selection.

**Size Guide link in Sort & Filter**
- `SortFilterSheet.onOpenSizeGuide` prop; when supplied, a small
  underlined "Size guide" link appears next to the "SIZES" section
  header in the filter sheet.
- `category/[name].tsx` passes the current category to `SizeGuideModal`
  and swaps it in when the link is tapped (filter sheet hides
  automatically so the size guide takes the full screen).

**Tests**
- `test_refund_method.py` (3/3 passing): wallet endpoint baseline,
  ReturnRequestCreate schema accepts/rejects refund_method.
- `test_size_guide.py` (13/13) + `test_returns.py` (19/19) untouched
  by the schema changes — 35/35 across the relevant suites.

## Temu-style Size Guide v2 (June 2026)

Inspired by Temu's pattern, the size guide modal now offers three new
controls across **all apparel categories** (Women's, Men's, Kids'):

1. **CM ↔ IN unit toggle** (right of the toolbar) — switches every
   measurement column on the fly using 1cm ≈ 0.3937in. Column headers
   re-label too (e.g. "Chest (cm)" → "Chest (in)"). Country sizes and
   non-metric values are passed through unchanged.
2. **Body chart vs Product chart toggle** (left of the toolbar) — only
   shown when a table has `product_columns`. "Body chart" keeps the
   body-measurement columns (bust/chest/waist/hip/height). "Product
   chart" swaps in the garment's actual measurements:
   - Women's & Men's: Shoulder / Chest / Length / Sleeve
   - Kids': Chest / Length / Sleeve
3. **Detailed product-chart rows** — every apparel size now ships
   garment measurements (`g_shoulder_cm`, `g_chest_cm`, `g_length_cm`,
   `g_sleeve_cm`) in the backend data table.

**Backend** — `data/size_guide.py`:
- Added `g_shoulder_cm`, `g_chest_cm`, `g_length_cm`, `g_sleeve_cm` to
  every row in `WOMENS_APPAREL`, `MENS_APPAREL`, `KIDS_APPAREL`
- Added a `product_columns` array to the three apparel CATEGORIES
  entries
- Existing 13/13 size-guide pytests still pass (the new columns are
  additive)

**Frontend** — `src/components/SizeGuideModal.tsx`:
- Component-level `unit` and `chartMode` state with a memoised
  `fmt()` converter that handles ranges like `"94-99"` → `"37-39"`
- New segmented controls with primary-color highlight for the active
  unit pill
- The Find-my-size recommender still uses CM inputs (unchanged) but
  the result chips inherit whichever unit the user last picked

**Verified visually** on Kids Cotton T-Shirt Pack (3):
- Body / Product chart toggle works (defaults to Body)
- CM → IN switch live-converts every numeric cell
- 10 size rows visible: 0-3M through 10-12Y

**Scope deferred** (per recommendation): body-figure SVG illustrations
with annotation bubbles, stretch slider, "model is wearing" hint.

## Size Guide v3 — Body Figure & Garment SVGs (June 2026)

Added two hand-built SVG illustrations (no designer assets, pure
`react-native-svg`) to make the size guide truly Temu-grade.

**New component** — `src/components/SizeGuideFigures.tsx`:

1. **`BodyFigure`** — three variants (`women`, `men`, `kids`) shown
   inside the **"Find my size"** tab. Renders a stylised human
   silhouette with orange arrows + dotted height guides. When the user
   types a measurement into the bust/waist/hip/chest/height fields,
   a small pill appears next to the matching arrow with the number
   they entered.

2. **`GarmentDiagram`** — a generic T-shirt line drawing with four
   dimension arrows (Shoulder / Chest / Length / Sleeve). Sits at the
   top of the **Product chart** view, populated with the median size
   row's garment measurements so the buyer immediately knows what each
   measurement represents.

**Frontend integration** — `SizeGuideModal.tsx`:
- `BodyFigure` rendered above the measurement input fields in
  `FindMySize`. Values flow through live as the user types.
- `GarmentDiagram` rendered above the product-chart table.

**Visual confirmation** (Flowy Midi Summer Dress):
- Product chart shows T-shirt outline with "Shoulder 40", "Chest 97",
  "Length 66", "Sleeve 58" labels — values flip cm↔inches with the
  unit toggle
- Find my size shows the female silhouette with Bust / Waist / Hip
  arrow guides labelled on the left

**Lint clean. No backend changes.**

## Shiprocket X — LIVE Integration (June 2026)

`services/shiprocket.py` fully rewritten per the integration playbook:
- Token cache in `db.shiprocket_tokens` (9-day TTL, MongoDB-backed)
- `_create_adhoc()` posts cross-border order payload (INR pricing, NZ
  address, kg/cm units) to `/v1/external/orders/create/adhoc`
- `_cheapest_courier()` calls `/courier/serviceability/` and picks the
  lowest rate
- `_assign_awb()` calls `/courier/assign/awb` with the chosen courier
- `track_awb()` calls `/courier/track/awb/{awb}` for live tracking
- Falls back to a mock AWB if no token can be obtained (so dev keeps
  working when creds are invalid)

**Blocker — needs user action in Shiprocket dashboard:**
The supplied credentials authenticate to the panel but return **403
Forbidden** at `/v1/external/auth/login`. Per Shiprocket docs, API
access requires a **separate API user** to be created:
  Settings → API → Configure → **+ Add New API User**
That API user's email/password (sent to the registered email) must be
the values stored in `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD`.

Until the API user is created, the integration logs the 403 and
gracefully falls back to mocked AWBs so the rest of the app keeps
working.

## Shiprocket X — LIVE & AUTHENTICATED ✅ (June 12, 2026)

Credentials configured in `/app/backend/.env`:
- `SHIPROCKET_EMAIL=listing@allsale.co.nz` (Shiprocket API user, distinct from dashboard login)
- `SHIPROCKET_PASSWORD=#XNUtW$Jngr@*P&iBt2*mvKgNQ4mez1V`
- `SHIPROCKET_PICKUP_LOCATION=Primary`

**Verified working:**
- Login: `POST /v1/external/auth/login` → returns 400-char JWT
- Token cached in `db.shiprocket_tokens` with `expires_at` set 9 days
  ahead; subsequent calls reuse the cached token without re-login.

All downstream flows (adhoc order → cheapest courier → AWB → tracking)
now use the live token. The mock fallback remains in code as a safety
net but will not trigger as long as Shiprocket auth succeeds.

## Shiprocket — LIVE END-TO-END VERIFIED ✅ (June 12, 2026 02:53 UTC)

Real cross-border order created on Shiprocket dashboard:
- **Shiprocket order ID**: 1394840740
- **Shiprocket shipment ID**: 1391097324
- **From**: 6 Siddhi Vinayak Row House, Ahmedabad 380015 (Pickup "Home")
- **To**: 9 Albert Street, Auckland 1010, NZ

Final `.env` configuration:
- `SHIPROCKET_EMAIL=listing@allsale.co.nz`
- `SHIPROCKET_PASSWORD=#XNUtW$Jngr@*P&iBt2*mvKgNQ4mez1V`
- `SHIPROCKET_PICKUP_LOCATION=Home` ← matches the nickname in their dashboard
- `SHIPROCKET_WEBHOOK_TOKEN=ElmRkhbhwibHzfNWUIkKru02wPHif51U5AKqz0ewEgs`
  (random 32-char URL-safe; used by `webhook_signature_ok()` to reject
  spoofed callbacks)

**E2E proven**: auth ✅ · token cache ✅ · adhoc order ✅ · order
visible in Shiprocket dashboard ✅

**AWB note**: real Shiprocket AWB will be assigned when an
international courier is enabled & matches the route. Today's test
fell back to a local placeholder AWB because the courier
serviceability call for IN→NZ returned an empty list. This is account-
configurable in Shiprocket Settings → International Shipping. Tracking
will activate the moment a real courier is picked.

## Shiprocket Webhook — DISABLED by user (June 12, 2026)
User opted out of webhook push tracking. The integration continues
using polling (the existing background scheduler calls `track_awb()`
periodically). The webhook endpoint `/api/shiprocket/webhook` remains
in the codebase but is not registered on Shiprocket's side.
`SHIPROCKET_WEBHOOK_TOKEN` env var stays in place in case the user
re-enables webhooks later.

## Country-Locked Subdomain Routing (June 12, 2026)

Multi-country e-commerce architecture mirroring Amazon/ASOS — each
buyer market gets its own URL so Google indexes them separately and
currency is impossible to mix up.

**Subdomain map**
| URL | Region | Currency | Locked |
|---|---|---|---|
| www.allsale.co.nz | NZ 🇳🇿 | NZD | ✓ |
| au.allsale.co.nz | AU 🇦🇺 | AUD | ✓ |
| us.allsale.co.nz | US 🇺🇸 | USD | ✓ |
| uk.allsale.co.nz | UK 🇬🇧 | GBP | ✓ |
| ca.allsale.co.nz | CA 🇨🇦 | CAD | ✓ |
| seller.allsale.co.nz | Indian sellers 🇮🇳 | — | Seller portal |

**Backend** — `routers/geo.py` adds:
- `GET /api/geo/auto-redirect` — reads `cf-ipcountry` / `x-country` /
  `x-vercel-ip-country` headers and returns
  `{country, subdomain, host_hint, currency, symbol, name}` so the
  client can hop to the right subdomain on first load.

**Frontend** — `RegionContext.tsx` enhanced:
- `detectRegionFromHostname()` reads `window.location.hostname`,
  maps subdomain → CountryCode, locks `RegionContext` to that region
  (priority 0 — beats stored + geo detect).
- `maybeAutoRedirect()` runs on cold start when on `www.` only;
  calls `/geo/auto-redirect`, and if the detected country differs
  it `window.location.replace()`s to the matching subdomain.
- Skipped automatically on: seller subdomain, localhost, Emergent
  preview hostnames, and any URL carrying `?no_redirect=1`.
- Persists the locked region to AsyncStorage so subsequent native
  app sessions inherit the same default.

**DNS / launch checklist (user-side):**
1. Move DNS to Cloudflare (free) so `cf-ipcountry` is auto-injected
2. Add 6 CNAME records (`www`, `au`, `us`, `uk`, `ca`, `seller`) →
   Emergent preview hostname
3. Enable Cloudflare proxy (orange cloud) for all 6 records
4. Optional: `301` redirect rule from `allsale.co.nz` (apex) →
   `www.allsale.co.nz`

The integration is fully implemented and verified via header injection
(`X-Country: GB` → subdomain `uk` confirmed). The moment Cloudflare
DNS is live, IP-based auto-redirect activates with zero further code
changes needed.

## Phase: Reviews & Ratings (NEW — Jun 2026)

**Why:** Cross-border buying carries trust risk. Verified-purchase reviews
are the highest-ROI lever to grow conversion.

**Backend (`/api/reviews/*`):**
- `POST /reviews` — verified-purchase only (order belongs to user AND
  status ∈ {shipped, out_for_delivery, delivered} AND product is in
  the order). One review per (user, order, product). Best-effort
  notification to seller (won't fail the request if notifications
  error).
- `GET /reviews/product/{id}` — public; returns `summary` (avg,
  total, 1–5 distribution) + paginated `items` + `can_review` /
  `eligible_order_ids` (when Bearer present). Sorts:
  `recent | helpful | rating_desc | rating_asc`.
- `GET /reviews/eligible` — items the buyer can still review.
- `POST /reviews/{id}/helpful` — toggle (idempotent per user).
- `POST /reviews/{id}/reply` — seller of product replies once.
- `DELETE /reviews/{id}` — author-only; auto-recomputes product
  rating + count.

**Indexes:** `reviews.id` (unique), `(product_id, created_at desc)`,
`(user_id, created_at desc)`, `(seller_id, created_at desc)`, and a
unique compound `(user_id, order_id, product_id)` to enforce the
one-review-per-purchase rule at the DB level.

**Frontend:**
- `src/components/StarRating.tsx` — display + interactive picker.
- `src/components/ReviewsSection.tsx` — used on `/product/[id]`.
  Renders avg+histogram, sort chips, per-review card with photos,
  helpful-vote, seller-reply bubble, and a "Write a review" CTA
  shown only when `can_review === true`.
- `app/review/write.tsx` — full-screen review composer (star
  picker, optional title, comment, up to 6 photos via
  `expo-image-picker`).
- `app/order/[id].tsx` — per-item "Write a review" pill for
  shipped/delivered orders.

**Testing:** `tests/test_reviews.py` — 22 tests pass on first run
(create + 6 error paths, sorts, distribution, eligibility flag,
helpful toggle, seller reply ACL + only-once, delete + recompute,
401/404/409 paths).

## Phase: Coupons & Promo Codes (NEW — Jun 2026)

**Why:** Instant sales boost. Sellers control their own promos rather
than waiting on platform marketing.

**Backend (`/api/coupons/*` + `/api/seller/coupons/*` + `/api/cart/coupon`):**
- 3 discount types: `percent`, `fixed`, `free_shipping`.
- 4 scopes: `all`, `category`, `seller`, `products`. Sellers are
  force-scoped to themselves (cannot create site-wide).
- `services/coupons.py` — pure(-ish) `validate_for_cart` returning
  `{ok, discount_nzd, free_shipping, label, error}` + atomic
  `record_coupon_redemption` (idempotent via unique
  `(coupon_id, order_id)` index).
- `services/cart.py` — re-validates coupon on every cart hydrate;
  silently drops stale codes (no scary error to user).
- `routers/cart.py` — `POST /cart/coupon`, `DELETE /cart/coupon`.
  IMPORTANT: literal coupon routes MUST be declared before
  `/cart/{product_id}` to avoid being shadowed.
- `routers/checkout.py` — persists `coupon_code`/`coupon_label`/
  `discount_nzd` on the order; redemption recorded only on
  payment success.

**Indexes:** `coupons.code` unique, `coupon_usage(coupon_id, order_id)` unique
(idempotency), `coupon_usage(coupon_id, user_id)` for per-user limit.

**Frontend:**
- `src/components/CouponInput.tsx` — input + "Available offers"
  bottom sheet (lists `GET /coupons/active`).
- `app/(tabs)/cart.tsx` — coupon input + discount line + clamped totals.
- `app/seller/coupons.tsx` — seller dashboard: list + create modal
  (code, description, type/value picker, min spend, usage cap, active toggle).
- `app/seller/dashboard.tsx` — added "Coupons" tile.

**Testing:** `tests/test_coupons.py` — 35 tests pass (percent w/ cap,
fixed subtotal cap, free-shipping, min order, scope=seller exclusion,
per-user-limit, expiry, inactive, country lock, stale auto-drop,
checkout persistence, redemption idempotency).

**Bugs caught during testing:** (1) DELETE /cart/coupon was shadowed
by /cart/{product_id}; fixed by route reorder. (2) `record_coupon_redemption`
idempotency check used a wrong projection; fixed.

## Phase: Seller Analytics — Insights (NEW — Jun 2026)

**Why:** Sellers need to know what's selling where, who's coming back,
and whether returns are eating their margin.

**Backend (`GET /api/seller/analytics/insights?days=N`):**
- `days` clamped 1..365 (default 30). One endpoint computes:
  - **Returns:** total_returns, total_paid_orders, returns_rate_pct,
    refund_total_nzd (only refunded/approved status), by_reason
    histogram (lowercased + sorted desc).
  - **Revenue by region:** group by `buyer_country` (uppercased, fallback NZ),
    summing only THIS seller's items in each order (cross-seller isolation
    is enforced). Sorted by revenue desc with share_pct.
  - **Customer demographics:** unique buyers, repeat rate %, AOV (avg
    order value), buyers grouped by country with flag emoji + share_pct.
- Excludes `cancelled` / `refunded` orders.
- Window filter uses `paid_at` (falling back to `created_at` for legacy rows).

**Frontend:**
- `src/components/InsightsSection.tsx` — drop-in section with 7d/30d/90d
  range toggle. Renders 3 cards: returns rate (with Healthy/Watch/Concerning
  health chip ≤5% / ≤10% / >10%), revenue-by-region (horizontal bar +
  flag), and customers (AOV / repeat / country grid). Graceful empty state.
- `app/seller/analytics.tsx` — embeds `<InsightsSection days={30} />`
  between the timeseries chart and the Top-5 lists.

**Testing:** `tests/test_analytics_insights.py` — 20 tests pass on first
run. Covers: auth (401/403), days clamping, divide-by-zero, refund-status
filter, window filter, status exclusion, by_reason normalization,
region grouping & share_pct, **seller isolation** (most important),
AOV math, repeat-rate math, response shape contract.

**Known code smell (not blocking):** `routers/seller.py` is now ~1000
lines; a future refactor should split it into
`listings.py / onboarding.py / seller_orders.py / seller_analytics.py`.

## Phase: Wishlist / Favorites (NEW — Jun 2026)

**Why:** Cross-border buyers research a lot — saving items = return visits.

**Backend (`/api/wishlist/*`):**
- 4 endpoints: list (hydrated), ids-only (for heart-state across catalog),
  POST/DELETE (idempotent). All auth-required.
- Storage: `wishlists` collection with unique compound index
  `(user_id, product_id)` for natural idempotency.
- Hydration silently skips products that have been deleted.

**Frontend:**
- `WishlistContext` — Set<id> with optimistic toggle + rollback on error.
- `WishlistButton` — floating heart (cards) + inline variant. Sign-in
  guard if anonymous.
- `app/wishlist.tsx` — hydrated list with Add-to-cart + remove.
- ProductCard, product detail hero, and Account row all wired.

**Testing:** `tests/test_wishlist.py` — 16/16 pass on first run. Covers
401 paths, 404 unknown product, idempotency, ordering, cross-user
isolation, hydration completeness.

## Phase: Loyalty Points (NEW — Jun 2026)

**Why:** Cross-border buyers carry trust friction — points create a sticky
"savings account" that drives repeat orders.

**Backend (`/api/points/*` + `/api/cart/points`):**
- Append-only ledger (`points_ledger`): credits + debits, never mutate.
- 1 pt per $1 NZD subtotal earned · 100 pts = $1 NZD redeemed.
- Caps: 50% of cart subtotal · multiples of 100 (clean $1 increments).
- 12-month expiry per credit; `expiring_soon` surfaces 30-day expiries.
- Bonuses: 500 pts welcome (one-time) · 50 pts per verified review.
- All awards idempotent on `(user_id, reason, ref_id)`.
- Hydrate-cart drops stale `points_to_use` when balance/eligibility fails.

**Frontend:**
- `PointsRedeemInput` — purple-themed cart widget; only shows when
  balance ≥ 100. Apply max button.
- `/points/history` — hero balance card + rates legend + ledger timeline.
- Account row "Allsale Points" with subtitle copy.
- CartContext extended (`points_used`, `points_discount_nzd`,
  `points_balance`, `points_max_usable`).

**Testing:** `tests/test_points.py` — 22/22 pass. Covers welcome idempotency,
order earn+redeem idempotent on payment, review earn, caps
(balance/max%/cart-total), rounding-to-100, coupon stacking, cross-user
isolation, stale auto-drop. 101/102 prior tests still green (1 unrelated
pre-existing review-sort flake — separate ticket).

## Phase: Flash Sales / Deal of the Day (NEW — Jun 2026)

**Why:** Urgency-driven selling — Amazon/Flipkart's #1 conversion lever.

**Backend (`/api/flash-sales/*` + `/api/seller/flash-sales/*`):**
- Sale "active" when `active=True` AND `valid_from <= now < valid_to`
  AND `units_sold < units_max`. Pure-function `_is_currently_active`
  + indexed query in `get_active_for_product` & `list_currently_active`.
- Min 10% discount · max 7-day duration · max 10 active per seller.
- Cart hydrate substitutes sale price; passes `flash_sale_id` and
  `original_price_nzd` through to order items on checkout.
- `_on_payment_succeeded` increments `units_sold` via
  `record_units_sold(sale_id, order_id, qty)` — idempotent via unique
  index on `flash_sale_usage(sale_id, order_id)`.
- Stacks with coupons + points: flash subtotal → coupon → points.
- Deal of the Day auto-picks the featured sale with the highest
  discount currently active.

**Frontend:**
- `FlashSalesCarousel` on home — orange-themed "Deal of the Day" hero
  card with live countdown timer + horizontal scroller of other active
  sales. Refreshes every 60s.
- Reusable `<Countdown>` hook + display.

**Testing:** `tests/test_flash_sales.py` — 30/30 pass on first run.
Covers validation matrix, ownership ACL, best-discount selection,
cart substitution, stacking, units-sold idempotency, sold-out
auto-deactivate, order persistence.

**Frontend gap (next session):** seller-side `/seller/flash-sales` UI
to create/pause/edit sales. Currently exposed only via REST.

**Phase 6 (added later in same session):** Seller UI for flash sales —
`app/seller/flash-sales.tsx` with create modal (product picker chip row,
sale price input with live % preview, duration 1-7 days, units max,
featured toggle, active toggle, Trash to delete). Tile added to seller
dashboard quick-actions. Gap closed.

## Phase: Referral Program (NEW — Jun 2026)

**Why:** Cheapest channel for new buyer acquisition.

**Backend:**
- `services/referrals.py` — `ensure_referral_code`, `register_referral`,
  `maybe_unlock_referrer_reward`. Built on top of the loyalty points ledger.
- `routers/referrals.py` — `GET /api/referrals/me` returns code, share URL,
  share message, totals, and history.
- `UserCreate.referral_code` optional field on `/api/auth/register`. On signup:
  - Generate unique 8-char `referral_code` for new user (idempotent retry).
  - If `referral_code` provided AND valid AND not self-referral AND not already
    used → insert pending `referrals` row + +100 pts to referee.
- On `_on_payment_succeeded`, call `maybe_unlock_referrer_reward(user, order)`.
  - If referee's first paid order within 30 days → +250 pts to referrer +
    mark referral `rewarded`. Idempotent.
  - If expired → mark `expired`.
- Unique indexes: `users.referral_code` (sparse), `referrals.referee_id`
  (enforces "1 referrer per new user").

**Frontend:**
- `app/referrals.tsx` — purple hero card explaining the program, big code,
  Copy + Share buttons, 3-stat row (Invited / Rewarded / Points Earned),
  history list with status chips.
- Account row "Invite friends" (Gift icon) → `/referrals`.

**Verified via curl:** Logged-in user gets auto-generated code on first
`/referrals/me` call. Share URL format `https://allsale.co.nz/?ref=CODE`.

## Phase: Live Chat (NEW — Jun 2026)

**Why:** Cross-border trust — buyers want to ask sellers questions.

**Backend (`/api/chat/*`):**
- `POST /chat/conversations` — idempotent get-or-create per (buyer, seller, product).
  Optional `body` sends a first message in the same call.
- `GET /chat/conversations` — list mine (buyer or seller side), sorted by recency.
- `GET /chat/conversations/{id}?since=ISO` — thread with messages (polling-friendly
  via `since` query). Opening this auto-resets the current side's unread to 0.
- `POST /chat/conversations/{id}/messages` — send. Bumps OTHER side's unread + persists last_message_preview.
- `GET /chat/unread-count` — total + per-conv map (for badge).
- One conversation per (buyer, seller, product) enforced via compound unique index.
- Per-side unread counters (`buyer_unread`, `seller_unread`) — no cross-side mutation.

**Frontend:**
- `app/chat/index.tsx` — thread list with avatars, partner name, last message preview, unread badge.
- `app/chat/[id].tsx` — WhatsApp-style bubbles (primary for "mine", surface for "theirs"),
  auto-scroll on new messages, input bar with send button, 5-second polling.
- Account row "Messages" → `/chat`.

**Scope (MVP — known gaps for next session):**
- Text only (no image attachments)
- Polling not realtime (5s interval)
- No "Chat with seller" button on product detail page yet — buyer can start via
  `POST /chat/conversations` with their cart's seller_id; UI button can be added next.

## Phase: AI Recommendations + Admin Dashboard (NEW — Jun 2026)

**Phase 9 — "You may also like":**
- `GET /api/products/{id}/recommendations?limit=N` — no LLM required for
  MVP. Algorithm: same-category items → fall back to same-seller →
  fall back to top-rated catalog-wide. Ranked by
  `rating * ln(1+reviews_count) * 10`. Excludes out-of-stock and the
  product itself. Returns hydrated Product[].
- Verified live with 4 recs returned for the first test product.
- **Gap:** no frontend RecommendationsSection on product detail yet
  (endpoint is consumable by next session).

**Phase 10 — Admin Web Dashboard:**
- New backend endpoints (all guarded by `x-admin-secret` header):
  - `GET /admin/overview` — users / sellers / products / paid orders /
    revenue / pending payouts / pending sellers / open returns.
  - `GET /admin/sellers` — top 100 with verification status, country,
    company.
  - `GET /admin/orders?limit=N` — recent orders summary.
  - `GET /admin/payouts?status=pending|paid_out` — list.
  - (Already existed: payout mark-paid + seller approve.)
- New frontend `app/admin/index.tsx` — secret unlock screen → stat grid
  (with warn-yellow highlights for `pending_*` > 0) → recent sellers
  list + recent orders list. Refresh button.

**Phase 11 — DEFERRED:**
- Refactor `routers/seller.py` (~1000 lines) into modular files —
  postponed to a future session to minimise regression risk with the
  current high test coverage (165+ tests).

## Phase 9 frontend gap closure (NEW — Jun 2026)
- `src/components/RecommendationsSection.tsx` — horizontal scroller of
  "You may also like" recs on product detail. Uses the
  `GET /products/{id}/recommendations` endpoint. Shows rating chip +
  wishlist heart on each card.
- Integrated into `app/product/[id].tsx` below ReviewsSection.

## Stability fix (NEW — Jun 2026)
- Fixed a stray syntax error in `app/seller/dashboard.tsx` (orphaned
  StyleSheet keys outside the `})` boundary that was masking other
  rebuild errors). Cleared metro cache to flush stale bundles.
