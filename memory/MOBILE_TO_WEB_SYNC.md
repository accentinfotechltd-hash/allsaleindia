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
