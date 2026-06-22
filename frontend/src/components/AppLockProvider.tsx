/**
 * AppLockProvider — re-unlocks the app with biometric when it returns from
 * background after > LOCK_AFTER_MS.
 *
 *  How it fits the navigation tree:
 *    <AuthProvider>
 *      <AppLockProvider>
 *        ...rest of the app
 *      </AppLockProvider>
 *    </AuthProvider>
 *
 *  Triggers a full-screen overlay (not a modal — modals can be dismissed by
 *  routing actions) when the criteria are met. The overlay covers everything
 *  except the biometric prompt itself.
 */
import { Fingerprint } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "@/src/contexts/AuthContext";
import {
  type BiometricCapability,
  getBiometricCapability,
  promptBiometric,
} from "@/src/lib/biometric";
import { colors, radius, spacing } from "@/src/lib/theme";

const AUTO_LOCK_KEY = "allsale.bio_auto_lock";
const LOCK_AFTER_MS = 30_000; // 30 seconds in background → lock

export function AppLockProvider({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [locked, setLocked] = useState(false);
  const [cap, setCap] = useState<BiometricCapability | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Probe capability once; used to skip lock logic on web / unsupported devices.
  useEffect(() => {
    (async () => {
      setCap(await getBiometricCapability());
    })();
  }, []);

  const isAutoLockEnabled = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    if (!cap?.available) return false;
    const v = await AsyncStorage.getItem(AUTO_LOCK_KEY);
    return v === "1";
  }, [user, cap]);

  const tryUnlock = useCallback(async () => {
    setUnlockError(null);
    setUnlocking(true);
    try {
      const ok = await promptBiometric("Unlock Allsale");
      if (ok) {
        setLocked(false);
      } else {
        setUnlockError("Unlock cancelled — try again, or sign out.");
      }
    } finally {
      setUnlocking(false);
    }
  }, []);

  // Subscribe to AppState transitions.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (prev === "active" && (next === "background" || next === "inactive")) {
        backgroundedAt.current = Date.now();
        return;
      }

      if (next === "active" && prev !== "active") {
        const ts = backgroundedAt.current;
        backgroundedAt.current = null;
        if (!ts) return;
        const elapsed = Date.now() - ts;
        if (elapsed < LOCK_AFTER_MS) return;
        const enabled = await isAutoLockEnabled();
        if (enabled) {
          setLocked(true);
          // Immediately prompt — most users want it instant on return.
          void tryUnlock();
        }
      }
    });
    return () => sub.remove();
  }, [isAutoLockEnabled, tryUnlock]);

  // Auto-unlock if the user logs out while locked.
  useEffect(() => {
    if (!user && locked) setLocked(false);
  }, [user, locked]);

  return (
    <>
      {children}
      {locked && cap?.available ? (
        <View style={styles.overlay} testID="app-lock-overlay">
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Fingerprint size={36} color="#fff" />
            </View>
            <Text style={styles.title}>Allsale is locked</Text>
            <Text style={styles.body}>
              {`Use ${cap.label} to unlock Allsale and continue where you left off.`}
            </Text>
            {unlockError ? <Text style={styles.error}>{unlockError}</Text> : null}
            <Pressable
              testID="app-lock-unlock-btn"
              disabled={unlocking}
              onPress={tryUnlock}
              style={({ pressed }) => [
                styles.cta,
                pressed && { transform: [{ scale: 0.98 }] },
                unlocking && { opacity: 0.7 },
              ]}
            >
              {unlocking ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>{`Unlock with ${cap.label}`}</Text>
              )}
            </Pressable>
            <Pressable
              testID="app-lock-signout-btn"
              onPress={() => {
                setLocked(false);
                void logout();
              }}
              style={styles.signOutBtn}
            >
              <Text style={styles.signOutText}>Sign out instead</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    inset: 0 as unknown as number, // RN doesn't typecheck inset, but it works on web; we set top/left/right/bottom below for native.
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,15,30,0.96)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    zIndex: 9999,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.text },
  body: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 20 },
  error: { color: colors.error, fontSize: 13, textAlign: "center" },
  cta: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    minWidth: 220,
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  signOutBtn: { paddingVertical: 6 },
  signOutText: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
});
