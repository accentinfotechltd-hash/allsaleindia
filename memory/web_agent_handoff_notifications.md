# 📣 Notifications API — Handoff to Web Agent

**From:** Mobile (Expo) agent · **Date:** June 19, 2026 · **Status:** 🟢 Backend live and stable. Web is free to start consuming.

This doc is the **single source of truth** for the notifications schema, endpoints, and `type` values currently emitted by the backend. Mobile has been consuming these for months. They are not changing.

---

## 1. Schema

`db.notifications` is a flat per-recipient collection. One row = one bell-icon item for one user.

```ts
type Notification = {
  id: string;                  // e.g. "ntf_3a7b9c2f8e10"
  user_id: string;             // recipient user id  ── or the literal "admin"
  role: "buyer" | "seller" | "admin";
  type: string;                // see §3 for the full enum
  title: string;               // bold first line shown in the bell row
  body: string;                // secondary line, ≤ ~140 chars
  order_id?: string | null;    // present for order/return/shipment notifs
  read: boolean;               // default false; mark via POST /read
  created_at: string;          // ISO8601 UTC
};
```

Mongo also has `_id` (ObjectId) which is **stripped** before serialising — clients never see it.

There is **no** `link` / `cta_url` field — clients build the deep link from `(type, order_id)` on the read side (see §4 for the routing table mobile uses, recommended for web parity).

---

## 2. Endpoints

All endpoints require the standard buyer/seller JWT (`Authorization: Bearer …`) — same auth as everywhere else on the API.

### GET `/api/notifications`
Returns the recipient's latest 100, sorted by `created_at` descending.

**Response:** `Notification[]`

### GET `/api/notifications/unread-count`
Used by the bell badge.

**Response:** `{ "unread": number }`

### POST `/api/notifications/{notification_id}/read`
Marks one notification as read. **404** if the id doesn't belong to the caller.

**Response:** updated `Notification`

### POST `/api/notifications/read-all`
Mark every unread notification as read.

**Response:** `{ "updated": number }`

### GET `/api/admin/notifications`  (admin-only)
Returns the latest 200 rows where `user_id="admin"`. Auth via `x-admin-secret` header.

**Response:** `Notification[]`

---

## 3. `type` values currently emitted

Use these for icon / colour selection in the bell dropdown. The set is **closed** — new values would land here with a memory-doc update first.

### Order lifecycle (buyer or seller)
| `type` | Recipient | Fired by | Notes |
|---|---|---|---|
| `order_placed` | buyer + admin | `POST /checkout/session` success | Cart cleared, Stripe charge captured |
| `new_order` | each seller in cart | (same as above) | One per unique seller |
| `order_cancelled` | buyer + seller | `POST /orders/{id}/cancel` | Within 12h cancel window |
| `order_received_by_buyer` | seller | `POST /orders/{id}/mark-received` | Buyer confirmed delivery |
| `order_<shiprocket-status>` | buyer | Shiprocket webhook | `<status>` ∈ `{paid, shipped, out_for_delivery, delivered, rto_initiated, rto_delivered, cancelled}` — i.e. `order_shipped`, `order_out_for_delivery`, `order_delivered`, `order_rto_initiated`, `order_rto_delivered`. |

### Shipment milestones (buyer)
Fired by the Shiprocket webhook when a parcel hits a major waypoint. Each is one-shot (deduped via `orders.milestones_notified[]`).

| `type` | Trigger |
|---|---|
| `shipment_milestone_arrived_in_destination` | Parcel arrived in buyer's destination country |
| `shipment_milestone_customs_cleared` | Parcel released by customs |

### Reviews
| `type` | Recipient | Fired by |
|---|---|---|
| `new_review` | seller | `POST /reviews` (after order delivered) |
| `review_reply` | review-author | Seller reply on the review |
| `review_reported` | admin | `POST /reviews/{id}/report` |

### Returns
| `type` | Recipient | Trigger |
|---|---|---|
| `return_requested` | seller + admin | Buyer files a return |
| `return_approved` | buyer | Seller approves |
| `return_rejected` | buyer | Seller rejects |
| `return_refunded` | buyer | Stripe partial refund succeeded |

### Proof of delivery
| `type` | Recipient | Trigger |
|---|---|---|
| `proof_of_delivery_uploaded` | buyer | Seller uploaded a parcel photo |

### Support
| `type` | Recipient | Trigger |
|---|---|---|
| `support_ticket` | admin | Buyer/seller opens a ticket |
| `support_reply` | ticket-author | Admin replies |
| `support_resolved` | ticket-author | Admin closes the ticket |

### Financing (B2B)
| `type` | Recipient | Trigger |
|---|---|---|
| `financing_application` | admin | Seller applied for a financing line |

---

## 4. Recommended deep-link routing (mobile parity)

```ts
function notifHref(n: Notification): string {
  if (n.order_id && n.type.startsWith("order_")) return `/orders/${n.order_id}`;
  if (n.order_id && n.type.startsWith("shipment_milestone_")) return `/orders/${n.order_id}/tracking`;
  if (n.order_id && n.type.startsWith("return_")) return `/orders/${n.order_id}/return`;
  if (n.type === "proof_of_delivery_uploaded" && n.order_id) return `/orders/${n.order_id}`;
  if (n.type === "new_review" || n.type === "review_reply" || n.type === "review_reported")
    return "/seller/reviews";  // sellers; buyers: own profile reviews tab
  if (n.type.startsWith("support_")) return "/support";
  if (n.type === "financing_application") return "/admin";
  return "/notifications";
}
```

Mobile uses an icon map keyed off the `type` prefix. Suggested:
- `order_*`, `new_order` → 📦 Package icon
- `shipment_milestone_*` → 🚚 Truck icon
- `new_review`, `review_*` → ⭐ Star icon
- `return_*` → ↩️ Reply icon
- `support_*` → 💬 Speech icon
- `proof_of_delivery_uploaded` → 📸 Camera icon
- `financing_*` → 💳 CreditCard icon

---

## 5. Pagination / Realtime — open questions for later

**No pagination today.** The list endpoint returns the latest 100. If the bell dropdown shows them all on web, that's fine — we'll add cursor pagination if/when a power user has >100 unread.

**No websockets / SSE today.** Mobile polls `unread-count` every 30s when the app is in foreground. Web should do the same (or skip polling and refresh on focus). Push notifications are explicitly deferred (founder hasn't requested them).

---

## 6. Sanity probe (verified June 19, 2026)

```bash
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"buyer@example.com","password":"Buyer2026!"}' | jq -r .access_token)

curl -s $BASE/api/notifications/unread-count -H "Authorization: Bearer $TOKEN"
# {"unread": 3}

curl -s $BASE/api/notifications -H "Authorization: Bearer $TOKEN" | jq '.[0]'
# { "id":"ntf_...", "user_id":"...", "role":"buyer", "type":"order_delivered",
#   "title":"Order #ABC delivered", "body":"...", "order_id":"order_...",
#   "read":false, "created_at":"2026-06-18T22:14:03.412000Z" }
```

---

👋 Ping back via `MOBILE_TO_WEB_SYNC.md` if you find anything ambiguous or if you ship the web bell dropdown — we'd love to keep this doc updated in lockstep.
