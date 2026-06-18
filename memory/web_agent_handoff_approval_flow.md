# 🔐 Ambassador T&C Approval Flow — API Spec (for web agent)

> **Send the entire contents of this file to the web team.**
> Shipped: Jun 18 2026 · Backend live at `https://allsale-shop.preview.emergentagent.com`

---

## 1. What changed (TL;DR)

New ambassadors no longer go straight to `active`. The flow is now:

```
POST /join              → status: "pending_approval"  (coupon active: false)
POST /accept-terms      → stamps terms_accepted_at + version
POST /admin/.../approve → status: "active"            (coupon active: true)
POST /admin/.../reject  → status: "rejected" or "permanently_banned"
```

Existing ~29 ambassadors were **auto-grandfathered** with
`terms_accepted_at = migration_timestamp`, `terms_accepted_version = "v1"`.
They keep their current `active` status and don't need to re-accept anything.

Five Resend transactional emails fire automatically (no template IDs to manage —
all inlined). No new credentials needed.

---

## 2. Status enum changes

`AmbassadorMe.status` now includes two new values:

| Value | Meaning | Code public? |
|---|---|---|
| `pending_approval` | applied, awaiting admin approval | ❌ |
| `active` | approved & live | ✅ |
| `dormant` | inactive 60+ days | ✅ |
| `suspended` | admin halted (reversible) | ❌ |
| `forfeited` | inactive 180+ days | ❌ |
| **`rejected`** *(new)* | declined, may re-apply after `can_reapply_at` | ❌ |
| **`permanently_banned`** *(new)* | fraud — cannot re-apply | ❌ |

`GET /api/ambassadors/by-code/{code}` returns **404** for anything except `active`.

---

## 3. New endpoints

### 3.1 `POST /api/ambassadors/accept-terms`  (authenticated)

User accepts the current T&Cs.

**Request:**
```json
{ "version": "v1" }    // optional — defaults to current version
```

**Response 200:**
```json
{
  "ok": true,
  "terms_accepted_at": "2026-06-18T22:40:23.406Z",
  "terms_accepted_version": "v1"
}
```

**Behavior:**
- **Idempotent**: re-calling with the same version returns the original timestamp (ms precision in Mongo — sub-ms truncation is normal).
- Unknown version → **400**.
- User not enrolled → **403**.

**Side effects:**
- Stamps `terms_accepted_at` + `terms_accepted_version` on the user.
- Fires `email#3` (Terms accepted confirmation).

---

### 3.2 `POST /api/admin/ambassadors/{id}/approve`  (admin: `manager`)

**Request:** no body.

**Response 200:**
```json
{ "ok": true, "status": "active", "approved_at": "2026-06-18T22:40:24Z" }
```

**Preconditions (return 4xx if not met):**
- `404` — ambassador not found.
- `409` — current status is not `pending_approval`.
- `412` — `terms_accepted_at` is missing (must call `/accept-terms` first).

**Side effects:**
- Flips `ambassador_profile.status` → `active`.
- Sets `approved_at`, `approved_by`.
- Flips the coupon doc `active: true` → buyers can now redeem the code.
- Fires `email#4` (Welcome aboard).

---

### 3.3 `POST /api/admin/ambassadors/{id}/reject`  (admin: `manager`)

**Request:**
```json
{
  "reason": "Insufficient audience for first tier",   // min 4 chars, max 500
  "permanent": false                                   // optional, default false
}
```

**Response 200:**
```json
{
  "ok": true,
  "status": "rejected",                                // or "permanently_banned"
  "rejected_at": "2026-06-18T22:40:25Z",
  "can_reapply_at": "2026-07-18T22:40:25Z"             // null if permanent
}
```

**Preconditions:**
- `404` — ambassador not found.
- `409` — current status is neither `pending_approval` nor `active`.

**Side effects:**
- Flips `ambassador_profile.status` → `rejected` (or `permanently_banned`).
- Sets `rejected_at`, `rejected_reason`, `rejected_by`.
- Sets `can_reapply_at = now + 30 days` (omitted when `permanent: true`).
- Deactivates the coupon (no further redemptions).
- Fires `email#5` (Application declined, with reason + optional re-apply date).

---

## 4. Modified endpoints

### 4.1 `POST /api/ambassadors/join`  — re-application + status change

**New behavior for existing emails:**

| Existing status | Result |
|---|---|
| `active`, `dormant`, `pending_approval`, `suspended`, `forfeited` | **409** "already enrolled" |
| `rejected` AND `can_reapply_at <= now` | ✅ resets to `pending_approval`, keeps old code, fires emails #1 + #2 |
| `rejected` AND `can_reapply_at > now` | **409** with "you can re-apply after {date}" message |
| `permanently_banned` | **403** "not eligible" |
| (no profile) | ✅ creates pending application |

**Response 201** envelope shape is **unchanged** from before:
```json
{
  "access_token": "...",
  "needs_password_setup": true,
  "me": { /* AmbassadorMe — but status is now "pending_approval" */ }
}
```

**Side effects on a fresh application:**
- Creates user (if needed) + `ambassador_profile` with `status: "pending_approval"`.
- Generates code(s) and creates the coupon doc with **`active: false`**.
- Fires `email#1` (Application received to applicant) + `email#2` (New application to `OWNER_ADMIN_EMAIL`).

### 4.2 `GET /api/ambassadors/me` — new fields exposed

```jsonc
{
  // ...existing fields unchanged...
  "status": "pending_approval",       // <-- new enum value possible
  "terms_accepted_at": null,          // <-- NEW (null until /accept-terms called)
  "terms_accepted_version": null,     // <-- NEW
  "can_reapply_at": null,             // <-- NEW (set on rejection)
  "rejected_reason": null             // <-- NEW (set on rejection)
}
```

### 4.3 `GET /api/ambassadors/by-code/{code}` — stricter visibility

Now returns **404 for any status other than `active`**. Previously it was looser
(everything except `suspended` resolved).

---

## 5. Emails fired by Resend

| # | Trigger | Recipient | Subject |
|---|---|---|---|
| 1 | `POST /join` (fresh OR re-apply) | applicant | "✨ Your Allsale Ambassador application is in review" |
| 2 | `POST /join` (fresh OR re-apply) | `OWNER_ADMIN_EMAIL` | "🆕 New ambassador application: {name}" |
| 3 | `POST /accept-terms` | applicant | "✅ Allsale Ambassador Terms accepted" |
| 4 | `POST /admin/.../approve` | applicant | "🎉 You're an Allsale Ambassador — your code is LIVE" |
| 5 | `POST /admin/.../reject` | applicant | "Your Allsale Ambassador application" (rejection w/ reason) |

All templates are inline HTML in `services/ambassador_email.py` — **no template IDs
to wire on the web side.** All sends are best-effort (failures logged, never block
the API response). Resend's free tier is rate-limited to 2 req/sec; bursts of
admin notifications get queued/dropped in test, that's expected.

---

## 6. Wiring checklist for the web team

- [ ] **Web dashboard**: render an interstitial card on `/ambassadors/dashboard`
      when `status === "pending_approval"` (e.g. "Your application is in review · check status below"). Suppress the share/withdraw widgets until status flips to `active`.
- [ ] **Terms acceptance modal**: prompt the user to accept T&Cs if
      `terms_accepted_at === null`. Submit via `POST /accept-terms` with
      `version: "v1"`.
- [ ] **Rejected state**: if `status === "rejected"`, show the `rejected_reason`
      and the `can_reapply_at` date — and let them call `/join` again once
      `Date.now() >= can_reapply_at`.
- [ ] **Permanently banned**: show "Account ineligible" message with support email.
- [ ] **Admin views**: add approve/reject buttons on `/admin/ambassadors/[id]`.
      Block the approve button if `terms_accepted_at === null` (the backend
      returns 412 anyway, but it's better UX to gate it client-side too).
- [ ] **Playwright `12-ambassador-approval-flow`**: should now go green.

---

## 7. What I did NOT ship (you'll need to confirm scope if you want these)

- `POST /admin/ambassadors/{id}/unreject` — reversing a rejection within the
  cool-down. Currently the only way to "undo" a rejection is to re-issue an
  approval after re-application.
- A bulk `POST /admin/ambassadors/approve-all` for the pending queue.
- A "reminder to accept terms after 3 days" cron — possible follow-up.
- Versioning past `v1` (terms version is a single constant in code: bump
  `TERMS_CURRENT_VERSION` in `routers/ambassadors.py` when content changes).

Flag any of these if you need them.

---

## 8. Test coverage

- New file: `/app/backend/tests/test_ambassador_approval_flow.py` — 5 cases.
- Legacy tests (`test_ambassador_phase2.py`) now use a `_auto_approve()` helper
  in their fixture so they continue to assert post-approval state.
- **All 36 ambassador tests pass in 11.2s.**

---

**Mobile side**: the mobile apps don't yet render the pending/terms UI — I'll
add that as a follow-up once I see your dashboard implementation lands and we
can match the UX.

---

## 9. Bonus endpoint shipped — `resend-activation` (per your engagement-loop suggestion)

### `POST /api/ambassadors/resend-activation`  (authenticated)

User-triggered re-send of the most relevant programme email. Use this for the
"I lost the email" button on `/ambassadors/pending`.

**Request:** no body (auth header only).

**Response 200:**
```json
{
  "ok": true,
  "kind": "application_received",    // or "welcome"
  "next_allowed_at": "2026-06-18T23:54:23Z"
}
```

**Smart template selection** (based on current `status`):
| Status | Action |
|---|---|
| `pending_approval` | Re-fires **email #1** (Application received) |
| `active` / `dormant` | Re-fires **email #4** (Welcome / code is live) |
| `rejected` / `suspended` / `forfeited` | **400** — nothing meaningful to resend |
| `permanently_banned` | **403** |

**Rate limit:** **1 send per ambassador per hour** (`last_resend_at` field).
Second call within the cool-down returns:

```
HTTP 429
Retry-After: 3421
{ "detail": "Please wait 57 more minute(s) before requesting another email." }
```

The `Retry-After` header is in seconds — display a countdown on the button.

**Side effect:** Stamps `ambassador_profile.last_resend_at = now()`. Note:
this stamp updates even if the underlying Resend send itself fails (rate-limit
hit upstream, etc.) — this prevents callers from hammering us trying to retry
our internal email failures.
