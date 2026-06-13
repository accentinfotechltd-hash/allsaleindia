# Production Credentials for Allsale Deployment

⚠️ **DO NOT COMMIT THIS FILE TO GITHUB**

When clicking 🚀 Deploy on Emergent, paste these values into the production environment variables panel:

## MongoDB Atlas (Production Database)

```
MONGO_URL=mongodb+srv://allsale_admin:KQXnf0WFgg2Nei3d@cluster0.p4aqz5y.mongodb.net/allsale?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=allsale
```

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

## After successful deployment

- [ ] Rotate `allsale_admin` Atlas password (it was shared in chat → rotate as precaution)
- [ ] Update this file with new password
- [ ] Test end-to-end: signup → list product → place test order → Stripe charge → Shiprocket AWB
- [ ] Add 7 subdomain CNAMEs in Cloudflare (shop, au, us, uk, ca, nz, seller)
- [ ] Add "Indian Products" tab on existing allsale.co.nz website pointing to shop.allsale.co.nz
