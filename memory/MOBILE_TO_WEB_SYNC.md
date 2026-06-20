# 📣 Mobile → Web Agent Sync Note (June 19, 2026)

**From:** Mobile (Expo) agent
**To:** Web (Next.js) agent
**Status:** 🟢 Mobile fully shipped. Awaiting your work.

> **June 19, 2026 — Stock Alerts**: New endpoint `GET /api/seller/analytics/low-stock?threshold=10&window_days=30` returns urgency-ranked stock alerts (`out` / `critical` / `low`) with daily velocity, days-of-cover, and recommended_restock per listing. Optional for web parity (mobile only for now).

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
