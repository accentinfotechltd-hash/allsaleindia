# 📣 Mobile → Web Agent Sync Note (June 19, 2026)

**From:** Mobile (Expo) agent
**To:** Web (Next.js) agent
**Status:** 🟢 Mobile fully shipped. Awaiting your work.

> **June 19, 2026 — Stock Alerts**: New endpoint `GET /api/seller/analytics/low-stock?threshold=10&window_days=30` returns urgency-ranked stock alerts (`out` / `critical` / `low`) with daily velocity, days-of-cover, and recommended_restock per listing. Optional for web parity (mobile only for now).

> **June 20, 2026 — Wishlist Collections (named lists)**:
> - NEW endpoints on `/api/wishlist`:
>   - `GET /collections` → `{all_saved_count, collections: [{id, name, item_count, created_at}]}`
>   - `POST /collections` `{name}` (1-40 chars) → creates a named list
>   - `PATCH /collections/{id}` `{name}` → rename
>   - `DELETE /collections/{id}` → deletes the list; items inside get `collection_id=null` and reappear under "All saved" (we never destroy saved items)
>   - `PATCH /items/{product_id}` `{collection_id}` → move an item between lists (or back to All saved with `null`)
> - `GET /wishlist?collection_id=...` now filters to one collection.
> - Mobile renders horizontal collection chips on `/wishlist` (All saved · Diwali · Wedding · + New list); tapping refilters; "+ New list" opens a name prompt.
> - Web parity recommended for lists-as-shareable-gift-registries.

> **June 20, 2026 — Order delivery rating + Ships well badge**:
> - NEW: `POST /api/orders/{id}/delivery-rating` (auth, body: `{stars: 1-5, comment?: str≤300}`). Buyer of a delivered order rates the SHIPPING experience (not the product itself). Idempotent — re-submits update the existing rating without double-counting.
> - NEW: `GET /api/sellers/{id}/delivery-score` (public) → `{avg_stars, ratings_count, ships_well}`. `ships_well=true` only when count≥5 AND avg≥4.0.
> - Sellers collection now carries `delivery_score_sum` + `delivery_score_count` aggregates, updated atomically on each rating submit.
> - Order model now persists `delivery_rating: {stars, comment, rated_at}` (bug fix during testing — the field wasn't serialized).
> - Web parity recommended: surface "Ships well · X.X★" badge on PDPs and add rate-delivery link on `/orders`.

> **June 20, 2026 — Best Sellers leaderboard**:
> - NEW: `GET /api/best-sellers?category=X&limit=50&window_days=30` (public) — ranks in-stock products by units sold in the last N days from paid/non-cancelled orders; tiebreaks on rating × log(reviews); falls back to all-time top-rated when no window data (`source: "window_sales" | "rating_fallback"`). Cancelled orders & OOS items excluded.
> - Mobile renders `/best-sellers` with category chips + rank badges + "Bestseller" ribbon on top-3.
> - Entry: home tab shows two destination cards above flash sales — 🔥 Today's Deals + 🏆 Best Sellers.
> - Web parity recommended.

> **June 19, 2026 — Today's Deals page + Coupons-active P0 fix**:
> - NEW: `/deals` mobile route consolidating active flash sales (with live countdown timers + units-sold progress), public sitewide coupons (auth-gated horizontal strip with Copy-code), and a "More deals · 10%+ off" 2-col grid via the existing `min_discount_pct` facet.
> - Entry point: home tab's `FlashSalesCarousel` now has a "See all →" link to `/deals`, and renders a "Today's Deals" promo card when no flash sales are live.
> - FIXED: `GET /api/coupons/active` previously crashed with 500 when ambassador coupons (`cpn_amb_*` with `description=None`) tripped Pydantic. Endpoint now filters out personal/ambassador codes — they're 1:1 referrals, not browseable promos. Web parity must apply the same filter.

> **June 19, 2026 — Product Q&A**:
> - NEW collection `product_questions` + `product_answers`. Endpoints under `/api`:
>   - `GET /products/{id}/questions?sort=helpful|recent&limit=N` (public) — returns rows with `top_answer` preview + `answer_count` + `is_upvoted_by_me`
>   - `POST /products/{id}/questions` (auth) — text [5,500]
>   - `POST /questions/{qid}/answers` (auth) — text [2,1000], auto-tags `is_seller` and `is_verified_purchase`
>   - `POST /questions/{qid}/vote` and `POST /answers/{aid}/helpful` with `{direction: "up" | "clear"}` (idempotent)
>   - `GET /questions/{qid}/answers` (public) — full paginated answer list
> - Notifications: new q → seller (`qa_new_question`); new answer → asker (`qa_new_answer`). Both honour the existing notification-prefs mute system.
> - Web parity recommended for full Q&A consistency across platforms.

> **June 19, 2026 — Frequently Bought Together**:
> - NEW: `GET /api/products/{id}/frequently-bought-together?limit=3` → `{anchor, items, bundle_count, bundle_total_nzd, source}` where `source` ∈ `order_history | category_fallback | empty`. Co-purchase frequency computed from paid/non-cancelled orders; falls back to same-category top-rated when no history. Out-of-stock peers excluded.
> - Mobile renders an Amazon-style bundle widget on the PDP (visual strip + checkbox list + live total + "Add N items" CTA). Web parity recommended for AOV lift.

> **June 19, 2026 — In-app Notification Preferences**:
> - NEW: `GET /api/me/notification-prefs` → `{role, categories: [{key, label, description, enabled}]}` with role-based filtering (buyers don't see `seller_alerts`, etc.). Categories: orders, returns, reviews, support, back_in_stock, seller_alerts, promos.
> - NEW: `PUT /api/me/notification-prefs` body `{prefs: {<key>: bool}}` — partial upsert, returns merged state.
> - Mute logic lives server-side in `services/notifications.py::create_notification` — when a recipient has muted a category, the insert is SKIPPED. Admin recipients are never muted; unknown n_types are always delivered (forward-compat).
> - Web parity recommended so users can manage prefs from either platform.

> **June 19, 2026 — Amazon-style Subcategory Navigation & Facet Filters**:
> - NEW: `GET /api/categories/tiles` → `{tiles: [{name, blurb, subcategory_count, product_count, sample_image}]}` — drives the "Browse all categories" mosaic on the Search screen.
> - NEW: `GET /api/categories/{name}/subcategories` → `{category, blurb, subcategories: [{name, product_count, sample_image}]}` — drives the tile grid on each category landing page. Returns 404 for unknown / hidden categories.
> - NEW filter params on `GET /api/products`:
>   - `min_rating` (0–5) — Amazon's "4★ & up" customer-review filter
>   - `min_discount_pct` (0–99) — intersects with active flash sales
> - Mobile now ships a dedicated subcategory route `/category/{name}/{subcategory}` with breadcrumb + sibling-chip switcher (web parity optional). Filter sheet now exposes "Customer review" and "Deals & discount" chip sections.


---

## What's already shipped on mobile (your reference)

Mobile is **up-to-date** with every backend contract documented in `/app/memory/`:
- ✅ Ambassador Programme (incl. T&C approval + activation resend)
- ✅ Order Tracking 2.0 (detailed scan timeline, mark-received, reorder, message-seller)
- ✅ Phase 1.5 buyer experience polish:
  - 📸 Delivery proof photo (seller upload + carrier `pod_url` + Resend email)
  - ⏰ Smart ETA ribbon (`eta_summary` payload — 7 status states)
  - 🧾 In-transit milestone notifications (`shipment_milestone_arrived_in_destination`, `shipment_milestone_customs_cleared`)
- ✅ Review reporting flow
- ✅ FAQ search API (live, ready to wire if/when)

Refer to:
- `web_agent_handoff_ambassadors.md`
- `web_agent_handoff_approval_flow.md`
- `web_agent_handoff_order_tracking.md` *(includes ETA, proof-of-delivery, milestones)*
- `web_agent_handoff_notifications.md` *(NEW June 19 — bell icon + dropdown schema)*

---

## What we're waiting on you for

### 🟡 B2B Referral Schema (your backend turn)
**Mobile needs ZERO frontend work right now** — when you land the B2B referral backend schema, just **ping us** by:
1. Creating `/app/memory/web_agent_handoff_b2b_referral.md` with the endpoint + field spec.
2. Adding a single-line note at the top of this file: `B2B referral schema landed (see web_agent_handoff_b2b_referral.md).`

Mobile will then pick up the contract and surface UI in the next sprint.

### 🟢 Anything else new
If you ship any other backend contract changes, the same drop-a-handoff-doc convention applies — we'll pick them up on the next "next" prompt from the founder.

---

## Backend changes shipped this sprint (your FYI — no action needed on web unless you want parity)

**New endpoints:**
- `GET  /api/orders/{id}/tracking` (now includes `eta_summary` + `proof_of_delivery` + `milestones_notified` denormalised)
- `POST /api/orders/{id}/mark-received`
- `POST /api/orders/{id}/reorder`
- `POST /api/seller/orders/{id}/proof-of-delivery` (seller upload, fires Resend email to buyer)
- `POST /api/reviews/{id}/report`

**New `orders` collection fields:**
`shipped_at`, `out_for_delivery_at`, `delivered_at`, `buyer_confirmed_at`, `tracking_status`, `last_tracking_update`, `last_tracking_location`, `awb_code`, `proof_of_delivery`, `milestones_notified`.

**New `reviews` collection fields:** `reports[]`, `reported`, `moderation_status`, `reported_at`.

Test coverage: **67/67 PASS** across `test_order_tracking.py`, `test_eta_summary.py`, `test_proof_of_delivery.py`, `test_shipment_milestones.py`, `test_reviews.py`.

---

👋 Standing by. Tag us when B2B referral lands or anything new pops up.

---

## ⚡ June 19, 2026 — `/api/products` filter fix (mobile-agent triage)

The mobile agent flagged that these query-string flags were **silently no-ops** — the server accepted them but returned the full catalogue. **Fixed now (iteration 41).** Web should switch to using them where the old code may have been doing manual `.filter()` on the client.

### Contract (all optional, additive — combine via AND)

| Param | Type | Behaviour |
|---|---|---|
| `seller_id` | string | Only that seller's products. **Unknown id → `[]`** (was: full catalogue). |
| `on_sale` | bool | Products currently in an active `flash_sales` row (`active=true` & `valid_from ≤ now ≤ valid_to`). |
| `new` | bool | `created_at` within the last 30 days. |
| `bestseller` | bool | `rating ≥ 4.0` AND `reviews_count ≥ 50`. |
| `ambassador_pick` | bool | Product IDs referenced by `ambassador_picks` collection (active). Empty collection → `[]`. |

### Example calls
```
GET /api/products?seller_id=user_xxx&limit=24
GET /api/products?on_sale=true&sort=price_asc&limit=24
GET /api/products?new=true&limit=24
GET /api/products?bestseller=true&sort=top_rated&limit=24
GET /api/products?seller_id=user_xxx&bestseller=true   # AND'd
```

### Test coverage
`/app/backend/tests/test_products_filters.py` — **7/7 pass** (unknown-seller empty, single-seller scoping, new=30d, bestseller heuristic, on_sale=active flash sale, ambassador_pick empty-collection, combined AND).

## ⚡ June 19, 2026 — `POST /api/orders/{id}/invoice/email` (Resend)

NEW endpoint for the "Email this invoice" button on order detail.

### Auth
Buyer JWT — same `_fetch_order_for_invoice` gate as the PDF download. 401 anon, 403 if not your order, 400 if not paid yet.

### Body (all optional)
```json
{
  "to": "alt@email.com",          // forward to a different address; defaults to account email
  "message": "Hi team, attached…"  // short personal note prepended in the HTML body (≤1000 chars, lightly escaped)
}
```

### Response
```json
{
  "ok": true,
  "sent": true,                    // false when skipped (Resend not configured)
  "to": "buyer@example.com",
  "skipped": false,
  "reason": null,
  "resend_id": "re_…"              // null when not sent
}
```

When Resend isn't configured (dev / CI) the endpoint **does not 500** — it returns `sent:false, skipped:true, reason:"resend_not_configured"` so clients can show a friendly fallback.

### Side effects
- Pushes one row into `orders.invoice_email_log[]` per dispatch:
  ```json
  { "to": "...", "sent_at": ISO, "by_user_id": "user_xxx",
    "resend_id": "re_...", "ok": true, "reason": null }
  ```
  Used by admin/support to audit "did the buyer ever ask for a resend?"

### Tests
`/app/backend/tests/test_invoice_email.py` — **3/3 PASS** (graceful-skip happy path with audit log, 401 anon, 403 cross-buyer).

---

## ⚡ June 19, 2026 — Gift wrap per line item

NEW per-line gift-wrap support. Each cart line now carries `gift_wrap: bool` + `gift_message?: string` (≤240 chars). Flat **$5 NZD fee per wrapped line**, added on top of the existing total. Hydrated `CartView` now exposes `gift_wrap_fee_nzd` and `gift_wrap_count`.

### Endpoint
```
PATCH /api/cart/{product_id}/gift
Body: { gift_wrap: bool, gift_message?: string }
```
Returns the full hydrated `CartView`. **404** if the product is not in the cart. Toggling `gift_wrap=false` also clears any saved message. Messages are server-side trimmed to 240 chars.

### Cart hydration changes
```jsonc
{
  ...,
  "items": [
    { ..., "gift_wrap": true, "gift_message": "Happy birthday!" }
  ],
  "gift_wrap_fee_nzd": 5.00,
  "gift_wrap_count": 1,
  "total_nzd": <subtotal + shipping − discounts + gift_wrap_fee_nzd>
}
```

### Frontend usage hint
- Web checkout/cart should add a 🎁 "Gift wrap (+$5)" toggle next to each line.
- Show the per-order summary line `🎁 Gift wrap × N · +$<fee>` between Discount and Total (mirrors the mobile cart + checkout summary).

### Tests
`/app/backend/tests/test_cart_gift_wrap.py` — **3/3 PASS** (end-to-end toggle with message + fee math, auth gate, 240-char truncation).

---

## ⚡ June 19, 2026 — Back-in-stock waitlist

NEW one-shot "Notify me when back in stock" flow. Web can wire it on any OOS PDP.

### Endpoints (buyer JWT auth)

| Verb | Path | Returns |
|---|---|---|
| `GET` | `/api/products/{id}/notify-when-in-stock` | `{ "watching": bool }` |
| `POST` | `/api/products/{id}/notify-when-in-stock` | `{ "watching": true, "newly_added": bool }`. **400** if product is already in stock; idempotent on repeat opt-in. |
| `DELETE` | `/api/products/{id}/notify-when-in-stock` | `{ "watching": false, "removed": bool }` |
| `GET` | `/api/me/stock-watch` | `{ "items": [{ product_id, name, image, price_nzd, in_stock, created_at }] }` |

### Server-side fan-out

Whenever a seller's listing update crosses stock from **0 → >0** (via `PATCH /seller/products/{id}`), `notify_back_in_stock(product_id)` fires automatically:
- creates `notifications` row with `type="back_in_stock"` for every waitlisted buyer
- sends a Resend email (best-effort; degrades silently if Resend isn't configured)
- **deletes the waitlist rows** so each buyer is notified exactly once. Buyers must opt in again on the next OOS event.

### Tests
`/app/backend/tests/test_stock_waitlist.py` — **4/4 PASS** (opt-in/out, 400-when-already-in-stock, fan-out + waitlist clear, /me/stock-watch list).

---

## ⚡ June 19, 2026 — Google Places autocomplete proxy

NEW server-side proxy around Google Places API (New). Key stays on the server so the device never sees `GOOGLE_MAPS_API_KEY`.

### Endpoints (buyer JWT auth)

| Verb | Path | Returns |
|---|---|---|
| `GET` | `/api/geo/places/autocomplete?q=...&session_token=...&country=nz` | `{ "results": [{ place_id, primary_text, secondary_text, description }] }` |
| `GET` | `/api/geo/places/details?place_id=...&session_token=...` | `{ place_id, formatted_address, address: {line1, line2, city, region, postal_code, country (ISO-2)}, lat, lng }` |

`country` defaults to the full supported region set (`nz, au, us, gb, ca, in`) when omitted.

### Session-token discipline (billing-sensitive)

Pass the **same `session_token` UUID** from the user's first keystroke until the matching `/details` call. Google bills autocomplete-within-session at $0 and only the single `/details` call costs $0.017. Rotate the token after each successful resolve.

Mobile client: `/app/frontend/src/components/PlacesAutocomplete.tsx` handles this automatically — web can copy the pattern.

### Frontend usage
- Mobile: drop-in component in `/app/frontend/app/checkout.tsx` replacing the static line1 field. On select, auto-fills `line1`, `line2`, `city`, `region`, `postal_code`, and ISO-2 `country`.
- Web: same endpoints, same session-token contract.

### Live status
Verified live against `https://allsale-shop.preview.emergentagent.com`:
- `"Queen Street Auckland"` → 5 suggestions, top result resolves to `Queen Street, Auckland CBD, Auckland NZ` with lat/lng `(-36.851, 174.764)`.

### Cost
Google free tier covers ~17,000 autocomplete sessions/month at $200 credit. Session-token mode is the cheapest pattern by ~80×.

---

## ⚡ June 19, 2026 — Static Maps endpoint + Recently-viewed clean contract

### `GET /api/geo/places/static-map?lat=&lng=&zoom=&width=&height=`
Server-proxied Static Maps PNG with a red marker. Raw `image/png` bytes, 24h cache header. Key never leaks.

**⚠️ Requires "Maps Static API" enabled** in the Google Cloud project (in addition to Places + Geocoding). Returns **502** with a logged 403 if Google rejects.

### Recently-viewed — already cross-device synced ✅
`db.product_views` is keyed on `user_id` — logging in on a new device automatically restores the rail. No new work needed; documenting only.

Two equivalent endpoints:
- `GET /api/recommendations/recently-viewed?limit=12` — legacy, supports `?session_id=` for anon
- `GET /api/me/recently-viewed?limit=20` — **NEW** cleaner contract (auth-only). Same upsert + clear semantics via `POST`/`DELETE`.






---

## ⚡ June 19, 2026 — Saved searches

NEW per-user saved-search persistence. Buyers persist filter combos and re-launch them from `/account/saved-searches`.

### Collection
`db.saved_searches`: `{id, user_id, name, q?, category?, subcategory?, filters: {}, notify: bool, created_at}` — max 25 per user.

### Endpoints (buyer JWT)

| Verb | Path | Notes |
|---|---|---|
| `GET` | `/api/me/saved-searches` | List (newest first) |
| `POST` | `/api/me/saved-searches` | Body: `{name, q?, category?, subcategory?, filters?, notify?}`. 400 if at 25-row cap. |
| `PATCH` | `/api/me/saved-searches/{id}/notify` | Body: `{notify: bool}` |
| `DELETE` | `/api/me/saved-searches/{id}` | 404 if not owned by caller |

### Frontend usage
Mobile shipped: ⭐ "Save search" chip in the active-filters bar on `/category/[name]`, full management screen at `/account/saved-searches` (open via tile in `/account`).

### Verified live
POST → id `ss_*` ✓ · GET list ✓ · PATCH notify=true ✓ · DELETE ✓

---

## ⚡ June 19, 2026 — Public shareable wishlist links

NEW one-token public wishlist sharing.

### Endpoints
| Verb | Path | Auth | Returns |
|---|---|---|---|
| `POST` | `/api/wishlist/share` | buyer JWT | `{ token, url, deep_link }`. Idempotent — re-mints the SAME token if user has one. |
| `DELETE` | `/api/wishlist/share` | buyer JWT | `{revoked:true}`. Sets `wishlist_share_enabled=false` (token survives so re-enabling restores the same link). |
| `GET` | `/api/wishlist/share/{token}` | **PUBLIC** (no auth) | `WishlistItem[]`. **404** if token unknown OR share was revoked. |

### User fields added
`users` collection gains `wishlist_share_token: string` + `wishlist_share_enabled: bool`.

### Frontend usage
Mobile shipped: "Share" link in wishlist header — mints/refreshes token and opens native iOS/Android share sheet pre-filled with the canonical `https://allsale.co.nz/w/<token>` URL.

Web should build a public read-only page at `/w/<token>` consuming `/api/wishlist/share/<token>`. No auth required on that page so it's perfectly indexable / forwardable.

### Verified live
mint → 200 token `qRJksyln02L58iGc` · public view → 200 (1 item) · revoke → 200 · public view after revoke → 404 ✓


## Wishlist Collections — Bulk Move (June 20, 2026)
Buyers can now bulk-move multiple wishlist items between named collections.

### Endpoints (all already existed; verified end-to-end)
- `PATCH /api/wishlist/items/{product_id}` body `{collection_id: string | null}`
  - 200 → moves the item to the target collection (or back to "All saved" when `null`)
  - 404 → product not in wishlist
  - 404 → `collection_id` does not exist for this user
- `GET /api/wishlist?collection_id=<id>` → filters list to a single collection
- `GET /api/wishlist?collection_id=` (empty string) **now treated as omitted → returns all** (June 20 fix in `routers/wishlist.py:49`).
- `GET /api/wishlist/collections` → `{all_saved_count, collections:[{id, name, item_count}]}`

### Mobile UX
- Selection mode in `/app/frontend/app/wishlist.tsx` gained a third "Move to list (N)" action between Remove and Move-to-cart.
- New `moveListOpen` modal renders "All saved (no list)" + every existing collection. Tapping a target fires `PATCH` in parallel for every selected product, then refreshes both the list and collection counts.
- Toast confirms: e.g. "Moved 2 items to Diwali".

### Web suggestion
Mirror the same UX inside the saved-items / wishlist surface: multi-select + a "Move to list" picker that calls the same PATCH per item. The empty-string fix means web can safely pass through query strings without normalising.

### Tests
- `backend/tests/test_wishlist_collections_move.py` — 13 cases, all pass.


## Backend refactor — products router split (June 20, 2026)
The previous monolithic `routers/products.py` (~830 lines) has been split:

- `routers/products.py` (~520 lines) — catalog (`GET /products`, `GET /products/{id}`), brands, categories, taxonomy, category tiles, subcategory tiles, duty estimate, prohibited check, and the `/products/{id}/reviews` alias.
- `routers/product_extras.py` (NEW, ~310 lines) — `GET /best-sellers`, `GET /products/{id}/recommendations`, `GET /products/{id}/frequently-bought-together`.

**No URL changes** — every public `/api/...` path is identical. Web agent does not need any updates. Mounted in `server.py` immediately after `products.router`.

## Backend perf — Q&A list endpoint $lookup (June 20, 2026)
`GET /api/products/{product_id}/questions` no longer issues N+1 queries to fetch each question's top answer. The handler is now a single `aggregate()` pipeline using `$lookup` against `product_answers`, sorted by helpful_count desc + created_at desc, limited to 1 nested doc per question. Response shape unchanged.

## Backend tests
Critical-path suites: **102/102 pass** across qa, best_sellers, frequently_bought_together, wishlist_collections_move, subcategory_and_facets, delivery_rating, notification_prefs, analytics_low_stock.


## Seller Catalog Importer — Amazon / Flipkart / CSV (June 20, 2026)
**Major onboarding accelerator** — sellers can bring their existing Amazon Seller Central or Flipkart Seller Hub catalog into Allsale with one upload. Auto-mapping + AI clean-up via Claude Sonnet 4.5.

### Endpoints (seller-only — verified or auto_verified)
- `POST /api/seller/import/preview` (multipart) — body: `file` (xlsx/xlsm/xls/csv, ≤25 MB) + optional `source_hint` (`amazon|flipkart|csv`). Returns `{preview_token, source, total_rows, ready_count, needs_attention_count, fx_inr_to_nzd, warnings, rows[]}` where each row has `{row_index, product (mapped Allsale schema), issues[], ready}`. **No DB writes.** Preview cached 2 h.
- `POST /api/seller/import/commit` (JSON) — body: `{preview_token, rows: [{row_index, publish, overrides?}], margin_pct, enrich_with_ai}`. Returns `{created, updated, skipped, failed, failed_details[]}`. Updates existing products by `(seller_id, sku)`, inserts new ones with fresh `pdt_*` ids.

### Field mapping highlights
- Amazon SKU/Item Name/Brand/Bullet Points × 5/Main Image URL/Other Image URL × 8/Color/Size/HSN → mapped to Allsale schema.
- Flipkart Seller SKU ID/MRP/Selling Price (INR)/Stock/Brand+Model/Main Image/Other Images × 4/HSN/EAN/Country Of Origin/L×B×H/Weight (KG) → mapped 1:1.
- Category auto-detected: Amazon `product_type` (HAIR_CONDITIONER → Beauty & Health/Hair Care) + Flipkart sheet name (`saree` → Ethnic Fashion/Sarees).
- INR → NZD auto-conversion using `INR_PER_NZD` (config-controlled, default 51).
- Optional global margin % uplift applied at commit time.

### Tier 2: AI Enrichment (Claude Sonnet 4.5 via Emergent LLM Key)
- Detects Hindi/Devanagari/Hinglish in descriptions → translates to natural English.
- If <3 bullet points and description >80 chars → generates 5 bullet points.
- Runs only when seller opts in. Failures degrade gracefully (no rejection).
- Each enriched product carries `ai_enrichment: ["translated_description", "generated_bullets"]`.

### Mobile UI
`/seller/import.tsx` — 5-step wizard: Source → Upload → Preview/select rows → Settings (margin + AI toggle) → Success. Linked from `/seller/dashboard` as **"Import Amazon / Flipkart"** quick card.

### Tests
- `backend/tests/test_catalog_importer.py` — 11 cases (mapping helpers, detect heuristics, Amazon/Flipkart/CSV parsers with synthetic fixtures). All pass.
- Live E2E verified: Hindi description `पारंपरिक कांचीपुरम सिल्क साड़ी, मंदिर बॉर्डर के साथ।` translated automatically to `Traditional Kanchipuram silk saree with temple border.` ✨

### Web parity
Web agent should mirror the same flow at `/seller/import`. Backend endpoints are platform-agnostic — same payloads work for both. Upload uses `multipart/form-data` with `file` field + optional `source_hint`.

### New collections
- `catalog_import_previews`: `{preview_token, seller_id, source, filename, rows[], expires_at, created_at}` — TTL-style cleanup happens on commit; orphans expire after 2 h naturally (no cron yet).

### New fields on `products`
- `sku`, `brand`, `bullets[]`, `hsn_code`, `ean_upc`, `manufacturer`, `importer`, `ingredients`, `imported_from`, `imported_at`, `ai_enrichment[]`.

### Env
- `EMERGENT_LLM_KEY` added to `backend/.env` (required for AI enrichment; everything else still works without it).


## AI Shopping Assistant (Claude Sonnet 4.5) — June 20, 2026
Chat-with-the-store experience for buyers. Floating bubble on the home tab opens a full chat screen powered by Claude Sonnet 4.5 via the Emergent LLM Key.

### Endpoints
- `POST /api/assistant/chat` — body `{message, session_id?}` → `{session_id, reply, products[]}`. Auth optional (anonymous works, signed-in users get personalized context in future).
- `GET  /api/assistant/sessions/{session_id}` — replay full chat history with hydrated product cards. Privacy: if `user_id` is set on the session, only the owner can view.

### Strategy
Single Claude call per turn, **grounded** by a pre-fetch over `db.products` using keyword + price filters extracted from the message. Top 6 catalog matches are injected into the system prompt under `CATALOG_MATCHES`. Reply + same 6 products returned to the client so the UI can render product cards inline. Sub-2s typical end-to-end latency.

### Storage
- `assistant_sessions`: `{id, user_id?, messages: [{role, content, product_ids[]}], created_at, updated_at}`.

### Mobile UI
- `src/components/AssistantFab.tsx` — floating ✨ "Ask" button placed bottom-right.
- `app/assistant.tsx` — full chat screen with empty-state hero, 4 starter chips, scrollable message list, horizontal product card carousel inside assistant bubbles, multiline input + Send.
- Session ID persisted to AsyncStorage so the chat survives app restarts. "Reset" button in header starts fresh.
- Integrated into `app/(tabs)/home.tsx`.

### Web parity
Same endpoints work on web — agent should mirror the UX (FAB on landing + PDP, full chat at `/assistant`).

### Tests
- `backend/tests/test_assistant.py` — 9 cases (keyword extract, price filter, system prompt rendering, validation, 404, live E2E roundtrip, replay). All pass.

### Env
- Requires `EMERGENT_LLM_KEY` (already added during catalog importer work).


## Legal & Policies — Shipping Policy + Hub (June 20, 2026)
**App Store launch blocker resolved.** Added the missing Shipping Policy and a navigable hub that lists every policy in one place.

### Backend
- New `POLICIES["shipping"]` in `routers/policies.py` — 9 sections covering Origin/Destinations, Transit Times (NZ/AU 7–14d, US/CA 8–16d, GB 7–14d), Fees, Customs Duties & GST, Tracking (Shiprocket X), Lost/Damaged Parcels, Wrong Address, Prohibited Items, Contact.
- Alias map fixed: `shipping`/`shipping-policy` now resolve to the real Shipping Policy (previously bundled into Returns).
- Total live policies: **9** (terms, privacy, return, payment, cancellation, shipping, seller, prohibited, cookies).
- `LAST_UPDATED` bumped to `2026-06-20`.

### Mobile UI
- New `app/legal/index.tsx` — **Legal & Policies hub** with hero card, 9 colour-coded tiles (each with lucide icon, description, last-updated stamp), pull-to-refresh, error retry.
- Account tab → "Policies & help" now leads with a "Legal & Policies" master row → hub; old direct links re-pointed at `/legal/{slug}` so the legacy `/help/*` shims can be removed in a future cleanup pass.

### Tests
- New `backend/tests/test_policies.py` — 5 cases (list returns 9 slugs, every slug resolves, shipping has the App-Store keywords, 404 cleanly, common aliases still work). All pass.

### Web parity
- Web should mirror `/legal` hub and link from the footer.
- Endpoints unchanged: `GET /api/policies`, `GET /api/policies/{slug}`. Both return JSON shaped {slug, title, intro, sections[], markdown}.

### App Store readiness for the legal axis
- ✅ Terms, Privacy, Shipping, Returns, Cancellation, Payment, Cookies, Seller, Prohibited — all present, accessible from one screen.
- ✅ Account deletion already wired (`/auth/me` DELETE + `/account/privacy.tsx`).
- ✅ Effective date + last-updated stamps on every policy.

### Files changed
- `backend/routers/policies.py` (+Shipping Policy, alias fix, LAST_UPDATED bump)
- `backend/tests/test_policies.py` (new)
- `frontend/app/legal/index.tsx` (new hub)
- `frontend/app/(tabs)/account.tsx` (new "Legal & Policies" entry + CreditCard icon import + /legal/* links)


## Help Center + Contact + My Tickets (June 20, 2026)
Buyer-facing help surface built on the **pre-existing** `routers/support.py` ticket system and `/api/site/faq` FAQ catalog. Reuses the seller-side ticket detail screen via Redirect so we maintain one chat-thread UI.

### Endpoints used (none new)
- `GET  /api/site/faq` — FAQ catalog (6 categories, 19 questions).
- `GET  /api/site/faq/search?q=…` — server-side search.
- `POST /api/support/tickets` — create ticket. Categories: orders · shipping · returns · payments · account · kyc · listings · other.
- `GET  /api/support/tickets` — list signed-in user's tickets.
- `GET/POST /api/support/tickets/{id}/...` — detail + reply + rate + close.

### Mobile UI (new)
- `app/help/index.tsx` — Help Center hub: hero search bar, 4 quick-link tiles (Contact, My tickets, Can I import this?, Legal & policies), Popular Questions preview (6 FAQs from `/api/site/faq`), inline search results overlay + "no match → contact" CTA.
- `app/help/contact.tsx` — Buyer Contact Form: 6 category chips (orders/shipping/returns/payments/account/other), Subject, optional Order ID (auto-shown for orders/shipping/returns), 2000-char Message, success state with link to My tickets, sign-in nudge for anonymous users.
- `app/help/my-tickets.tsx` — Buyer ticket list (status badges, priority dots, SLA breach pill, CSAT star, relative time, replies count, FAB to new ticket).
- `app/help/ticket/[id].tsx` — Redirect to the existing `/seller/support/[id]` detail screen (same backend, same UI works for buyer or seller).

### Account tab
- New "Help Center" row above "Legal & Policies" with HelpCircle icon — subtitle "FAQs · Contact support · My tickets".

### Web parity
Web should mirror this hub at `/help`. Endpoints are platform-agnostic.

### Files added/changed
- New: `frontend/app/help/index.tsx`, `frontend/app/help/contact.tsx`, `frontend/app/help/my-tickets.tsx`, `frontend/app/help/ticket/[id].tsx`.
- Updated: `frontend/app/(tabs)/account.tsx` (+ Help Center row, HelpCircle import), `memory/MOBILE_TO_WEB_SYNC.md`.


## Sponsored Placements for Sellers (June 20, 2026)
**Revenue lever live.** Sellers pay per click (CPC) to boost listings into "Sponsored" slots on home/category/search/PDP placements. Post-paid invoicing (monthly bill) — Stripe topup deferred to next sprint.

### Backend
- `routers/sponsored.py` — 8 endpoints:
  - Seller: `POST /api/seller/sponsored/campaigns`, `GET /api/seller/sponsored/campaigns`, `GET /api/seller/sponsored/campaigns/{id}`, `PATCH /api/seller/sponsored/campaigns/{id}`, `DELETE /api/seller/sponsored/campaigns/{id}`.
  - Public: `GET /api/sponsored/slots?placement={home|category|search|pdp}&category=&limit=4` — budget-weighted random slot selection.
  - Tracking: `POST /api/sponsored/track/impression`, `POST /api/sponsored/track/click` (click deducts CPC from `spent_today` + `spent_total`).
- Auto-paces: when `spent_today >= daily_budget_nzd` → status flips to `out_of_budget`. Resets at UTC midnight (lazy reset on next read).
- Refuses duplicate campaigns for same (seller, product) — 409 conflict.

### Storage
- `sponsored_campaigns`: `{id, seller_id, product_id, daily_budget_nzd, cpc_nzd, placements[], status, impressions, clicks, spent_today, spent_total, last_reset_date, created_at, updated_at}`.

### Mobile UI
- `app/seller/sponsored.tsx` — list + create-modal in one screen. Stats row (spent today/month/active campaigns), per-campaign card with progress bar (% of daily budget spent), CTR, impressions, clicks, pause/play + delete buttons.
- Seller dashboard now links to "Sponsored placements" alongside Catalog Import.

### Tests
- `backend/tests/test_sponsored.py` — 4 cases (full lifecycle + duplicate refusal + slot serving + paused exclusion, budget validation, auth, bad placement). All pass.

### Live verified (anonymous slot serving)
- Create $10/day · $0.50 CPC for "Banaras Weaves Tangail Banarasi Silk" → slot serves it on /home → 1 click bills $0.50 → CTR 100% → pause hides it → delete cleanly.

### Web parity
Same endpoints. Web should render a "Sponsored" badge on slot cards (small grey label, not intrusive) and POST tracking beacons on view + click.

### Next iteration (deferred)
- Stripe Checkout topup for prepaid wallet model (replaces post-paid invoicing).
- Monthly invoice generator for current post-paid model.
- A/B-tested copy: should the sponsored badge say "Sponsored" or "Ad"?


## B2B Referral Gamification (June 20, 2026)
Tiers + badges + leaderboard on top of the existing `seller_referrals` data. **No schema migration** — all derived read-only.

### Backend — `routers/b2b_gamification.py`
- `GET /api/b2b/gamification/me` — full state for current seller: tier, next tier + needed count, progress %, all-time rank, badges (locked/unlocked), aggregate stats.
- `GET /api/b2b/gamification/leaderboard?period=all|month|week&limit=20` — top referrers with hydrated display name + city + tier badge.
- `GET /api/b2b/gamification/tiers` — static ladder + badge definitions (for the marketing card).

### Tiers
| Key | Label | Min approved |
|---|---|---|
| none | Newcomer 🌱 | 0 |
| bronze | Bronze 🥉 | 1 |
| silver | Silver 🥈 | 5 |
| gold | Gold 🥇 | 15 |
| platinum | Platinum 💎 | 50 |

### Badges (9)
First Yard ✉️ · First Win 🎉 · Hat-Trick 🎩 · Power Network ⚡ · Five Figures 💰 ($1k) · Six Figures 🏦 ($10k) · Top 10 🏆 · Podium 🥇 · Kingmaker 👑 (referred a Gold-tier seller).

### Mobile UI
- `app/seller/referrals-game.tsx` — Tier hero card with progress bar + share CTA, stat tiles (approved · signed up · earned · rank), 9-badge grid (locked badges shown greyscale), leaderboard with Week/Month/All-Time pills, "You" row highlighted in primary orange.
- Seller dashboard: added "Referral rewards" quick card with Trophy icon.

### Tests
- `backend/tests/test_b2b_gamification.py` — 7 cases covering newcomer/bronze/silver/platinum tier transitions, badge unlock thresholds, leaderboard self-presence, auth gate, full tier ladder. All pass.

### Web parity
Identical endpoints. Web can render the tier card + leaderboard as a sidebar on the seller dashboard. Share link in the hero opens the native share sheet (mobile) — web should fall back to `navigator.share` or a "Copy link" UX.


## Bulk-listings CSV/XLSX template — verification gate fix (June 20, 2026)
**Pre-existing test failure resolved.**

### Root cause
Freshly-registered sellers start at `verification_status="pending_documents"` (correct production behaviour — admin must approve docs first). But the CSV/XLSX *template download* endpoints used the strict `_require_verified_seller` gate, so brand-new sellers couldn't even look at the blank schema while waiting for approval.

### Fix
- Added a softer `_require_seller` dep (just sign-in + `is_seller`) in `routers/bulk_listings.py`.
- `/api/seller/bulk/template.csv` and `/api/seller/bulk/template.xlsx` now use it — template downloads are public to any signed-in seller. **Upload, preview and import** remain gated behind `_require_verified_seller`.
- Test fixture (`tests/test_bulk_listings.py::seller_session`) now fast-forwards the test seller to `approved` via direct `pymongo` (simulates admin approval) so the upload/import path can run end-to-end.

### Coverage
- 9/9 bulk-listings tests pass.
- Full critical-path: **84/84 pass** across bulk_listings, b2b_gamification, sponsored, assistant, policies, catalog_importer, qa, best_sellers, wishlist_collections_move.


## Sponsored Carousel — buyer-side rendering (June 20, 2026)
Mounted the paid-placement slots from `/api/sponsored/slots` on both the home tab and the PDP. Loop closed: sellers can promote → buyers see "Sponsored" cards → clicks bill via existing `/track/click`.

### Component
- `src/components/SponsoredCarousel.tsx` — drop-in horizontal scroller. Props: `placement: "home"|"category"|"search"|"pdp"`, optional `category`, `title`, `limit`. Fetches once on mount, fires impression beacons (debounced 1s settle), fires click beacons on tap before navigating to PDP. Returns `null` when no slots, so the surface stays clean for empty inventory.

### Placements wired
- **Home tab** — `placement="home"` between Flash Sales and category chips.
- **PDP** — `placement="pdp"` with the product's category, titled "More you may like", between Frequently-Bought-Together and Q&A.

### Visual cues
- Dark "Sponsored" badge overlay on the product image (top-left).
- Small "ⓘ Paid placements by sellers" disclosure next to the section heading — App Store / GDPR friendly.

### Live verified
- 2 active campaigns seeded → home carousel renders both cards with proper badges + prices + seller names. Click navigation to PDP works.

### Web parity
Web should mirror the same visual treatment — dark "Sponsored" pill badge + a small clarifying caption near the section title. Endpoint contract unchanged.


## Sponsored Wallet — Stripe Topup (June 20, 2026)
Replaced post-paid invoicing with prepaid wallet model. Sellers fund a wallet via Stripe Checkout; clicks atomically debit the balance; campaigns auto-pause when balance < CPC.

### Backend
- `GET /api/seller/sponsored/wallet` — `{balance_nzd, lifetime_topup_nzd, lifetime_spent_nzd}`.
- `POST /api/seller/sponsored/wallet/topup` — body `{amount_nzd: 5..2000}` → returns Stripe Checkout URL. Uses `mode=payment` (one-time) with `currency=nzd`. Idempotent on customer creation.
- `POST /api/sponsored/webhooks/stripe` — handles `checkout.session.completed` with `metadata.product == "sponsored_topup"`. Credits the seller's wallet **idempotently** (dedup via `stripe_events` + `seller_wallet_events.ref`).
- Click tracker now calls `_debit_wallet()` atomically (`balance_nzd: {$gte: cpc}`); insufficient balance flips the campaign to `out_of_budget` and the click is recorded but unbilled.
- Slot serving filters out campaigns whose seller's wallet can't cover one CPC (cached per request).

### Storage
- `seller_wallets`: `{seller_id, balance_nzd, lifetime_topup_nzd, lifetime_spent_nzd, created_at, updated_at}`.
- `seller_wallet_events`: `{id, seller_id, type: topup|click_charge, source?, ref, amount_nzd, created_at}` — audit log.
- `stripe_events`: existing dedup table reused for webhook replay protection.

### Mobile UI
- New `WalletCard` component inside `app/seller/sponsored.tsx`: balance + lifetime topup/spent metadata + amount input + "Top up via Stripe" button. Opens Stripe Checkout in a new tab on web, native `Linking.openURL` on iOS/Android.
- Hero copy updated to "Pay-per-click. Top up your wallet, set a daily budget, pause anytime."

### Verified E2E (live, no mocks)
- Wallet $0 → topup $50 returns valid Stripe Checkout URL → simulated `checkout.session.completed` webhook → wallet = $50, lifetime_topup = $50.
- Replay same event → deduped (no double credit).
- Click on sponsored slot → wallet $49.50, lifetime_spent $0.50.
- 4/4 sponsored pytest cases still pass with wallet seeding.

### Env required
- `STRIPE_SECRET_KEY` (or `STRIPE_API_KEY`) — Stripe API key (already in env).
- `SPONSORED_WEBHOOK_SECRET` or `STRIPE_WEBHOOK_SECRET` — for HMAC verification of webhook payloads. If unset, signature check is skipped (dev mode).
- `PUBLIC_SITE_URL` — used to build Stripe `success_url` and `cancel_url`. Falls back to `https://shop.allsale.co.nz`.

### Web parity
Same endpoints. Web wallet UI mirrors mobile. Webhook delivery is platform-agnostic — point Stripe Dashboard webhook at `https://<your-domain>/api/sponsored/webhooks/stripe` with the `checkout.session.completed` event subscribed.
