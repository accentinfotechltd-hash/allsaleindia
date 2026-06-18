# 🤝 Ambassador / Nano-Influencer Affiliate Programme — Web Agent Handoff

> **Send this entire file to the `allsale-web` agent.**
> Backend is **LIVE** and shares the same FastAPI/MongoDB instance as mobile.
> All endpoints are prefixed with `/api`.

---

## 1. Programme Overview (one-paragraph context)

Allsale runs a **dual-channel ambassador programme** split by country:

| Country | Channel | Code style | Ambassador earns | Customer gets |
|---|---|---|---|---|
| **NZ / AU / US / GB / CA** | **B2C** | `SARAH5` | 5% → 8% → 12% commission on every order placed with their code (tier scales with monthly volume) | **5% off** at checkout |
| **India** | **B2B** | `RAJESHBIZ` | ₹5,000 bounty per new seller (after 5 ships) + 10% of platform fee for 6 months (cap ₹75K) + 1% lifetime tail | Onboarded seller gets 3 months free Pro |
| **India — power users** | **BOTH (B2C + B2B)** | `RAJESH5` **AND** `RAJESHBIZ` | Both code types issued — drive diaspora sales AND seller signups | As above |

Codes are auto-created as **coupons** in the same `coupons` collection that powers the rest of checkout — so no special checkout work needed on the web side; just feed the code into the existing coupon validation flow and the backend handles attribution.

---

## 2. Endpoints — Public (no auth)

### 2.1 `GET /api/ambassadors/program/config`
Returns all programme rules. **Cache this** and use it everywhere you render tier tables, FAQ entries, T&C pages, the landing page commission slider, etc. Single source of truth — never hard-code these numbers on the web side.

**Response shape:**
```json
{
  "eligible_countries": {
    "B2C": ["AU","CA","GB","NZ","US"],
    "B2B": ["IN"]
  },
  "b2c": {
    "tiers": [
      {"key":"starter","label":"Starter","rate_pct":5,"min_orders_30d":0},
      {"key":"gold","label":"Gold","rate_pct":8,"min_orders_30d":10},
      {"key":"platinum","label":"Platinum","rate_pct":12,"min_orders_30d":50}
    ],
    "customer_discount_pct": 5,
    "attribution_days": 90,
    "code_suffix": "5"
  },
  "b2b": {
    "bounty_inr": 5000,
    "bounty_trigger_orders": 5,
    "hot_phase_rate_pct": 10,
    "hot_phase_months": 6,
    "hot_phase_cap_inr": 75000,
    "tail_rate_pct": 1,
    "clawback_days": 90,
    "referred_seller_free_pro_months": 3,
    "code_suffix": "BIZ"
  },
  "content_requirement": {
    "posts_per_month": 4,
    "required_tag": "@allsale.co.nz",
    "required_hashtag": "#allsale",
    "languages_allowed": "any"
  },
  "withdrawal_minimums": {"INR":500,"NZD":20,"AUD":20,"USD":20,"GBP":15,"CAD":20},
  "commission_hold_days": 7,
  "inactivity": {"dormant_after_days":60,"forfeit_after_days":180}
}
```

---

### 2.2 `GET /api/ambassadors/by-code/{code}`
Public lookup. Use this to **render personalised landing pages** like `allsale.co.nz/?ref=SARAH5` (e.g. *"You're shopping with Sarah's code — enjoy 5% off!"*).

Accepts **either** a B2C code or a B2B code (Indian ambassadors have both).

**Response 200:**
```json
{
  "name": "Sarah Jenkins",
  "code": "SARAH5",
  "primary_platform": "instagram",
  "program": "B2C",
  "code_b2b": null
}
```
**404** if the code doesn't exist or the ambassador is suspended.

---

### 2.3 `POST /api/ambassadors/join`
Public signup. No auth required — creates a passwordless stub user if the email is new, or attaches an `ambassador_profile` sub-document to an existing user.

**Request:**
```json
{
  "name": "Sarah Jenkins",
  "email": "sarah@example.com",
  "country": "NZ",
  "social_handle": "@sarahjenkins",
  "primary_platform": "instagram"
}
```
- `country` MUST be one of `NZ`, `AU`, `US`, `GB`, `CA`, `IN` (ISO-3166 alpha-2, uppercase). Anything else → **400**.
- `primary_platform` enum: `instagram | tiktok | youtube | facebook | other`.

**Response 201** — ⚠️ **shape changed (2026-06-18)**: now returns an envelope so the client can route straight into the dashboard without a separate login step.
```json
{
  "access_token": "eyJhbGciOi…",
  "needs_password_setup": true,
  "me": { /* full AmbassadorMe payload — see §3.1 */ }
}
```
- `access_token`: bearer JWT — store and send as `Authorization: Bearer …` for subsequent `/me`, `/me/sales`, etc.
- `needs_password_setup`: `true` for brand-new stub users (passwordless — they joined without ever creating an Allsale account). UI should nudge them to set a password from settings so they can log back in on another device. `false` if they were already an Allsale account holder before joining.
- `me`: identical to `GET /api/ambassadors/me` (see §3.1).

**Errors:**
- `400` — country not eligible
- `409` — email already enrolled

---

## 3. Endpoints — Ambassador-Authenticated (Bearer JWT)

All these require the ambassador to be logged in (standard `Authorization: Bearer <jwt>` header — same auth as the rest of the app).

### 3.1 `GET /api/ambassadors/me`
Dashboard payload.

**Response:**
```json
{
  "id": "user_a1b2c3d4e5f6",
  "code": "SARAH5",
  "code_b2b": null,
  "name": "Sarah Jenkins",
  "email": "sarah@example.com",
  "country": "NZ",
  "payout_currency": "NZD",
  "program": "B2C",
  "status": "active",
  "tier": {"key":"gold","label":"Gold","rate_pct":8,"min_orders_30d":10},
  "next_tier": {"key":"platinum","label":"Platinum","rate_pct":12,"min_orders_30d":50},
  "posts_this_month": 2,
  "posts_required": 4,
  "orders_30d": 14,
  "lifetime_orders": 47,
  "lifetime_commission": 312.45,
  "unpaid_balance": 88.20,
  "pending_commission": 22.00,
  "revenue_driven": 4310.50,
  "referred_sellers_count": 0,
  "created_at": "2026-03-04T11:08:00Z",
  "last_active_at": "2026-06-12T09:21:00Z"
}
```
- `status`: `active | dormant | suspended | forfeited`
- `program`: `B2C | B2B | BOTH`
- `code_b2b` is `null` unless `program ∈ {"B2B","BOTH"}`
- All money values are floats **in the ambassador's payout currency** (already divided from minor units)

### 3.2 `GET /api/ambassadors/me/sales?limit=50&skip=0`
B2C order history (paginated). Returns `[]` for pure B2B ambassadors.
```json
[
  {
    "order_id": "order_abc123def4",
    "order_short_id": "ABC123DEF4",
    "placed_at": "2026-06-10T03:15:22Z",
    "status": "shipped",
    "order_total": 89.50,
    "commission": 7.16,
    "currency": "NZD",
    "locked_at": "2026-06-17T03:15:22Z"
  }
]
```
- `locked_at` = when the 7-day return-window hold expires and commission becomes withdrawable. `null` while still on hold.

### 3.3 `GET /api/ambassadors/me/referred-sellers`
B2B-only — returns `[]` for B2C ambassadors.
```json
[
  {
    "seller_id": "user_xyz",
    "seller_name": "Patel Spices Pvt Ltd",
    "onboarded_at": "2026-04-01T00:00:00Z",
    "orders_to_date": 22,
    "bounty_paid": true,
    "months_since_onboard": 2,
    "months_in_hot_phase_remaining": 4,
    "earnings_to_date_inr": 8420.00
  }
]
```

### 3.4 `POST /api/ambassadors/me/content`
Submit a social post for content-requirement compliance.

**Request:** `{ "post_url": "https://instagram.com/p/abc123/" }`
**Response 201:**
```json
{
  "id": "cont_a1b2c3d4e5f6",
  "submitted_at": "2026-06-12T10:00:00Z",
  "post_url": "https://instagram.com/p/abc123/",
  "platform": "instagram",
  "caption_preview": null,
  "thumbnail_url": null,
  "has_required_tag": false,
  "status": "pending",
  "reject_reason": null
}
```
Platform auto-detected from URL host. Status moves `pending → verified | rejected` after admin review.

### 3.5 `GET /api/ambassadors/me/content?limit=50`
List own submissions (newest first). Same item shape as above.

### 3.6 `POST /api/ambassadors/me/withdraw`
Request a payout. **Phase 1 = queue only** — actual transfer happens via cron / admin action.

**Response:**
```json
{
  "requested_amount": 88.20,
  "currency": "NZD",
  "payout_method": "stripe_connect",
  "status": "queued",
  "reason": null
}
```
- `payout_method`: `razorpay` for `INR`, `stripe_connect` otherwise
- `status`: `queued | blocked`
- `reason` populated when `status === "blocked"` (e.g. *"Below minimum withdrawal of NZD 20."*)

### 3.7 `PATCH /api/ambassadors/me`  ← **NEW**
Edit your own profile. Only the four fields below are editable here — `code`, `code_b2b`, `country`, `email`, and `program` are immutable post-signup (changing them would break payout routing / link attribution; users must email support).

**Request (all fields optional — send only what you want to change):**
```json
{
  "social_handle": "@sarahjenkins",
  "primary_platform": "instagram",
  "payout_currency": "NZD",
  "phone": "+64 21 555 1234",
  "audience_size": 14500
}
```

**Field rules:**
| Field | Type | Constraints |
|---|---|---|
| `social_handle` | `string \| null` | ≤ 120 chars; set to `null` (or `""`) to clear |
| `primary_platform` | enum | `instagram \| tiktok \| youtube \| facebook \| other` |
| `payout_currency` | enum | `NZD \| AUD \| USD \| GBP \| CAD \| INR` |
| `phone` | `string \| null` | 6–20 chars, digits/spaces/`+`/`-`/`( )`; loose E.164-ish |
| `audience_size` | `int` | `0 ≤ n ≤ 1_000_000_000` |

**Response 200** — full `AmbassadorMe` payload (same as `GET /me`).

**Errors:**
- `400` — invalid field value (bad phone format, unsupported currency, etc.)
- `409` — trying to change `payout_currency` while `unpaid_balance > 0` or `pending_commission > 0` (avoids FX accounting headaches — withdraw or wait for hold to clear first)
- `400` — Indian ambassadors are locked to `INR` (Razorpay constraint)
- `403` — not enrolled

**`GET /api/ambassadors/me` now also returns these editable fields** so the profile editor can pre-fill its form:
```json
{
  "...": "...",
  "social_handle": "@sarahjenkins",
  "primary_platform": "instagram",
  "phone": "+64 21 555 1234",
  "audience_size": 14500
}
```

---

## 4. Endpoints — Admin (require role `manager` or `support`)

### 4.1 `GET /api/admin/ambassadors`
Query params (all optional): `program`, `status`, `country`, `has_unpaid_above`, `limit`, `skip`.

Each row:
```json
{
  "id":"user_a1...",
  "name":"Sarah Jenkins",
  "email":"sarah@example.com",
  "code":"SARAH5",
  "code_b2b":null,
  "country":"NZ",
  "payout_currency":"NZD",
  "program":"B2C",
  "status":"active",
  "tier_key":"gold",
  "unpaid_balance":88.20,
  "lifetime_commission":312.45,
  "lifetime_orders":47,
  "referred_sellers_count":0,
  "joined_at":"2026-03-04T11:08:00Z"
}
```

### 4.2 `POST /api/admin/ambassadors/{ambassador_id}/mark-paid` *(role: `manager`)*
Manual payout — zeros `unpaid_balance` and logs to `ambassador_payout_log`.
Response: `{ "ok": true, "paid_amount": 88.20, "currency": "NZD" }`

### 4.3 `POST /api/admin/ambassadors/{ambassador_id}/content/{content_id}/review?action=verify|reject&reason=...`
Approve or reject a content submission.

### 4.4 `POST /api/admin/ambassadors/{ambassador_id}/suspend?reason=...`
Suspend an ambassador (their code immediately fails the public lookup).

---

## 5. Web Frontend — Suggested Routes & Components

| Route | Purpose | Endpoint(s) used |
|---|---|---|
| `/ambassadors` | Public landing page: hero, tier table, FAQ, "Apply now" CTA | `GET /program/config` |
| `/ambassadors/join` | Signup form (name, email, country dropdown, social handle, platform) | `POST /join` |
| `/ambassadors/dashboard` | Logged-in ambassador home — earnings card, tier progress bar, "share my code" with copy/QR/share-sheet | `GET /me` |
| `/ambassadors/dashboard/sales` | Paginated sales table | `GET /me/sales` |
| `/ambassadors/dashboard/referred-sellers` | B2B-only table (hide tab if `program === "B2C"`) | `GET /me/referred-sellers` |
| `/ambassadors/dashboard/content` | List + submit-URL form | `GET` + `POST /me/content` |
| `/ambassadors/dashboard/withdraw` | Big "Request Payout" button with min-balance state | `POST /me/withdraw` |
| `/?ref=SARAH5` | **Sitewide ref capture**: when querystring `ref` is present, look it up, store cookie `allsale_ref` (90-day TTL), show banner *"Shopping with @sarahjenkins · 5% off applied at checkout"* | `GET /by-code/{code}` |
| Checkout | Auto-apply `cookie.allsale_ref` to the coupon field if no manual coupon entered | uses existing coupon endpoint |
| `/admin/ambassadors` | Admin list + filters | `GET /admin/ambassadors` |
| `/admin/ambassadors/[id]` | Detail page with mark-paid, suspend, review-content buttons | admin endpoints in §4 |

---

## 6. Important Implementation Notes for Web Agent

1. **Coupon flow is unchanged** — ambassador codes are just regular coupon docs with `coupon_type: "ambassador_b2c"`. Validate them via the existing `POST /api/coupons/validate` (or whatever the current path is). The backend writes `ambassador_id` onto the order during checkout — you don't need to do anything special.

2. **Referral cookie** — set `allsale_ref` cookie for **90 days** (this matches backend `B2C_ATTRIBUTION_DAYS`). Re-apply automatically on checkout unless the user pastes a different coupon manually.

3. **All amounts in responses are already converted from minor units to floats in the ambassador's payout currency.** No additional division by 100 needed.

4. **`program === "BOTH"`** = show BOTH the B2C share-card (`code`, 5% off message) AND the B2B "refer a seller" share-card (`code_b2b`).

5. **Code suffix convention** — B2C codes end in `5`, B2B in `BIZ`. Both are sanitized to uppercase A–Z/0–9 (no spaces, accents, or special chars).

6. **Pending vs Unpaid** — `pending_commission` = within 7-day hold (not yet withdrawable). `unpaid_balance` = cleared, ready to withdraw. Show them on the dashboard as two distinct numbers with a tooltip explaining the hold.

7. **Tier progress** — render a progress bar from current `tier.min_orders_30d` to `next_tier.min_orders_30d`. If `next_tier === null`, show *"Top tier — you've maxed out!"*.

8. **Content requirement** — display `posts_this_month / posts_required` with a warning state if below by mid-month. Required tag/hashtag come from `/program/config`.

9. **Country gating** — on the signup form, disable countries not in `eligible_countries.B2C ∪ eligible_countries.B2B`. Show India users a special banner explaining they get a dual code (B2C + B2B).

10. **Phase 2 (heads-up, not yet built):** Razorpay payouts for India sellers/ambassadors are blocked pending Indian entity incorporation (~10 days). Stripe Connect weekly cron payouts for non-India ambassadors also pending. UI should already show the "Withdraw" button — backend just queues for now.

---

## 7. Quick-Reference Endpoint Table

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/ambassadors/program/config` | — | Programme rules |
| `GET` | `/api/ambassadors/by-code/{code}` | — | Public code preview |
| `POST` | `/api/ambassadors/join` | — | Signup |
| `GET` | `/api/ambassadors/me` | user | Dashboard |
| `PATCH` | `/api/ambassadors/me` | user | Edit social/payout/phone/audience |
| `GET` | `/api/ambassadors/me/sales` | user | B2C order history |
| `GET` | `/api/ambassadors/me/referred-sellers` | user | B2B referrals |
| `POST` | `/api/ambassadors/me/content` | user | Submit post URL |
| `GET` | `/api/ambassadors/me/content` | user | List own posts |
| `POST` | `/api/ambassadors/me/withdraw` | user | Request payout |
| `GET` | `/api/admin/ambassadors` | admin | List all |
| `POST` | `/api/admin/ambassadors/{id}/mark-paid` | admin | Manual payout |
| `POST` | `/api/admin/ambassadors/{id}/content/{cid}/review` | admin | Review post |
| `POST` | `/api/admin/ambassadors/{id}/suspend` | admin | Suspend |

---

## 8. ⚠️ READ THIS FIRST — Wrong Endpoints You Probably Tried

Looking at backend logs, the web app is already calling 15+ paths that **don't exist**. Here's the corrected mapping — please update your API client:

| ❌ You tried | ✅ Use instead | What it does |
|---|---|---|
| `GET /api/ambassadors/tiers` | `GET /api/ambassadors/program/config` (read `.b2c.tiers`) | Tier table |
| `GET /api/ambassadors/config` | `GET /api/ambassadors/program/config` | Programme rules |
| `GET /api/ambassadors/info` | `GET /api/ambassadors/program/config` | Same |
| `GET /api/ambassadors/rules` | `GET /api/ambassadors/program/config` | Same |
| `GET /api/ambassador/tiers` *(typo, singular)* | `GET /api/ambassadors/program/config` | Same |
| `GET /api/ambassadors/leaderboard` | **Not implemented** — out of scope for Phase 1 | — |
| `GET /api/ambassadors/stats` | `GET /api/ambassadors/me` (returns all stats) | Dashboard data |
| `GET /api/ambassadors/code/validate` | Use the existing **coupon validate** endpoint — ambassador codes are coupons | Code lookup |
| `POST /api/orders/validate-code` | Use existing **coupon validate** endpoint | Same |
| `GET /api/ambassadors/referrals` | `GET /api/ambassadors/me/referred-sellers` (B2B only) | Referred sellers |
| `GET /api/ambassadors/commissions` | `GET /api/ambassadors/me/sales` | Commission history |
| `GET /api/ambassadors/me/orders` | `GET /api/ambassadors/me/sales` | Same |
| `GET /api/ambassadors/payouts` | Use `GET /api/ambassadors/me` (`unpaid_balance` + `pending_commission`) — payout-log endpoint coming in Phase 2 | Balance |
| `GET /api/ambassadors/posts` | `GET /api/ambassadors/me/content` | Own content |
| `GET /api/ambassadors/me/posts` | `GET /api/ambassadors/me/content` | Same |
| `POST /api/ambassadors/posts` | `POST /api/ambassadors/me/content` | Submit post URL |
| `GET /api/ambassadors/social-handle` | Returned inside `GET /api/ambassadors/me` (via stored `social_handle` field — coming next; for now use `/by-code/{code}`) | — |
| `PATCH /api/ambassadors/me` | ✅ **NOW IMPLEMENTED** — see §3.7. Editable fields: `social_handle`, `primary_platform`, `payout_currency`, `phone`, `audience_size` only | Edit profile |
| `POST /api/ambassadors/me/regenerate-code` | ❌ **Won't implement** — codes are intentionally stable so old Instagram/YouTube links keep attributing. If ever needed it'll be a support-only action | Reroll code |

### Naming convention to remember
- The router root is **`/api/ambassadors`** (plural).
- Anything specific to the logged-in ambassador lives under **`/me/...`** (so `/me`, `/me/sales`, `/me/content`, `/me/referred-sellers`, `/me/withdraw`).
- Public lookups: **`/by-code/{code}`** and **`/program/config`**.
- Admin: **`/api/admin/ambassadors/...`** (separate router prefix).

---

**That's the full handoff. Ping me if the web agent needs an OpenAPI/Swagger export or wants TypeScript types generated from these models.**

> **PS — known bug just fixed:** B2C signup was 500-ing on a `NameError`; resolved as of this handoff. If you saw any 500s in `/api/ambassadors/join` earlier, retry now.
