/**
 * Security settings — Biometric login + Auto-lock + Checkout confirmation.
 *
 * All three toggles persist locally (AsyncStorage). The "Use biometric to
 * sign in" toggle additionally calls the backend `/auth/biometric/pair` and
 * `/auth/biometric/revoke` endpoints.
 *
 * On web: shows a single info card explaining biometrics aren't available;
 * all toggles render disabled.
 */
import { useRouter } from "expo-router";
import { ChevronLeft, Fingerprint, Lock, ShoppingBag } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "@/src/contexts/AuthContext";
import { useToast } from "@/src/components/UiOverlayProvider";
import {
  type BiometricCapability,
  getBiometricCapability,
  hasPairedDevice,
  pairDevice,
  unpairDevice,
} from "@/src/lib/biometric";
import { colors, radius, spacing } from "@/src/lib/theme";

const AUTO_LOCK_KEY = "allsale.bio_auto_lock";
const CHECKOUT_CONFIRM_KEY = "allsale.bio_checkout_confirm";

export default function SecurityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [biometricLoginOn, setBiometricLoginOn] = useState(false);
  const [autoLockOn, setAutoLockOn] = useState(false);
  const [checkoutConfirmOn, setCheckoutConfirmOn] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // which toggle is mid-flight
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const cap = await getBiometricCapability();
    setCapability(cap);
    const [paired, lock, confirm] = await Promise.all([
      hasPairedDevice(),
      AsyncStorage.getItem(AUTO_LOCK_KEY),
      AsyncStorage.getItem(CHECKOUT_CONFIRM_KEY),
    ]);
    setBiometricLoginOn(paired);
    setAutoLockOn(lock === "1");
    setCheckoutConfirmOn(confirm === "1");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onToggleBiometricLogin = async (next: boolean) => {
    if (!user) return;
    setPending("login");
    try {
      if (next) {
        await pairDevice({ email: user.email, deviceName: deviceLabel() });
        setBiometricLoginOn(true);
        toast.show({
          title: `${capability?.label || "Biometric"} login enabled`,
          body: "Next time you open Allsale, sign in with a quick tap.",
          kind: "success",
        });
      } else {
        await unpairDevice();
        setBiometricLoginOn(false);
        toast.show({ title: "Biometric login disabled", kind: "info" });
      }
    } catch (e: any) {
      const msg = e?.message || "Couldn't update biometric login";
      toast.show({ title: msg, kind: "error" });
    } finally {
      setPending(null);
    }
  };

  const onToggleAutoLock = async (next: boolean) => {
    setPending("lock");
    try {
      await AsyncStorage.setItem(AUTO_LOCK_KEY, next ? "1" : "0");
      setAutoLockOn(next);
    } finally {
      setPending(null);
    }
  };

  const onToggleCheckoutConfirm = async (next: boolean) => {
    setPending("checkout");
    try {
      await AsyncStorage.setItem(CHECKOUT_CONFIRM_KEY, next ? "1" : "0");
      setCheckoutConfirmOn(next);
    } finally {
      setPending(null);
    }
  };

  const supported = !!capability?.available;
  const biometricLabel = capability?.label || "Biometric";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="security-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Security</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Fingerprint size={28} color="#fff" />
              </View>
              <Text style={styles.heroTitle}>{biometricLabel}</Text>
              <Text style={styles.heroSub}>
                {supported
                  ? `Use ${biometricLabel} to skip typing your password, lock the app, and confirm purchases.`
                  : Platform.OS === "web"
                  ? "Biometric features run on a native device build. Open Allsale in the iOS/Android app to enable them."
                  : "No biometric is enrolled on this device. Add Face ID / fingerprint in your phone's Settings, then come back."}
              </Text>
            </View>

            {/* Toggle 1 — sign in with biometric (calls backend) */}
            <Row
              testID="bio-toggle-login"
              icon={<Fingerprint size={18} color={colors.primary} />}
              title={`Sign in with ${biometricLabel}`}
              subtitle="After your next sign-in, you'll see a one-tap login button on the welcome screen."
              value={biometricLoginOn}
              onChange={onToggleBiometricLogin}
              disabled={!supported || pending === "login"}
              busy={pending === "login"}
            />

            {/* Toggle 2 — auto-lock on backgrounding (local only) */}
            <Row
              testID="bio-toggle-autolock"
              icon={<Lock size={18} color={colors.primary} />}
              title="Lock app after 30s in background"
              subtitle={`Require ${biometricLabel} to reopen Allsale if you've been away for 30 seconds or more.`}
              value={autoLockOn}
              onChange={onToggleAutoLock}
              disabled={!supported || pending === "lock"}
              busy={pending === "lock"}
            />

            {/* Toggle 3 — checkout confirm (local only) */}
            <Row
              testID="bio-toggle-checkout"
              icon={<ShoppingBag size={18} color={colors.primary} />}
              title="Confirm purchases with biometric"
              subtitle="Show a biometric prompt before each Stripe checkout — handy for shared devices."
              value={checkoutConfirmOn}
              onChange={onToggleCheckoutConfirm}
              disabled={!supported || pending === "checkout"}
              busy={pending === "checkout"}
            />

            <Text style={styles.footnote}>
              Biometric data never leaves your device — we only store a long-lived device token
              (hashed) that you can revoke at any time.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  title,
  subtitle,
  value,
  onChange,
  disabled,
  busy,
  testID,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const blocked = !!disabled || !!busy;
  // Tap-anywhere-on-the-row toggles the Switch. The native <Switch> stays
  // wired up so the swipe gesture continues to work; this just gives users
  // a 100%-width tap target which is the expected mobile UX for settings.
  return (
    <Pressable
      onPress={() => {
        if (!blocked) onChange(!value);
      }}
      android_ripple={!blocked ? { color: "rgba(0,0,0,0.06)" } : undefined}
      style={({ pressed }) => [
        styles.row,
        disabled && { opacity: 0.6 },
        pressed && !blocked && { backgroundColor: colors.surfaceMuted },
      ]}
      testID={testID}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: colors.surfaceMuted, true: colors.primarySoft }}
          thumbColor={value ? colors.primary : "#fff"}
          // iOS sets ios_backgroundColor; harmless on Android.
          ios_backgroundColor={colors.surfaceMuted}
        />
      )}
    </Pressable>
  );
}

function deviceLabel(): string {
  if (Platform.OS === "ios") return "iPhone";
  if (Platform.OS === "android") return "Android device";
  return "Web";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: 8,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: "#fff", fontSize: 18, fontWeight: "800" },
  heroSub: { color: "rgba(255,255,255,0.92)", fontSize: 13, lineHeight: 19, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  footnote: { color: colors.textFaint, fontSize: 11, textAlign: "center", lineHeight: 15, marginTop: spacing.sm },
});
