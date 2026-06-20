/**
 * Sentry — production crash & performance monitoring.
 *
 * Safe no-op when `EXPO_PUBLIC_SENTRY_DSN` is empty or missing so that
 * local dev, Expo Go, and preview builds never crash on init. Populate
 * the env var (e.g. via EAS secret) to enable in production builds.
 */
import * as Sentry from "@sentry/react-native";

let _initialised = false;

export function initSentry(): void {
  if (_initialised) return;

  const dsn = (process.env.EXPO_PUBLIC_SENTRY_DSN || "").trim();
  if (!dsn) {
    // No DSN configured — skip silently. Wrapping with `Sentry.wrap` still
    // works (it is a no-op when init was not called).
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment:
        (process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || "production").trim() ||
        "production",
      // Default: sample 5% of transactions to keep costs low. Override via
      // a dedicated env var if needed.
      tracesSampleRate: 0.05,
      // Reduce default PII collection — we don't want to leak emails/tokens.
      sendDefaultPii: false,
      // Show breadcrumbs but cap to keep payloads small.
      maxBreadcrumbs: 50,
      // Disable in development so console isn't spammed.
      enabled: !__DEV__,
    });
    _initialised = true;
  } catch (err) {
    // Sentry init must never throw out of the app. Log and move on.
    console.warn("[sentry] init failed — continuing without monitoring", err);
  }
}

/**
 * `Sentry.wrap` enables performance + profiling integrations. It is safe to
 * call even when `init` was skipped (no DSN). We re-export it so callers
 * don't need to import `@sentry/react-native` directly.
 */
export const wrap = Sentry.wrap;

/**
 * Capture an exception manually. No-op when Sentry is disabled.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!_initialised) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    /* ignore */
  }
}
