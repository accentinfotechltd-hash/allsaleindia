#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build a mobile app like Amazon and Flipkart called "Allsale" for cross-border e-commerce,
  allowing users in New Zealand to buy products from sellers in India. Recently added:
  Payment & Return policies, 12-hour order cancellation with notifications, in-app
  notifications system for buyer/seller/admin.

backend:
  - task: "12-hour order cancellation with Stripe refund + notifications fan-out"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Added POST /api/orders/{order_id}/cancel. Cancels if order is paid and
          cancellable_until (paid_at + 12h) has not elapsed and status not in
          {shipped, out_for_delivery, delivered, cancelled, refunded}. Issues a
          Stripe refund (best-effort), voids pending payouts, marks order
          cancelled, fans out notifications to buyer/sellers/admin. 7/7 backend
          pytest cases pass (test_cancellation.py). Full suite: 109 passed.

  - task: "Notifications API (list, unread-count, mark read/read-all, admin list)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          New /api/notifications GET, /api/notifications/unread-count,
          /api/notifications/{id}/read POST, /api/notifications/read-all POST,
          /api/admin/notifications (header X-Admin-Secret). Fired automatically
          on order_placed (buyer + each seller + admin) and on order_cancelled.

  - task: "Shiprocket mock no longer auto-flips status to 'shipped'"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Label creation now only stores AWB+shipment record. Order remains in
          'paid' status so the 12-hour cancellation window is honoured. Real
          'shipped' transition will be done by Shiprocket webhook later.

frontend:
  - task: "Payment, Return, Cancellation policy pages"
    implemented: true
    working: true
    file: "frontend/app/help/*.tsx + frontend/src/components/PolicyScreen.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          /help/payment-policy, /help/return-policy, /help/cancellation-policy
          rendered via shared PolicyScreen component. Linked from Account tab
          under a new "Policies & help" group.

  - task: "Order detail: 12-hour live countdown + Cancel modal + cancelled-state UI"
    implemented: true
    working: true
    file: "frontend/app/order/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          When status=paid and cancellable_until is in the future, show green
          "Free cancellation available" card with a live HH:MM:SS countdown and
          Cancel button. Tap -> modal with optional reason text input -> calls
          POST /api/orders/{id}/cancel. Once cancelled, banner shows refund
          amount and reason. Policy link added at the bottom.

  - task: "Notifications screen + bell badge in Account tab"
    implemented: true
    working: true
    file: "frontend/app/notifications.tsx + frontend/app/(tabs)/account.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          New /notifications screen lists user notifications (newest first),
          per-type icons, time-ago, mark-all-read. Bell icon in Account header
          shows unread badge (9+). Tapping notification with order_id deep-links
          to order detail and marks it read.

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 8
  run_ui: true

test_plan:
  current_focus:
    - "12-hour order cancellation with Stripe refund + notifications fan-out"
    - "Notifications API (list, unread-count, mark read/read-all, admin list)"
    - "Order detail: 12-hour live countdown + Cancel modal + cancelled-state UI"
    - "Notifications screen + bell badge in Account tab"
    - "Payment, Return, Cancellation policy pages"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Iter-14: Wired the seller listing EDIT UI. Dashboard row now has a
      Pencil icon next to Trash. Tapping it opens /seller/edit-listing/{id}
      which pre-fills name/description/category/price/stock_count/colors/
      sizes/photos from the existing product. Edits support adding new
      photos via Cloudinary (re-uses /api/uploads/image), removing photos,
      adding/removing color & size chips. Save calls
      PATCH /api/seller/products/{id} and pops back to the dashboard.
      Verified visually: existing Saree listing loads with all fields
      populated incl. the 4 colour chips.

  - agent: "main"
    message: |
      Iter-13: 🎉 LIVE Cloudinary uploads. New POST /api/uploads/image
      endpoint signs uploads server-side using CLOUDINARY_CLOUD_NAME +
      _API_KEY + _API_SECRET from /app/backend/.env. Accepts base64 data
      URIs OR remote URLs, returns the secure_url (e.g.
      https://res.cloudinary.com/dfk7mtpk9/image/upload/v.../allsale/products/
      user_xxx/yyy.png). Auto-applied transformations: quality=auto:good,
      fetch_format=auto. Cloud name: dfk7mtpk9. Seller new-listing form
      now uploads each picked photo to /api/uploads/image and stores the
      CDN URL on the product — base64 stops bloating Mongo. Graceful
      fallback to local data URI on upload error so the form is never
      dead-ended. 5 new pytest cases including a real live upload.
      Backend total: 166/167 pass (1 unrelated asyncio flake).

  - agent: "main"
    message: |
      Iter-12: Edit listings + swipeable multi-image gallery. (1) New
      PATCH /api/seller/products/{id} for partial-edit of a listing the
      authenticated seller owns. Supports name/description/category/price/
      images/colors/sizes/stock_count. Empty body = no-op. Replacing images
      re-runs the at-least-one-photo guard and per-image size cap.
      stock_count → auto-flips in_stock. Cross-seller PATCH attempts → 404.
      (2) Product detail screen now renders a horizontal pager (testID
      product-gallery) over `product.images`, with paging-snap, position
      dots, and "n / total" badge — falls back to the single image when
      legacy listings only have `image`. 8 new pytest cases. Backend
      suite: 162/163 pass (1 pre-existing asyncio teardown flake unrelated
      to my changes — passes in isolation).

  - agent: "main"
    message: |
      Iter-11: GSTIN-optional sole-prop sellers + multi-photo upload + test
      fixture hardening. (1) `gstin` is now OPTIONAL in SellerBusiness when
      business_type='sole_proprietorship'; all other entity types still
      require it. Mongo `gstin` unique index converted to a partial index
      so multiple sole-prop sellers without GSTIN don't collide. PAN cross-
      check skipped when GSTIN is None. (2) Multi-photo product listing —
      ListingCreate now accepts `images: List[str]` (up to 10), per-image
      data-URI size guard (~1.5MB binary). Frontend seller new-listing form
      replaced URL textfield with native gallery picker + remove buttons +
      "Cover" badge on the first photo. expo-image-picker installed + iOS
      InfoPlist + Android permissions added to app.json. (3) Test
      fixtures: GSTIN/PAN suffixes now come from `tests/_helpers.make_gstin_pan()`
      using uuid (no more time-based collisions). 5 new tests in
      test_solo_seller_photos.py. Backend suite: 154/155 pass; 1 known
      event-loop flake unrelated to my changes.

  - agent: "main"
    message: |
      Iter-10: Product variants + NZ↔India Size guide. Added `colors`,
      `sizes`, `stock_count` fields to Product/ListingCreate. Stock-aware
      add-to-cart and update-cart with friendly 400s. Stock decrement on
      payment success, restock on cancellation. Seed catalogue gets
      sensible colors/sizes per category. New NZ↔India size chart modal
      opens from product detail for clothing/footwear (Women's, Men's,
      Women's & Men's footwear). Seller new-listing form gets color chips,
      size chips and stock count fields with sanitisation/dedup/caps (10
      colors, 12 sizes). Product detail shows In stock / Only N left /
      Out of stock states; Add-to-cart disabled when OOS. 6 new pytest
      cases — backend total 145/145 passing. Verified visually: product
      detail + size guide render cleanly.

  - agent: "main"
    message: |
      Iter-9: Added Shiprocket webhook (POST /api/shiprocket/webhook) that maps
      Shiprocket statuses to internal order statuses (paid → shipped →
      out_for_delivery → delivered) and fans out buyer notifications. Mock
      shiprocket no longer flips to "shipped" automatically. Added
      GET /api/orders/{id}/shipment for the buyer to fetch AWB+tracking_url.
      Order detail UI now shows a clickable tracking card with AWB +
      latest carrier status + "tap to open live tracking".

      Iter-9b: Full Return Request flow. New /api/returns/{request, me,
      order/{id}, {id}/approve, {id}/reject} endpoints, plus
      /api/seller/returns. Created a 7-day return window with the policy
      defaults the user chose: defective/wrong/damaged = seller pays + full
      refund; changed_my_mind = buyer pays return shipping + 15% restocking
      fee. Non-returnable categories (Food & Groceries, Wellness, Personal
      Care) are rejected upfront. Frontend: new /order/[id]/return.tsx,
      /seller/returns.tsx, return-status card on /order/[id], and a Returns
      tile on the seller dashboard.

      Backend tests: 24 new pytest cases (11 webhook + 13 returns). Full
      suite is now 139/139 passing.

  - agent: "main"
    message: |
      Iter-8: Added payment/return/cancellation policy pages, an in-app
      notifications system, and 12-hour order cancellation with Stripe
      refund + fan-out notifications to buyer/seller/admin.

backend:
  - task: "Shiprocket webhook + per-status notifications + AWB tracking"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          POST /api/shiprocket/webhook accepts current_status and/or
          current_status_id, maps to {paid, shipped, out_for_delivery,
          delivered, rto_initiated, rto_delivered, cancelled}. Idempotent —
          unknown statuses return 200 noop. Optional X-Api-Key header
          verification if SHIPROCKET_WEBHOOK_TOKEN env is set. Buyer notif
          on transitions only. New GET /api/orders/{id}/shipment returns
          AWB + tracking URL for the owning user.

  - task: "Returns API (buyer request, seller approve/reject, partial Stripe refund)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          5 endpoints. Multi-seller orders produce one ReturnRequest per
          seller. 15% restocking fee for change_my_mind; seller pays for
          defective/wrong/damaged. Stripe partial refund issued on
          approval if a payment_intent is attached. Notifications fan out
          to buyer + seller + admin at each transition.

frontend:
  - task: "Order tracking card (AWB, latest status, link to carrier site)"
    implemented: true
    working: true
    file: "frontend/app/order/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          Fetches /orders/{id}/shipment in parallel with the order doc.
          Renders carrier name + AWB code (monospace) + latest carrier
          status + tap-to-open external tracking URL. Falls back to "AWB
          pending" when no shipment exists yet.

  - task: "Buyer Return Request screen + return-status card on order detail"
    implemented: true
    working: true
    file: "frontend/app/order/[id]/return.tsx + frontend/app/order/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          New full-screen /order/[id]/return.tsx with 5-reason picker, item
          checkboxes, optional note, and a contextual seller-paid vs
          buyer-paid summary card. Submits POST /api/returns/request. On
          /order/[id], shows a "Request return" prompt when status=delivered
          and no existing return; once a return exists, shows a status pill
          + refund-amount + decision-note.

  - task: "Seller Returns screen + tile on dashboard"
    implemented: true
    working: true
    file: "frontend/app/seller/returns.tsx + frontend/app/seller/dashboard.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: |
          /seller/returns lists all returns for the seller's items with the
          buyer's reason, optional note, item thumbnails, refund summary
          (incl. 15% restocking when applicable), and Approve / Decline
          buttons. Confirmation alert, then calls /returns/{id}/approve or
          /reject. Returns tile added to seller dashboard.

metadata:
  created_by: "main_agent"
  version: "1.2"
  test_sequence: 9
  run_ui: true

test_plan:
  current_focus:
    - "Seller Low-Stock Alerts: GET /api/seller/analytics/low-stock endpoint"
    - "Seller Dashboard: StockAlertsBanner appears when alerts > 0, hidden otherwise"
    - "Seller Analytics screen: LowStockAlerts section renders rows with urgency chips"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Shipped Seller Stock Alerts (P1 follow-up to analytics dashboard).
      
      Backend (NEW endpoint):
        GET /api/seller/analytics/low-stock?threshold=10&window_days=30
        Returns urgency-ranked alerts per seller listing:
          • out      — stock_count <= 0 OR in_stock=False
          • critical — days_of_cover <= 3 OR (stock <= 3 with sales)
          • low      — days_of_cover <= 7 OR stock <= threshold
        Each row carries daily_velocity (sold/window_days), days_of_cover,
        recommended_restock (rounded to nearest 5, min 5), and price/image
        for client rendering. Summary block includes total_alerts, per-bucket
        counts, and est_lost_revenue_window_nzd (velocity × 3d × price for
        out-of-stock SKUs).
      
      File: /app/backend/routers/seller/analytics.py (lines 451–end).
      Pytest: /app/backend/tests/test_analytics_low_stock.py — 15/15 PASS.
      Regression: test_analytics_insights + test_analytics_timeseries — 25/25 PASS.
      
      Frontend (NEW components):
        - /app/frontend/src/components/LowStockAlerts.tsx
            Section component slotted into the seller analytics screen above
            Insights. Hidden entirely when no alerts. Shows summary stat row
            (out/critical/low counts + est. lost sales pill) followed by
            urgency-ranked product rows with restock recommendations. Tap a
            row → /seller/edit-listing/{product_id}.
        - /app/frontend/src/components/StockAlertsBanner.tsx
            Compact red/yellow banner on the seller dashboard (right under
            SellerStatusBanner). Hidden when no alerts. Renders count + tier
            breakdown + ChevronRight → /seller/analytics.
      
      Wiring:
        - /app/frontend/app/seller/analytics.tsx — imports & renders
          <LowStockAlerts/> above <InsightsSection/>.
        - /app/frontend/app/seller/dashboard.tsx — imports & renders
          <StockAlertsBanner/> right after the SellerStatusBanner block.
      
      Sync doc: MOBILE_TO_WEB_SYNC.md updated with the new endpoint contract
      so the parallel web agent can opt in for parity.
      
      Please verify:
        - Backend: as verified-seller@example.com,
            GET /api/seller/analytics/low-stock should return 200 with the
            schema { window_days, threshold, alerts[], summary{...} }.
            With no products: empty alerts + zero counts.
            threshold=0 should clamp to 1; threshold=9999 → 100.
            window_days=1 → 7; window_days=400 → 90.
            buyer@example.com → 403.
        - Frontend:
            1. Log in as verified-seller@example.com / VerifiedSeller2026!
            2. Visit /seller/dashboard — banner hidden if no alerts (default).
               Seed an out-of-stock product → banner appears (red).
            3. Tap banner → routes to /seller/analytics with LowStockAlerts
               section visible above Insights.
            4. Row tap → /seller/edit-listing/{product_id}.


  - agent: main
    message: |
      Mass i18n translation across all 26 fallback locales — COMPLETE.

      Initial chunked approach (translate_locales_chunked.py with Claude Sonnet 4.5)
      hit 502 BadGateway and budget caps. Pivoted to a robust JSON-based approach
      (extract_en_to_json.js → translate_json.py → render_locale.py) using Claude
      Haiku 4.5. Result: all 26 locales now have full 1,950-key translations.

      Files created:
        /app/scripts/translate_json.py            — main translator (LLM only sees JSON)
        /app/scripts/render_locale.py             — renders flat JSON → TS file
        /app/scripts/extract_en_to_json.js        — extracts en.ts → flat JSON
        /app/scripts/validate_locales.js          — esbuild-based validator
        /app/scripts/fix_locale_braces.py         — (deprecated) brace fixer
        /app/scripts/locales_json_snapshot/*.json — 26 translated JSON snapshots

      Files updated (1,950 keys each, ~2,134 lines):
        es, ar, zh, zh-TW, pt, fr, de, ja, ko, bn, ta, id, ru,
        mi, sm, to, fj, te, mr, ur, gu, kn, ml, pa, or, as

      Validation: all 29 locale files (incl. en, hi, tpi) PASS esbuild parse + eval.
      Visual verification: ES, ZH, FR, DE, MI, TA, UR, RU all render correctly
      with native scripts on the welcome screen.

      Known minor item (NOT in scope, pre-existing): SellOnAllsaleBanner.tsx
      ("Own a business in India? Sell on Allsale") still has hardcoded English

  - agent: main
    message: |
      Smart Ambassador Code UX + SellOnAllsaleBanner i18n — COMPLETE.

      Task 1 — Smart Ambassador Code UX (kept dual codes + smart routing):

      Backend (3 files changed, 1 file added test):
        • /app/backend/services/coupons.py — added `get_b2c_counterpart_for_b2b_code()`
          and `get_b2b_counterpart_for_b2c_code()` helpers.
        • /app/backend/routers/ambassadors.py — added `GET /api/ambassadors/resolve/{code}`
          public endpoint that returns `{type, code, counterpart_code, name,
          primary_platform, program}`. Handles legacy B2B-only India ambassadors
          who store their BIZ code under `code` not `code_b2b`.
        • /app/backend/routers/cart.py — when a buyer pastes a B2B (seller-recruit)
          code at customer checkout, the 400 response is now a structured
          {error_code: "wrong_audience_b2b", ambassador_name, suggested_b2c_code}
          payload so the mobile app can offer a one-tap swap.

      Frontend (3 files changed, 1 file added):
        • /app/frontend/app/a/[code].tsx — NEW unified smart-link landing page.
          Resolves the code, shows ambassador info + audience-appropriate primary
          CTA ("Shop now" for B2C / "Sell on Allsale" for B2B). Surfaces a
          secondary card for BOTH-program ambassadors so wrong-audience visitors
          can still take the right path.
        • /app/frontend/src/components/CouponInput.tsx — added wrong-audience
          warning box with one-tap "Use XXXX instead" CTA when backend signals
          a B2B-at-customer-checkout error.
        • /app/frontend/src/lib/ambassadors.ts — added `resolveCode()` API client
          and `ResolveCodeResponse` type.
        • /app/frontend/src/i18n/locales/*.ts — updated share_msg to use the
          unified `/a/{code}` URL (replaced `?ref=` across all 28 locales).

      Backend tests:
        • test_ambassador_smart_link.py (6 tests): resolve B2C-only, legacy B2B-only,
          BOTH-program via B2B link, 404 on unknown code, B2C-counterpart helper
          edge cases.
        • test_cart_b2b_swap.py (2 tests): structured 400 with suggested_b2c_code,
          B2B-only-without-counterpart graceful fallback.
        All 14 new tests PASS; no regressions in existing smart-link / b2b tests.

      Visual verification:
        • /a/SARAHJENKINS5 (B2C ambassador) → orange "Shop now" CTA ✓
        • /a/RAJESHPATELBIZ (legacy B2B ambassador) → blue "Sell on Allsale" CTA ✓

      Task 2 — i18n SellOnAllsaleBanner:
        • Added `sell_banner.compact_prefix/compact_link/card_title/card_subtitle`
          keys to en.ts.
        • Wrote /app/scripts/translate_specific_keys.py for targeted re-translation.
        • Translated all 4 keys × 26 locales (~$0.10 of Universal Key, ~30 seconds).

  - agent: main
    message: |
      End-to-end ambassador attribution for seller signup — COMPLETE.

      Files changed:
        • /app/frontend/app/a/[code].tsx — switched referrer cache from
          SecureStore (unsupported on web) to AsyncStorage (works on web +
          native). Stores resolved ambassador info on mount.
        • /app/frontend/app/seller/welcome.tsx — forwards `?ref=` to signup.
        • /app/frontend/app/seller/signup.tsx — on mount, reads cached
          ambassador ref from AsyncStorage (with `?ref=` query as priority
          source), resolves it via `/api/ambassadors/resolve/{code}`, and:
            - Pre-fills the referral-code input
            - Shows a green "🎉 You were invited by {name}" banner
            - For B2B codes → uses code directly
            - For B2C codes with a B2B counterpart → auto-swaps to the B2B code
              so the seller attribution credit goes to the right ambassador
              even if the visitor entered via a customer-facing link.

      Backend: NO changes needed. Existing `/seller/register` already
      supports `referral_code` and validates it server-side.

      Visual verification: walked the flow `/a/RAJESHPATELBIZ` →
      "Sell on Allsale" → "Create seller account":
        ✅ AsyncStorage cached the ambassador resolution
        ✅ Banner "🎉 You were invited by Rajesh Patel" rendered
        ✅ Referral input value: RAJESHPATELBIZ (pre-filled, editable)

      All 14 existing smart-link + b2b-swap tests still pass; no regressions.


  - agent: main
    message: |
      Cart auto-apply for `/a/{code}` smart-link visitors — COMPLETE.

      Unified the ambassador-attribution storage. Previously, /a/[code].tsx
      wrote to its own AsyncStorage key (`allsale.ambassador_ref`) while the
      pre-existing `CartContext.maybeAutoApplyRef()` and `/seller/signup`
      flow read from the canonical `allsale_ref_v1` storage. They were two
      ships passing in the night.

      Files changed:
        • /app/frontend/src/lib/ref.ts — added `captureRefFromResolved()`
          helper that writes a pre-resolved ambassador payload directly to
          `allsale_ref_v1` (with the same 90-day TTL as `captureRef`),
          avoiding a redundant `lookupCode` round-trip.
        • /app/frontend/app/a/[code].tsx — now calls
          `captureRefFromResolved()` so cart auto-apply + seller-signup
          pre-fill both read from the canonical store.
        • /app/frontend/app/seller/signup.tsx — switched from a custom
          AsyncStorage key to `getStoredRef()`.
        • /app/frontend/src/contexts/CartContext.tsx — three fixes:
            1. Skip the round-trip when stored ref is B2B-only (would always
               return 400 wrong_audience_b2b).
            2. Don't burn the "already-tried" flag when the cart is still
               empty — retry on the next refresh once items are added.
            3. Trigger `maybeAutoApplyRef` from `add()` so first-add visitors
               (who only had an empty cart on initial mount) still get
               attribution.

      Backend: NO changes — `/api/cart/coupon` already handles both happy
      path (200 + discount) and B2B-at-customer error (structured 400).

      New tests (`test_cart_auto_apply_ref.py`):
        • test_b2c_ambassador_code_applies_at_cart — 200 + $5 discount on
          a $100 cart.
        • test_b2b_program_skip_auto_apply_is_safe — even if frontend
          skip-guard fails, backend gives a clean structured 400.

      All 10 smart-link/swap/auto-apply tests PASS together; no regressions.

      End-to-end flow now:
        1. User clicks `https://allsale.co.nz/a/SARAHJENKINS5`
        2. /a/[code] resolves + persists to `allsale_ref_v1` (90-day TTL)
        3. User adds a product to cart → `add()` calls `maybeAutoApplyRef`
        4. Backend applies Sarah's 5% off automatically → user sees the
           discount in cart without ever typing a code.


  - agent: main
    message: |
      Visit-attribution analytics for /a/{code} smart-links — COMPLETE.

      Backend (1 file changed, 1 test file added):
        • /app/backend/routers/ambassadors.py:
            - POST /api/ambassadors/track-visit/{code}: public beacon-style
              endpoint. Stores a privacy-safe row in `ambassador_link_clicks`
              (no raw IPs — SHA-256 hash truncated to 16 chars for unique
              visitor estimation) and increments rolling lifetime counters
              on the ambassador's profile (link_clicks_total / b2c / b2b).
              Always returns 200 to avoid blocking the visitor's UX; ok=false
              for unknown codes so analytics consumers can drop them.
            - GET /api/ambassadors/me/link-metrics: auth-required KPIs for the
              calling ambassador. Returns clicks_total, clicks_b2c/b2b,
              clicks_7d, clicks_30d, conversions_30d (paid orders attributed),
              seller_signups_30d (referred sellers), and conversion_rate_30d.

      Frontend (3 files changed):
        • /app/frontend/app/a/[code].tsx: fires the track-visit beacon on
          mount (fire-and-forget) immediately after resolve.
        • /app/frontend/src/lib/ambassadors.ts: added `getMyLinkMetrics()`
          client and `LinkMetrics` type.
        • /app/frontend/app/ambassadors/dashboard.tsx: added a "🔗 Link
          Performance" card under the existing KPI tiles, showing
          clicks-7d/30d, conversions/seller-signups, conversion rate, and
          a lifetime-clicks footnote with B2C/B2B breakdown for BOTH-program
          ambassadors.

      New tests (`test_ambassador_link_metrics.py`, 5 tests, all PASS):
        ✓ B2C code increments link_clicks_b2c + link_clicks_total
        ✓ B2B (BIZ) code increments link_clicks_b2b
        ✓ Unknown code returns 200 + ok:false (never raises)
        ✓ Metrics endpoint returns correct 7d/30d buckets + conversion rate
        ✓ Non-ambassador callers get 404

      Regression check: all 15 smart-link / cart-swap / auto-apply / metrics
      tests pass together — no regressions.

      Live verification:
        • Real screenshot session of /a/SARAHJENKINS5 incremented her
          link_clicks_b2c counter from 2 → 3 in real time. 🎉

        • Refactored SellOnAllsaleBanner.tsx to use t() with the new keys.
        • Verified visually: French welcome shows "Vous possédez une entreprise
          en Inde ? Vendre sur Allsale". ✓

      strings — falls back to English in all locales as before.


  - agent: main
    message: |
      Daily click time-series chart on ambassador dashboard — COMPLETE.

      Backend (1 endpoint added):
        • GET /api/ambassadors/me/link-clicks-daily?days=N
            - Aggregates `ambassador_link_clicks` by UTC date via Mongo
              `$dateToString` group, returning one row per day for the
              caller's last N days (clamped to [1, 90]).
            - Always returns a CONTIGUOUS series — fills zero-rows for
              days with no clicks so the dashboard chart renders a flat
              baseline without client-side gap-filling.
            - Shape: `[{date, b2c, b2b, total}]`.

      Frontend (2 files changed, 1 added):
        • /app/frontend/src/components/ClicksTimeSeries.tsx (NEW):
            Lightweight react-native-svg stacked-bar chart. Orange = B2C
            clicks, Blue = B2B clicks. Auto-labels the max-bar value,
            renders day-of-week ticks every ~7 bars, includes an empty
            state ("No clicks yet. Share your link to start seeing the
            trend.") and a color legend.
        • /app/frontend/src/lib/ambassadors.ts: added
          `getMyLinkClicksDaily()` API client + `DailyClicks` type.
        • /app/frontend/app/ambassadors/dashboard.tsx: imports the chart
          and renders it inside the existing "Link Performance" card,
          right below the KPI tiles. Uses `useWindowDimensions` to size
          to the available viewport with a max of 480px.

      New backend tests (2 added to `test_ambassador_link_metrics.py`):
        ✓ test_link_clicks_daily_returns_contiguous_series — verifies
          day-by-day buckets, zero-fill on quiet days, exclusion of
          out-of-window clicks.
        ✓ test_link_clicks_daily_caps_at_90 — verifies the days param is
          clamped to 90 to prevent expensive aggregations.

      All 17 ambassador/smart-link/cart tests still pass; no regressions.

      Live API verification: Sarah Jenkins's 7-day series correctly returns
      6 zero-rows + today's `b2c: 3` (matching the lifetime counter).

      Budget used: ~$15–18 of Universal Key (auto-recharge active).


  - agent: main
    message: |
      Unique-visitor estimation for ambassador click analytics — COMPLETE.

      Backend (1 file changed):
        • /app/backend/routers/ambassadors.py:
            - LinkMetrics model extended with `uniques_7d` and `uniques_30d`.
            - Both computed via `db.ambassador_link_clicks.distinct("ip_hash", …)`
              inside the same 7d/30d windows already used for raw clicks.
            - Filters out `ip_hash: None` rows (some platforms strip
              request.client.host) so the count reflects real visitors.
            - Privacy-safe: the hash is the existing SHA-256(salt + raw IP),
              never the raw IP.

      Frontend (2 files updated):
        • /app/frontend/src/lib/ambassadors.ts: added `uniques_7d` / `uniques_30d`
          to the `LinkMetrics` type.
        • /app/frontend/app/ambassadors/dashboard.tsx:
            - `<Kpi>` component now accepts an optional `sublabel` prop.
            - "Clicks · 7d" / "Clicks · 30d" tiles now show "N unique" sublabel
              underneath the click count.

      Backend test updates:
        • `test_me_link_metrics` strengthened to use 3 distinct `ip_hash` values
          (hashA × 2, hashB × 1, hashC × 1 at -40d) so the assertion verifies
          both clicks (3 in 30d) and uniques (2 in 30d, 1 in 7d). All 17 tests
          in the smart-link/cart/metrics suite still pass.

      Live verification: Sarah Jenkins's profile now returns
        { clicks_30d: 3, uniques_30d: 2 }
      — proving the dedup catches the same visitor across multiple sessions.

  - agent: main
    message: |
      Click-source attribution — COMPLETE.

      Backend (1 file changed, 1 new endpoint, 1 new test file):
        • POST /api/ambassadors/track-visit/{code} now accepts an optional
          JSON body `{utm_source, utm_medium, utm_campaign, referrer}`.
          If absent, the endpoint reads the HTTP `Referer` header.
        • New `_normalize_source()` helper:
            - Explicit utm_source wins.
            - Otherwise extracts the host from the referrer and maps known
              hosts (instagram.com / l.instagram.com / wa.me / t.co / x.com
              / tiktok.com / youtu.be / linkedin.com / google.com / etc.)
              to a normalized name.
            - No referrer → "direct". Unknown host → "other".
        • Stored on each click row: `source`, `utm_source`, `utm_medium`,
          `utm_campaign`, `referrer` (truncated to 300 chars for safety).
        • NEW endpoint `GET /api/ambassadors/me/link-sources?days=N`
          returns the top 12 channels sorted by clicks desc, each with
          `{source, clicks, uniques}` (uniques via the same ip_hash dedup
          used by the unique-visitor KPI).

      Frontend (3 files changed):
        • /app/frontend/app/a/[code].tsx — reads `?utm_source=…` etc. from
          window.location.search + `document.referrer` on web, includes
          them in the track-visit body.
        • /app/frontend/src/lib/ambassadors.ts — added `getMyLinkSources()`
          + `SourceBreakdownRow` type.
        • /app/frontend/app/ambassadors/dashboard.tsx — added a "Top
          channels · last 30 days" section inside the Link Performance
          card, showing up to 5 channels with a horizontal-bar visualization
          and click/unique counts. Includes channel emoji + label helpers
          (📸 Instagram, 💬 WhatsApp, 𝕏 Twitter, …).

      New backend tests (`test_ambassador_link_sources.py`, 4 tests):
        ✓ UTM beats Referer (priority)
        ✓ Referer header normalization (l.instagram.com → instagram,
          wa.me → whatsapp, missing → direct)
        ✓ Unknown host buckets to "other"
        ✓ Sources aggregation returns sorted clicks + correct uniques

      All 21 ambassador/cart/smart-link/sources tests pass together.

      Live verification: Sarah's `/api/ambassadors/me/link-sources` after
      two manual hits returns:
        [{source: "direct", clicks: 3, uniques: 2},
         {source: "instagram", clicks: 1, uniques: 1},
         {source: "whatsapp", clicks: 1, uniques: 1}]


