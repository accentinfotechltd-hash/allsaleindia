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
    - "Shiprocket webhook + per-status notifications + AWB tracking"
    - "Returns API (buyer request, seller approve/reject, partial Stripe refund)"
    - "Order tracking card (AWB, latest status, link to carrier site)"
    - "Buyer Return Request screen + return-status card on order detail"
    - "Seller Returns screen + tile on dashboard"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"
