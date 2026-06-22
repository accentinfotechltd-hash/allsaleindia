/**
 * Biometric service — Face ID / Touch ID / Fingerprint wrapper.
 *
 * Three use cases share these primitives:
 *   1. App re-unlock (background > 30s) — see useAppLock()
 *   2. Login replacement — pair() once, then biometricLogin() on cold start
 *   3. Checkout confirmation — promptBiometric() before Stripe redirect
 *
 * Web is a graceful no-op: hasHardware / isEnrolled return false so the
 * UI hides biometric toggles and the dashboard falls back to password.
 *
 * SecureStore caveat: on web, our storage.secureSet polyfills to
 * AsyncStorage / localStorage — fine for non-sensitive flags, but the
 * raw biometric token never reaches web because we skip the storage step
 * when Platform.OS === "web".
 */
import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

import { api } from "@/src/lib/api";

const BIO_TOKEN_KEY = "allsale.bio_token";
const BIO_DEVICE_ID_KEY = "allsale.bio_device_id";
const BIO_EMAIL_KEY = "allsale.bio_email"; // shown on login screen as "Sign in as …"

export type BiometricCapability = {
  /** Hardware present (sensor exists). */
  hasHardware: boolean;
  /** User has at least one face / fingerprint enrolled at OS level. */
  isEnrolled: boolean;
  /** Friendly label: "Face ID" | "Touch ID" | "Fingerprint" | "Biometric". */
  label: string;
  /** True if app can actually invoke a biometric prompt right now. */
  available: boolean;
};

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (!isNative) {
    return { hasHardware: false, isEnrolled: false, label: "Biometric", available: false };
  }
  const [hasHardware, isEnrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  let label = "Biometric";
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    label = Platform.OS === "ios" ? "Face ID" : "Face unlock";
  } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    label = Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
  } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    label = "Iris";
  }
  return {
    hasHardware,
    isEnrolled,
    label,
    available: hasHardware && isEnrolled,
  };
}

/** Show the OS biometric prompt. Returns true on success, false on any failure. */
export async function promptBiometric(reason = "Confirm your identity"): Promise<boolean> {
  if (!isNative) return false;
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Cancel",
      // disableDeviceFallback: false lets OS show passcode if biometric fails
      // multiple times — better UX than locking the user out.
      disableDeviceFallback: false,
      fallbackLabel: "Use passcode",
    });
    return !!res.success;
  } catch {
    return false;
  }
}

/** True if this device has previously been paired (biometric token present). */
export async function hasPairedDevice(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const v = await SecureStore.getItemAsync(BIO_TOKEN_KEY);
    return !!v;
  } catch {
    return false;
  }
}

/** Email associated with the paired device (for "Sign in as Sarah" UX). */
export async function pairedEmail(): Promise<string | null> {
  if (!isNative) return null;
  try {
    return (await SecureStore.getItemAsync(BIO_EMAIL_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * Pair this device with the currently authenticated user. Called after a
 * successful password login when the user opts into biometric login.
 * Stores the returned device-token in SecureStore (encrypted at rest via
 * iOS Keychain / Android Keystore). The raw token is never persisted in
 * AsyncStorage / localStorage.
 */
export async function pairDevice(opts: { email: string; deviceName?: string }): Promise<void> {
  if (!isNative) throw new Error("Biometric login is not available on web");
  // Get explicit biometric consent BEFORE issuing the device token —
  // the playbook recommends this so the token's first storage is gated.
  const ok = await promptBiometric("Enable biometric login");
  if (!ok) throw new Error("Biometric authentication cancelled");

  const res = await api<{ device_id: string; device_token: string; expires_in_days: number }>(
    "/auth/biometric/pair",
    {
      method: "POST",
      body: { device_name: opts.deviceName || `${Platform.OS} device`, platform: Platform.OS },
    },
  );
  await SecureStore.setItemAsync(BIO_TOKEN_KEY, res.device_token);
  await SecureStore.setItemAsync(BIO_DEVICE_ID_KEY, res.device_id);
  await SecureStore.setItemAsync(BIO_EMAIL_KEY, opts.email);
}

/**
 * Use the paired biometric device-token to obtain a fresh JWT.
 * Prompts biometric first; on failure returns null without contacting the
 * backend. On 401 from the backend (e.g. token rotated server-side via
 * password reset), wipes local pairing so the user falls back to password.
 */
export async function biometricLogin(): Promise<{ access_token: string; user: any } | null> {
  if (!isNative) return null;
  const cap = await getBiometricCapability();
  if (!cap.available) return null;
  const [deviceToken, deviceId] = await Promise.all([
    SecureStore.getItemAsync(BIO_TOKEN_KEY),
    SecureStore.getItemAsync(BIO_DEVICE_ID_KEY),
  ]);
  if (!deviceToken || !deviceId) return null;

  const ok = await promptBiometric("Sign in with biometrics");
  if (!ok) return null;

  try {
    const res = await api<{ access_token: string; user: any }>("/auth/biometric/login", {
      method: "POST",
      auth: false,
      body: { device_id: deviceId, device_token: deviceToken },
    });
    return res;
  } catch (e: any) {
    // Server invalidated this device — wipe local state so the user sees the
    // password login screen instead of a perpetually-failing biometric prompt.
    if (e?.status === 401) {
      await clearPairedDevice();
    }
    return null;
  }
}

/** Wipe pairing info (used on logout, on 401, or when the user disables biometric). */
export async function clearPairedDevice(): Promise<void> {
  if (!isNative) return;
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(BIO_TOKEN_KEY),
      SecureStore.deleteItemAsync(BIO_DEVICE_ID_KEY),
      SecureStore.deleteItemAsync(BIO_EMAIL_KEY),
    ]);
  } catch {
    /* best-effort */
  }
}

/** Unpair this device on the server too (calls /auth/biometric/revoke). */
export async function unpairDevice(): Promise<void> {
  if (!isNative) {
    await clearPairedDevice();
    return;
  }
  const deviceId = await SecureStore.getItemAsync(BIO_DEVICE_ID_KEY);
  if (deviceId) {
    try {
      await api("/auth/biometric/revoke", { method: "POST", body: { device_id: deviceId } });
    } catch {
      /* swallow — local clear still happens below */
    }
  }
  await clearPairedDevice();
}

/** List all paired devices for the current user (used in Settings). */
export async function listPairedDevices(): Promise<
  {
    device_id: string;
    device_name: string | null;
    platform: string | null;
    created_at: string;
    last_used_at: string | null;
    revoked: boolean;
  }[]
> {
  return api("/auth/biometric/devices");
}

/** Revoke a specific device (by device_id, e.g. from the settings list). */
export async function revokeDevice(deviceId: string): Promise<void> {
  await api("/auth/biometric/revoke", { method: "POST", body: { device_id: deviceId } });
  // If the user revoked the CURRENT device, clear local state too.
  const localId = isNative ? await SecureStore.getItemAsync(BIO_DEVICE_ID_KEY) : null;
  if (localId === deviceId) {
    await clearPairedDevice();
  }
}

/** Revoke ALL paired devices (panic button). */
export async function revokeAllDevices(): Promise<number> {
  const res = await api<{ revoked_count: number }>("/auth/biometric/all", { method: "DELETE" });
  await clearPairedDevice();
  return res.revoked_count;
}
