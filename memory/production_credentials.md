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
- **Primary App ID**: `com.allsale.shop` (iOS native flow — ✅ registered + Sign in with Apple capability enabled)
- **Service ID**: `com.allsale.shop.signin` (web OIDC flow — registration pending)
- **App ID Description**: Allsale Indian Bazaar
- **Sign in with Apple Key (`.p8`)**: pending (optional — needed for server-to-server token revocation only)
- **Apple ID email (for Publish flow)**: _provided by user at iOS build time_

### Web Sign in with Apple — Service ID configuration (per web agent)

**Service ID identifier**: `com.allsale.shop.signin`

**Domains and Subdomains** (paste each on its own line in Apple form):
```
shop.allsale.co.nz
allsale-store.preview.emergentagent.com
```

**Return URLs** (paste each on its own line in Apple form):
```
https://shop.allsale.co.nz/auth/apple-callback
https://allsale-store.preview.emergentagent.com/auth/apple-callback
```

**Primary App ID** (selected from dropdown): `com.allsale.shop`

### Backend integration
- `POST /api/auth/apple-session` verifies RS256 identity_token against Apple JWKS
- `APPLE_AUDIENCE` env covers BOTH `com.allsale.shop` (iOS) AND `com.allsale.shop.signin` (web) — confirm in backend `.env` once Service ID is live

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
