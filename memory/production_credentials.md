# Production Credentials for Allsale Deployment

⚠️ **DO NOT COMMIT THIS FILE TO GITHUB**

When clicking 🚀 Deploy on Emergent, paste these values into the production environment variables panel:

## MongoDB Atlas (Production Database)

```
MONGO_URL=mongodb+srv://allsale_admin:oqarKz6Nx503oS3l@cluster0.p4aqz5y.mongodb.net/allsale?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=allsale
DISABLE_SEED=1
```

⚠️ **`DISABLE_SEED=1` is critical** — without it, ~30 demo products (sarees, brass idols, etc.)
get inserted into Atlas on every startup. With it set, the production catalog stays clean
and only contains real seller listings.

- Cluster: `Cluster0` (M0 Free tier, AWS Sydney)
- Project: `Allsale App` (separate from existing allsale.events project)
- IP allowlist: `0.0.0.0/0` (Emergent ingress)
- Connection verified: ✅ MongoDB 8.0.26

## Stripe (Live Payments)

Already configured in `backend/.env` — Emergent will pick it up automatically:
- `STRIPE_API_KEY=sk_live_51Th38SGourlKwvCF...` (already in .env)
- Account: `acct_1Th38SGourlKwvCF` (NZ, NZD, charges_enabled=true)
- Payouts: ⚠️ Waiting on Stripe Dashboard bank/identity verification

## Other Live Integrations (already in backend/.env)

- Shiprocket X (LIVE) — `SHIPROCKET_LIVE=True`
- Cloudinary (LIVE) — `CLOUDINARY_*` keys
- Frankfurter FX (LIVE, no key needed)
- Emergent Google OAuth (LIVE, managed)


## Apple Developer Program (iOS Build & Sign in with Apple)

- **Team ID**: `35MPYHX282`
- **Bundle Identifier**: `com.allsale.shop` (matches `frontend/app.json` ios.bundleIdentifier and `backend/services/apple_auth.py` APPLE_AUDIENCE)
- **App ID Description**: Allsale Indian Bazaar
- **App ID Registered**: ✅ COMPLETE (17 Jun 2026)
- **Sign in with Apple capability**: ✅ ENABLED on App ID
- **Apple ID email (for Publish flow)**: _provided by user at iOS build time_
- **App-specific password**: _generated at appleid.apple.com → Sign-In and Security → App-Specific Passwords_

### When clicking Publish for iOS build in Emergent
Emergent will ask for:
1. Apple ID email + app-specific password
2. Team ID: `35MPYHX282`
3. Bundle Identifier: `com.allsale.shop`
Emergent handles distribution certificate, provisioning profile, and Apple Sign-In entitlement automatically.

### NOT needed (yet)
- ❌ Service ID — only for **web** Sign in with Apple
- ❌ `.p8` private key + Key ID — only for **server-to-server** token refresh / account revocation
- ❌ Push notification key — push not enabled

## After successful deployment

- [ ] Rotate `allsale_admin` Atlas password (it was shared in chat → rotate as precaution)
- [ ] Update this file with new password
- [ ] Test end-to-end: signup → list product → place test order → Stripe charge → Shiprocket AWB
- [ ] Add 7 subdomain CNAMEs in Cloudflare (shop, au, us, uk, ca, nz, seller)
- [ ] Add "Indian Products" tab on existing allsale.co.nz website pointing to shop.allsale.co.nz
