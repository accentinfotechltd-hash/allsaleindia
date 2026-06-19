# Web Agent Handoff — Order Tracking Enhancements (June 2026)

This document describes the **new backend endpoints + schema changes** added to the buyer-side Order experience. Please mirror the equivalent UI on the parallel Next.js web app.

> **Cross-link**: Reviews & Ratings parity is documented separately. This handoff is *order tracking only* + a tiny review-report endpoint.

---

## 1. New Backend Endpoints

### `GET /api/orders/{order_id}/tracking`
Detailed shipment timeline for a buyer's own order. **Auth required** (Bearer JWT).

**Response (`OrderTracking`):**
```json
{
  "order_id": "order_abc123",
  "status": "shipped",
  "progress_pct": 50,
  "stages": [
    { "key": "paid",            "label": "Order confirmed",  "done": true,  "at": "2026-06-15T01:00:00Z" },
    { "key": "shipped",         "label": "Shipped from India","done": true,  "at": "2026-06-16T08:00:00Z" },
    { "key": "out_for_delivery","label": "Out for delivery", "done": false, "at": null },
    { "key": "delivered",       "label": "Delivered",         "done": false, "at": null }
  ],
  "events": [
    { "at": "2026-06-17T03:14:00Z", "status": "Arrived",   "location": "Auckland, NZ", "remark": "At facility" },
    { "at": "2026-06-16T08:00:00Z", "status": "Pickup",    "location": "Mumbai, IN",   "remark": "Picked up" }
  ],
  "awb_code": "AWB12345",
  "carrier": "Shiprocket X",
  "tracking_url": "https://shiprocket.co/tracking/AWB12345",
  "estimated_delivery": "3-5 business days",
  "last_tracking_status": "Arrived",
  "last_tracking_location": "Auckland, NZ",
  "last_tracking_update": "2026-06-17T03:14:00Z",
  "delivered_at": null,
  "buyer_confirmed_at": null,
  "eta_summary": {
    "status": "on_time",
    "headline": "Arriving in 5 days",
    "sublabel": "by 24 Jun",
    "arrives_in_days": 5,
    "latest_estimate_date": "2026-06-24",
    "original_window": "17 Jun – 24 Jun 2026",
    "refreshed_from": "in_transit"
  }
}
```

**Errors:**
- `404` if the order doesn't exist or belongs to another buyer.

**Notes for UI:**
- `events` is **newest first**, capped at 60.
- `progress_pct` is `0` for `cancelled`/`refunded` orders.
- Render `stages` as a vertical timeline; mark each one done/pending visually.
- **`eta_summary`** (Phase 1.5 #2) is the single source of truth for the "Smart ETA Ribbon". Drive ribbon colour from `eta_summary.status` ∈ `on_time | arriving_soon | out_for_delivery | delivered | delayed | pending | cancelled`. Use `headline` + `sublabel` verbatim; show `original_window` as a secondary line when `status == "delayed"`.

---

### `POST /api/orders/{order_id}/mark-received`
Buyer confirms physical receipt. Auth required. Body: none.

**Behaviour:**
- Allowed only when `status ∈ {out_for_delivery, delivered}`.
- If `status == out_for_delivery`, this **promotes** the order to `delivered` and stamps `delivered_at = now()` if missing. The return window still respects existing logic.
- Sets `buyer_confirmed_at = now()`.
- Sends `order_received_by_buyer` notification to each unique seller in the order.
- Returns the updated `Order`.

**Errors:**
- `400` — order is `cancelled`/`refunded` or status is pre-dispatch.
- `409` — already confirmed (idempotency guard).
- `404` — not your order.

---

### `POST /api/orders/{order_id}/reorder`
Re-adds every item from a past order to the buyer's cart (best-effort). Auth required.

**Response (`ReorderResult`):**
```json
{
  "cart_item_count": 5,
  "added": ["prod_xxx", "prod_yyy"],
  "skipped": [
    { "product_id": "prod_zzz", "reason": "out_of_stock" },
    { "product_id": "prod_old", "reason": "no_longer_available" }
  ]
}
```

**Behaviour:**
- Items already in the cart get their quantity **incremented**.
- Quantities are capped by available `stock_count` when known.
- Hidden / out-of-stock / deleted products are reported in `skipped` with a reason; no error is raised so the buyer still gets a partially-restored cart.

**UI cue:** Show a toast like "Added X items to cart" and surface the skipped ones if any.

---

### `POST /api/reviews/{review_id}/report`
Buyer flags an abusive / spam / fake review for admin moderation. Auth required.

**Body:**
```json
{ "reason": "spam" }   // 2..300 chars, free text or one of: inappropriate, spam, fake, off_topic
```

**Behaviour:**
- Idempotent per `(user, review)` — duplicate reports return `204` without duplicating the report row.
- Sets `reviews.reported = true`, `moderation_status = "reported"`, and appends `{user_id, user_name, reason, at}` to `reviews.reports`.
- Sends an admin notification (`review_reported`).
- Reviewing your own review returns `400`.
- Reported reviews surface in `GET /api/admin/reviews?status=reported`.

**Response:** `204 No Content`.

---

### `POST /api/seller/orders/{order_id}/proof-of-delivery` (Phase 1.5)
Seller uploads a photo proving the parcel reached the buyer. Auth + `is_seller=true` required.

**Body:**
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQ...",  // OR an HTTPS URL
  "note": "Left at the front porch under the mat"  // optional, ≤ 300 chars
}
```

**Behaviour:**
- Allowed only when `status ∈ {out_for_delivery, delivered}` and the seller owns at least one item on the order.
- `409 Conflict` if a carrier already provided `pod_url` (carrier wins).
- If status was `out_for_delivery`, auto-promotes to `delivered` and stamps `delivered_at`.
- Stores `orders.proof_of_delivery = {image, note, uploaded_by: "seller", uploaded_at}`.
- Triggers in-app notification (`proof_of_delivery_uploaded`) + Resend email to the buyer.

**Response (`ProofOfDelivery`):**
```json
{
  "image": "data:image/jpeg;base64,...",
  "note": "Left at the front porch under the mat",
  "uploaded_by": "seller",
  "uploaded_at": "2026-06-19T01:11:42Z"
}
```

**Carrier-side capture:** the Shiprocket webhook now also picks up `pod_url` / `proof_image_url` / `delivery_image_url` from the carrier payload and stores it as `proof_of_delivery.uploaded_by = "carrier"`. No code change needed on the web app for this — just render the same `proof_of_delivery` field from `GET /orders/{id}/tracking`.

---

## 2. Schema Additions

### `orders` (existing collection, additive fields)
| field | type | populated by |
|---|---|---|
| `shipped_at` | datetime | Shiprocket webhook |
| `out_for_delivery_at` | datetime | Shiprocket webhook |
| `delivered_at` | datetime | Shiprocket webhook *or* `mark-received` if buyer-promoted *or* seller proof-of-delivery upload |
| `buyer_confirmed_at` | datetime | `POST /orders/{id}/mark-received` |
| `last_tracking_location` | string | Shiprocket webhook (latest scan location) |
| `tracking_status` | string | Shiprocket webhook (raw "current_status") |
| `last_tracking_update` | datetime | Shiprocket webhook |
| `awb_code` | string | denormalised for snappy UI lookup |
| `proof_of_delivery` | object `{image, note, uploaded_by: "carrier"\|"seller", uploaded_at}` | Shiprocket webhook (`pod_url`) OR `POST /seller/orders/{id}/proof-of-delivery` |
| `milestones_notified` | array<string> | Shiprocket webhook; tracks one-time in-transit milestones (`arrived_in_destination`, `customs_cleared`). |

### `shipments` (existing, no schema change)
- The `events` array (Mongo `$push` in webhook) is now exposed via `GET /orders/{id}/tracking`.

### `reviews` (additive fields)
| field | type | populated by |
|---|---|---|
| `reports` | array<{user_id, user_name, reason, at}> | `POST /reviews/{id}/report` |
| `reported` | bool | same |
| `moderation_status` | "approved" \| "reported" \| "hidden" | same / admin actions |
| `reported_at` | datetime | first report |

---

## 3. Suggested Web UI Surface

1. **Order detail page (`/account/orders/[id]`)**
   - Replace static 4-stage timeline with the new `GET /tracking` payload.
   - Render the progress bar (`progress_pct`) and per-stage timestamps from `stages[]`.
   - Add a collapsible "Scan events" list pulling from `events[]` (default 5 visible, "Show all" toggle).
   - Show the carrier card with `awb_code` + clickable `tracking_url`.

2. **Buyer post-delivery actions** (visible when `status ∈ {out_for_delivery, delivered}`):
   - **"Confirm I received it"** → `POST /mark-received` (hide once `buyer_confirmed_at` is set; show a small confirmation banner instead).
   - **"Reorder"** → `POST /reorder` then redirect to `/cart`.
   - **"Message seller about this order"** → existing chat endpoint, pass `order_id` in `POST /chat/conversations`.

3. **Product detail page (PDP) — Reviews**:
   - Add a small `Flag` icon next to each review's "Helpful" pill that calls `POST /reviews/{id}/report` with a prompt.
   - Hide the icon for the review's own author.
   - Disable the icon after first successful report (local optimistic state).

---

## 4. Acceptance Tests (already passing on backend)
`tests/test_order_tracking.py`
- `test_tracking_paid_order_returns_first_stage`
- `test_tracking_with_events_returns_newest_first`
- `test_tracking_delivered_progress_100`
- `test_tracking_cancelled_progress_zero`
- `test_tracking_other_buyer_404`
- `test_mark_received_happy_path`
- `test_mark_received_promotes_out_for_delivery_to_delivered`
- `test_mark_received_idempotent`
- `test_mark_received_rejects_pre_dispatch`
- `test_mark_received_rejects_cancelled`
- `test_reorder_adds_items_to_cart`
- `test_reorder_skips_out_of_stock`
- `test_report_review_marks_reported_and_is_idempotent`
- `test_report_own_review_forbidden`
- `test_report_review_not_found`

If the web app needs any additional endpoints (e.g. a "delivery proof photo" or a "courier ETA" feed), open a contract change request in `/app/memory/`.
