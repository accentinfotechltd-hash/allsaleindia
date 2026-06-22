import { api } from "@/src/lib/api";

// ---------------------------------------------------------------------------
// Types — mirror /app/backend/routers/ambassadors.py response shapes.
// ---------------------------------------------------------------------------
export type AmbassadorTier = {
  key: string;
  label: string;
  rate_pct: number;
  min_orders_30d: number;
};

export type AmbassadorProgram = "B2C" | "B2B" | "BOTH";
export type AmbassadorStatus =
  | "pending_approval"
  | "active"
  | "dormant"
  | "suspended"
  | "forfeited"
  | "rejected"
  | "permanently_banned";

export type AmbassadorMe = {
  id: string;
  code: string;
  code_b2b: string | null;
  name: string;
  email: string;
  country: string;
  payout_currency: string;
  program: AmbassadorProgram;
  status: AmbassadorStatus;
  tier: AmbassadorTier;
  next_tier: AmbassadorTier | null;
  posts_this_month: number;
  posts_required: number;
  orders_30d: number;
  lifetime_orders: number;
  lifetime_commission: number;
  unpaid_balance: number;
  pending_commission: number;
  revenue_driven: number;
  referred_sellers_count: number;
  social_handle: string | null;
  primary_platform: string | null;
  phone: string | null;
  audience_size: number | null;
  // Approval-flow fields (Phase 4)
  terms_accepted_at: string | null;
  terms_accepted_version: string | null;
  can_reapply_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  last_active_at: string | null;
};

export type ProgramConfig = {
  eligible_countries: { B2C: string[]; B2B: string[] };
  b2c: {
    tiers: AmbassadorTier[];
    customer_discount_pct: number;
    attribution_days: number;
    code_suffix: string;
  };
  b2b: {
    bounty_inr: number;
    bounty_trigger_orders: number;
    hot_phase_rate_pct: number;
    hot_phase_months: number;
    hot_phase_cap_inr: number;
    tail_rate_pct: number;
    clawback_days: number;
    referred_seller_free_pro_months: number;
    code_suffix: string;
  };
  content_requirement: {
    posts_per_month: number;
    required_tag: string;
    required_hashtag: string;
    languages_allowed: string;
  };
  withdrawal_minimums: Record<string, number>;
  commission_hold_days: number;
  inactivity: { dormant_after_days: number; forfeit_after_days: number };
};

export type SaleRow = {
  order_id: string;
  order_short_id: string;
  placed_at: string;
  status: string;
  order_total: number;
  commission: number;
  currency: string;
  locked_at: string | null;
};

export type ReferredSellerRow = {
  seller_id: string;
  seller_name: string;
  onboarded_at: string;
  orders_to_date: number;
  bounty_paid: boolean;
  months_since_onboard: number;
  months_in_hot_phase_remaining: number;
  earnings_to_date_inr: number;
};

export type ContentSubmission = {
  id: string;
  submitted_at: string;
  post_url: string;
  platform: string;
  caption_preview: string | null;
  thumbnail_url: string | null;
  has_required_tag: boolean;
  status: "pending" | "verified" | "rejected";
  reject_reason: string | null;
};

export type WithdrawalResponse = {
  requested_amount: number;
  currency: string;
  payout_method: "razorpay" | "stripe_connect";
  status: "queued" | "blocked";
  reason: string | null;
};

export type JoinResponse = {
  access_token: string;
  needs_password_setup: boolean;
  me: AmbassadorMe;
};

export type JoinPayload = {
  name: string;
  email: string;
  country: string;
  social_handle?: string;
  primary_platform?: "instagram" | "tiktok" | "youtube" | "facebook" | "other";
};

export type ProfileUpdate = {
  social_handle?: string | null;
  primary_platform?: "instagram" | "tiktok" | "youtube" | "facebook" | "other";
  payout_currency?: "NZD" | "AUD" | "USD" | "GBP" | "CAD" | "INR";
  phone?: string | null;
  audience_size?: number;
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
export const getProgramConfig = () =>
  api<ProgramConfig>("/ambassadors/program/config", { auth: false });

export const lookupCode = (code: string) =>
  api<{ name: string; code: string; primary_platform: string | null; program: AmbassadorProgram; code_b2b: string | null }>(
    `/ambassadors/by-code/${encodeURIComponent(code)}`,
    { auth: false }
  );

export type ResolveCodeResponse = {
  type: "b2c" | "b2b";
  code: string;
  counterpart_code: string | null;
  name: string;
  primary_platform: string | null;
  program: AmbassadorProgram;
};

export const resolveCode = (code: string) =>
  api<ResolveCodeResponse>(
    `/ambassadors/resolve/${encodeURIComponent(code)}`,
    { auth: false }
  );

export const joinProgram = (body: JoinPayload) =>
  api<JoinResponse>("/ambassadors/join", { method: "POST", body, auth: false });

export const getMe = () => api<AmbassadorMe>("/ambassadors/me");

export const updateMe = (patch: ProfileUpdate) =>
  api<AmbassadorMe>("/ambassadors/me", { method: "PATCH", body: patch });

export const listSales = (limit = 50, skip = 0) =>
  api<SaleRow[]>(`/ambassadors/me/sales?limit=${limit}&skip=${skip}`);

export const listReferredSellers = () =>
  api<ReferredSellerRow[]>("/ambassadors/me/referred-sellers");

export const submitContent = (post_url: string) =>
  api<ContentSubmission>("/ambassadors/me/content", {
    method: "POST",
    body: { post_url },
  });

export const listContent = () =>
  api<ContentSubmission[]>("/ambassadors/me/content?limit=50");

export const requestWithdraw = () =>
  api<WithdrawalResponse>("/ambassadors/me/withdraw", { method: "POST" });

// ---- Approval-flow endpoints (Phase 4) ----
export const acceptTerms = (version = "v1") =>
  api<{ ok: boolean; terms_accepted_at: string; terms_accepted_version: string }>(
    "/ambassadors/accept-terms",
    { method: "POST", body: { version } }
  );

export const resendActivation = () =>
  api<{ ok: boolean; kind: "application_received" | "welcome"; next_allowed_at: string }>(
    "/ambassadors/resend-activation",
    { method: "POST" }
  );

// ---------------------------------------------------------------------------
// Helpers — currency formatting + tier resolution helpers used by UI
// ---------------------------------------------------------------------------
const CCY_SYMBOL: Record<string, string> = {
  NZD: "NZ$", AUD: "A$", USD: "US$", GBP: "£", CAD: "C$", INR: "₹",
};

export function formatMoney(amount: number, currency: string): string {
  const sym = CCY_SYMBOL[currency] ?? `${currency} `;
  if (currency === "INR") {
    return `${sym}${Math.round(amount).toLocaleString("en-IN")}`;
  }
  return `${sym}${amount.toFixed(2)}`;
}

export const COUNTRY_LABELS: Record<string, string> = {
  NZ: "🇳🇿  New Zealand",
  AU: "🇦🇺  Australia",
  US: "🇺🇸  United States",
  GB: "🇬🇧  United Kingdom",
  CA: "🇨🇦  Canada",
  IN: "🇮🇳  India",
};
