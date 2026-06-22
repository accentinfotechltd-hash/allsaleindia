/**
 * Ambassador referral capture for mobile.
 *
 * Mirrors the web team's cookie-based capture: the moment the app receives a
 * deeplink containing `?ref=CODE` (custom scheme `allsale://?ref=CODE` or a
 * universal link `https://allsale.co.nz/?ref=CODE`), we resolve the code via
 * the backend and persist it locally with a 90-day TTL — matching the
 * backend's ``B2C_ATTRIBUTION_DAYS`` constant. The home screen banner and
 * cart auto-coupon both read from this store.
 *
 * Storage shape (AsyncStorage key ``allsale_ref_v1``):
 *   { code: "SARAH5", name: "Sarah Jenkins", program: "B2C",
 *     captured_at: <ISO>, expires_at: <ISO> }
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { lookupCode } from "./ambassadors";

const STORAGE_KEY = "allsale_ref_v1";
const TTL_DAYS = 90;

export type StoredRef = {
  code: string;
  name: string;
  program: "B2C" | "B2B" | "BOTH";
  primary_platform: string | null;
  captured_at: string; // ISO
  expires_at: string;  // ISO
};

const DISMISSED_KEY_PREFIX = "allsale_ref_dismissed_";

// ---------------------------------------------------------------------------
// URL parsing — accepts:
//   allsale://?ref=SARAH5         (custom scheme)
//   allsale://product/abc?ref=…   (custom scheme with path)
//   https://allsale.co.nz/?ref=…  (universal link)
//   https://allsale.co.nz/product/abc?ref=…
// ---------------------------------------------------------------------------
export function extractRefFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/[?&]ref=([A-Z0-9]{3,20})\b/i);
  if (!m) return null;
  return m[1].toUpperCase();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
export async function getStoredRef(): Promise<StoredRef | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRef;
    // TTL guard.
    if (new Date(parsed.expires_at).getTime() <= Date.now()) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearStoredRef(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** Resolve a raw ref code via the backend, then persist it. Returns the stored
 * payload, or `null` if the code doesn't validate. Idempotent — re-capturing
 * the same code just refreshes the TTL. Different code OVERWRITES previous
 * (matches web semantics: "last-touch attribution"). */
export async function captureRef(rawCode: string): Promise<StoredRef | null> {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) return null;
  try {
    const info = await lookupCode(code);
    // Sanity check: the backend uppercases its codes too.
    if (!info?.code) return null;
    const now = new Date();
    const expires = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
    const payload: StoredRef = {
      code: info.code,
      name: info.name,
      program: info.program,
      primary_platform: info.primary_platform,
      captured_at: now.toISOString(),
      expires_at: expires.toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    // Reset the dismissal flag so the banner shows again for the NEW code.
    return payload;
  } catch {
    // Invalid/suspended code → silently no-op (matches web behavior).
    return null;
  }
}

/** Capture a ref from a pre-resolved `/api/ambassadors/resolve/{code}` payload.
 *
 * Used by the `/a/{code}` smart-link landing page which already has the
 * resolved object (no need to round-trip a second `lookupCode` call).
 * Writes to the same `allsale_ref_v1` storage so the cart auto-apply and
 * seller signup pre-fill both keep working.
 */
export async function captureRefFromResolved(
  resolved: { code: string; name: string; program: "B2C" | "B2B" | "BOTH"; primary_platform: string | null },
): Promise<StoredRef | null> {
  try {
    const now = new Date();
    const expires = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);
    const payload: StoredRef = {
      code: resolved.code,
      name: resolved.name,
      program: resolved.program,
      primary_platform: resolved.primary_platform,
      captured_at: now.toISOString(),
      expires_at: expires.toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

/** Convenience wrapper used by the top-level _layout deeplink listener. */
export async function captureRefFromUrl(url: string | null | undefined): Promise<StoredRef | null> {
  const code = extractRefFromUrl(url);
  if (!code) return null;
  return captureRef(code);
}

// ---------------------------------------------------------------------------
// Welcome-banner dismissal — keyed per code so dismissing Sarah's banner
// doesn't suppress Rajesh's later.
// ---------------------------------------------------------------------------
export async function isBannerDismissed(code: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(DISMISSED_KEY_PREFIX + code.toUpperCase());
    return v === "1";
  } catch {
    return false;
  }
}

export async function dismissBanner(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY_PREFIX + code.toUpperCase(), "1");
  } catch {
    /* noop */
  }
}
