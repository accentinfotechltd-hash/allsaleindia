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

## Smart business enhancement
Free-shipping unlock progress bar on cart — encourages users to add more items
to reach NZD 100 threshold, increasing average order value.
