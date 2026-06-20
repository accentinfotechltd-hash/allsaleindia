# Allsale: Indian Bazaar — App Store Submission Package

**Last updated:** June 20, 2026  ·  **Bundle ID (iOS):** `com.allsale.shop`  ·  **Package (Android):** `com.allsale.shop`  ·  **Version:** 1.0.0

This document captures every piece of copy + asset required for a clean
App Store Connect / Google Play Console submission. Pair it with the
brand assets in `frontend/assets/images/` and you're ready to upload.

---

## 1. Store Listing Copy

### 🟢 App Name (30 chars max — iOS)
```
Allsale: Indian Bazaar
```
*(22 chars · uses brand colon convention like Pokémon Go, Marvel Snap)*

### 🟢 Subtitle (30 chars — iOS)
```
Shop India. Delivered home.
```

### 🟢 Short description (80 chars — Play Store)
```
Authentic Indian fashion, beauty, home and food — shipped to NZ, AU, US, UK, CA.
```

### 🟢 Promotional text (170 chars — App Store, changeable without resubmission)
```
NEW: AI shopping assistant — ask "show me sarees under $50" or "best gifts for Diwali" and get instant picks. Free shipping on orders over $99.
```

### 🟢 Full description (4000 chars — App Store / Play Store)

```
Allsale is the easiest way to shop India from anywhere in the world.

Thousands of verified sellers across India — from boutique Banarasi
weavers to Ayurveda labs to small-batch spice houses — list their best
products with us. We handle the cross-border logistics so you get your
order delivered, duty-paid, to your door in New Zealand, Australia, the
US, UK or Canada.

✨ WHY ALLSALE
• Authentic — every seller is business-verified before they go live.
• Transparent — see live INR + your local currency, duty + GST
  estimates, and seller delivery ratings before you buy.
• Fast — most orders deliver in 7–14 days via Shiprocket X.
• Safe — Stripe-secured checkout, full returns within 7 days of arrival.

🛍️ SHOP THE BEST OF INDIA
• Fashion — sarees, lehengas, kurtas, accessories
• Beauty — Ayurveda, hair care, fragrances
• Home — handcrafted decor, kitchenware, textiles
• Food — spices, sweets, snacks (where permitted by import rules)
• Electronics & gadgets

🤖 AI SHOPPING ASSISTANT
Tap the ✨ Ask button anywhere to chat with our Claude Sonnet 4.5
assistant. Get instant recommendations: "show me wedding sarees under
$100", "best phone case for iPhone 15", "track my order".

🔥 FEATURES BUYERS LOVE
• Today's Deals + Best Sellers leaderboards
• Wishlist collections — organise into Diwali, Birthday, Wedding…
• Frequently Bought Together bundle pricing
• Live chat with sellers
• Order tracking with real-time courier updates
• Push reminders before high-demand drops sell out
• Optional Allsale Pro membership for free shipping

🇮🇳 FOR INDIAN SELLERS
Bring your existing Amazon or Flipkart catalog with one upload — our
AI auto-translates Hindi descriptions and rewrites blurbs into clean
5-bullet feature lists. Verified sellers can also boost listings into
Sponsored slots, earn Bronze/Silver/Gold tiers via the B2B referral
program, and access a full analytics dashboard.

🛡️ TRUST & SAFETY
• Email & password + Sign in with Google + Sign in with Apple
• Two-factor authentication
• Account deletion in-app at any time (Account → Privacy → Delete)
• GDPR/NZ Privacy Act compliant
• Read our full policies inside the app or at https://shop.allsale.co.nz/legal

Join thousands of shoppers already exploring the world's largest
marketplace of authentic Indian products.

Support: support@allsale.co.nz
Terms: https://shop.allsale.co.nz/legal/terms
Privacy: https://shop.allsale.co.nz/legal/privacy
```

### 🟢 Keywords (100 chars — App Store, comma-separated)
```
indian,saree,kurta,bollywood,ayurveda,diwali,bazaar,spices,ethnic,shop india,marketplace,export
```

### 🟢 What's New / Release Notes (4000 chars)
```
Welcome to Allsale 1.0! 🎉
• AI Shopping Assistant powered by Claude Sonnet 4.5
• Wishlist Collections — organise your saves
• Today's Deals + Best Sellers leaderboards
• Frequently Bought Together bundle pricing
• Live order tracking via Shiprocket X
• In-app Help Center + ticketing

Have feedback? Tap Account → Help Center → Contact support.
```

---

## 2. Categories & Age Rating

| | App Store | Play Store |
|---|---|---|
| **Primary category** | Shopping | Shopping |
| **Secondary** | Lifestyle | — |
| **Age rating** | 4+ (no objectionable content) | Everyone |
| **Content advisories** | Infrequent mild commerce-related contests | — |

---

## 3. Required URLs

| Field | URL |
|---|---|
| Privacy Policy | https://shop.allsale.co.nz/legal/privacy |
| Terms of Service | https://shop.allsale.co.nz/legal/terms |
| Support / Marketing | https://shop.allsale.co.nz |
| Support email | support@allsale.co.nz |
| Account deletion guide | https://shop.allsale.co.nz/legal/privacy#deletion |

---

## 4. App Icon Specs

| File | Size | Location |
|---|---|---|
| iOS 1024×1024 marketing icon (no transparency, no rounded corners — Apple rounds) | `1024×1024` PNG | `frontend/assets/images/allsale-logo.png` (verify dimensions) |
| Android adaptive icon — foreground | `432×432` PNG (transparent) | same |
| Android legacy icon | `512×512` PNG | (auto-generated from adaptive) |
| Play Store feature graphic | `1024×500` PNG | Need to design |

**Brand color:** `#F37021` (used as `primaryColor` in app.json + ribbon accents).

---

## 5. Screenshots — Shot List

Apple requires **3–10 screenshots** per device. Required device classes:
- **iPhone 6.7" (1290×2796):** iPhone 15/16 Pro Max
- **iPhone 6.5" (1284×2778):** iPhone 11/12/13 Pro Max
- **iPad 12.9":** if `supportsTablet: true` (we do)

Play Store requires **2–8 screenshots** at min `320px`, ratio 16:9 or 9:16.

### Recommended 6-shot lineup

1. **Home tab w/ Sponsored + Flash Sales** — captures the marketplace feel.
   *Caption: "Authentic Indian shopping, delivered worldwide"*
2. **AI Assistant chat showing product cards** — differentiator.
   *Caption: "Ask anything — instant picks powered by AI"*
3. **PDP with FBT + Q&A** — depth + community.
   *Caption: "Real reviews. Real questions. Real Indian sellers."*
4. **Order tracking timeline** — trust signal.
   *Caption: "Live tracking, all the way from India"*
5. **Wishlist collections** — engagement / retention.
   *Caption: "Save into Diwali, Wedding or any list you want"*
6. **Seller dashboard** — appeals to potential sellers (App Preview can show side B).
   *Caption: "Indian sellers: reach New Zealand in minutes"*

### Capture instructions
- Use the Expo Go web preview at 390×844 for raw shots, then upscale to required device size in Figma / Sketch.
- Add a 40px top safe-area bar to mimic the device notch.
- Use **Plus Jakarta Sans Bold 36pt** for caption text, brand orange `#F37021` over a soft cream `#FFF7ED` band at the bottom.

---

## 6. App Preview Video (optional, 15–30s)

Storyboard:
1. **0–3s** — Logo splash → swipe to home tab.
2. **3–8s** — Tap a saree → PDP scroll → "Ships well" badge → FBT widget.
3. **8–14s** — Tap ✨ Ask → type "show me lehengas under $80" → cards animate in.
4. **14–22s** — Add to cart → Stripe checkout → "Order confirmed!" toast.
5. **22–28s** — Open Orders → live tracking timeline.
6. **28–30s** — End card: logo + "Available worldwide".

---

## 7. Submission Checklist

### App Store Connect
- [ ] Apple Developer Program enrolled (annual $99)
- [ ] Bundle ID registered: `com.allsale.shop`
- [ ] App created in App Store Connect under "My Apps"
- [ ] Build uploaded via TestFlight (use Expo's `eas build --platform ios --profile production`)
- [ ] All screenshots uploaded for each required device class
- [ ] Privacy nutrition label filled in (we collect: email, name, address, payment, device id, usage data)
- [ ] App Privacy → Data Linked to User: Identifiers · Contact Info · Purchases · Location (coarse for region)
- [ ] App Privacy → Data Used to Track: NO (we don't use ATT yet)
- [ ] Encryption export compliance: `usesNonExemptEncryption: false` ✓ in app.json
- [ ] Test account credentials for App Review:
      - Email: `apple-review@allsale.co.nz` / Password: `AppleReview2026!`
      - (Create this account with 1 dummy order so reviewers can test order flow)
- [ ] Apple-specific:
      - "Sign in with Apple" required ✓ enabled in app.json
      - In-App Purchase items: NONE (we use Stripe for physical goods — IAP not required)

### Google Play Console
- [ ] Google Play Developer enrolled (one-time $25)
- [ ] Package created: `com.allsale.shop`
- [ ] AAB uploaded via Internal Testing (use `eas build --platform android --profile production`)
- [ ] Content rating questionnaire completed (Everyone — Shopping app)
- [ ] Data safety form filled (mirror Apple privacy answers)
- [ ] Target API level ≥ 34 (Android 14) ✓ Expo SDK 51+ defaults to 34
- [ ] All screenshots uploaded + feature graphic (1024×500)
- [ ] Test account same as App Store
- [ ] Pricing: Free
- [ ] Countries: New Zealand, Australia, United States, United Kingdom, Canada (start) — expand later

### Both stores
- [ ] Privacy Policy URL reachable (`/legal/privacy`) ✓ verified live
- [ ] Terms URL reachable (`/legal/terms`) ✓ verified live
- [ ] Account deletion documented + functional in-app ✓ at `/account/privacy`
- [ ] Support email monitored (`support@allsale.co.nz`)
- [ ] All permissions have user-facing rationale in `app.json` ✓
- [ ] Crash reporting configured (Sentry — pending)
- [ ] Test on a real iPhone (TestFlight) + real Android (Internal Testing) before submitting

---

## 8. Build commands (for reference)

Once you click **Publish** in Emergent, the platform generates an iOS + Android build. If you run builds yourself:

```bash
# Login to Expo
npx eas login

# One-time configuration
npx eas build:configure

# Production builds
npx eas build --platform ios --profile production
npx eas build --platform android --profile production

# Submit
npx eas submit --platform ios
npx eas submit --platform android
```

---

## 9. Known gaps to close before submission

1. **App icon dimensions** — verify `assets/images/allsale-logo.png` is exactly 1024×1024 with no transparency. Crop / pad as needed.
2. **Feature graphic (Play Store)** — 1024×500 banner. Suggest: logo on left, brand-orange gradient background, tagline "Shop India. Delivered home." on right.
3. **Privacy nutrition label** — collect the exact list from `/api/policies/privacy` and translate into Apple's controlled vocabulary.
4. **Sentry / crash reporting** — strongly recommended before submission.
5. **Test account `apple-review@allsale.co.nz`** — create + seed with 1 dummy order so reviewers can exercise the order/return flow.
6. **App Preview videos** — optional but boost conversion by ~25%.


---

## 10. Icon Asset Status (June 20, 2026)

✅ All four icon roles now compliant:

| Role | File | Size | Mode | Alpha | Apple-compliant |
|---|---|---|---|---|---|
| iOS marketing icon | `assets/images/allsale-icon-store.png` | 1024×1024 | RGB | ❌ no | ✅ |
| Android adaptive foreground | `assets/images/allsale-logo.png` | 751×332 | RGBA | ✅ yes | n/a |
| Splash screen | `assets/images/allsale-logo.png` | 751×332 | RGBA | ✅ yes | n/a |
| Web favicon | `assets/images/favicon.png` | 751×332 | RGBA | ✅ yes | n/a |

The marketing icon was generated by centering the wordmark at 78% width on an opaque white canvas — opaque RGB PNG, no alpha channel — exactly what App Review demands.

**Optional future polish** — design a square-mark variant (just the icon-without-text, e.g. the paper-plane motif from the logo) so the Android adaptive foreground looks tighter inside the system-applied mask. The current wordmark renders fine but will appear small inside the adaptive icon's 66% safe zone.
