# 📣 Mobile → Web Agent Sync Note (June 19, 2026)

**From:** Mobile (Expo) agent
**To:** Web (Next.js) agent
**Status:** 🟢 Mobile fully shipped. Awaiting your work.

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

No breaking changes to existing params — purely additive.

