import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ShieldCheck } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function TwoFactor() {
  const router = useRouter();
  const { token, masked, ttl } = useLocalSearchParams<{
    token: string;
    masked: string;
    ttl: string;
  }>();
  const { loginVerify2FA, resend2FACode } = useAuth();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const m = Number(ttl) || 5;
    return m * 60;
  });
  const inputRef = useRef<TextInput | null>(null);

  // Auto-focus the code input on mount
  useEffect(() => {
    const tid = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(tid);
  }, []);

  // Countdown ticker
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const tid = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tid);
  }, [secondsLeft]);

  const submit = async (override?: string) => {
    setErr("");
    setInfo("");
    const c = (override ?? code).trim();
    if (c.length !== 6) {
      setErr("Enter the 6-digit code from your email");
      return;
    }
    if (!token) {
      setErr("Session expired — sign in again");
      router.replace("/(auth)/login");
      return;
    }
    setBusy(true);
    try {
      await loginVerify2FA(String(token), c);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e?.message || "Verification failed");
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!token || secondsLeft > 270) return; // allow resend after 30s elapsed of 5min window
    setErr("");
    setInfo("");
    try {
      const r = await resend2FACode(String(token));
      setInfo(`New code sent to ${r.masked_email}`);
      setSecondsLeft(5 * 60);
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e: any) {
      setErr(e?.message || "Could not resend code");
    }
  };

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const ss = (secondsLeft % 60).toString().padStart(2, "0");
  const canResend = secondsLeft <= 4 * 60 + 30; // after ~30s

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            testID="2fa-back-btn"
            onPress={() => router.replace("/(auth)/login")}
            style={styles.backBtn}
          >
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          <View style={styles.iconCircle}>
            <ShieldCheck size={32} color={colors.primary} />
          </View>

          <Text style={styles.title}>Two-factor sign in</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to <Text style={styles.bold}>{masked || "your email"}</Text>.
            Enter it below to continue.
          </Text>

          <TextInput
            ref={inputRef}
            testID="2fa-code-input"
            style={styles.codeInput}
            value={code}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              if (digits.length === 6 && !busy) {
                // auto-submit when 6 digits entered
                submit(digits);
              }
            }}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            placeholder="••••••"
            placeholderTextColor={colors.textFaint}
          />

          {!!err && <Text style={styles.error}>{err}</Text>}
          {!!info && <Text style={styles.info}>{info}</Text>}

          <Pressable
            testID="2fa-verify-btn"
            disabled={busy || code.length !== 6}
            onPress={() => submit()}
            style={[styles.cta, (busy || code.length !== 6) && { opacity: 0.5 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Verify & sign in</Text>}
          </Pressable>

          <View style={styles.resendRow}>
            <Text style={styles.timer}>
              Code expires in {mm}:{ss}
            </Text>
            <Pressable
              testID="2fa-resend-btn"
              disabled={!canResend || secondsLeft <= 0}
              onPress={resend}
            >
              <Text
                style={[
                  styles.resendText,
                  (!canResend || secondsLeft <= 0) && { color: colors.textFaint },
                ]}
              >
                Resend code
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Use a different account</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing.md, gap: spacing.md },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#ede9fe",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginTop: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  bold: { fontWeight: "700", color: colors.text },
  codeInput: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 12,
    textAlign: "center",
    paddingVertical: 18,
    borderRadius: radius.lg,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    color: colors.text,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  resendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  timer: { fontSize: 13, color: colors.textMuted },
  resendText: { fontSize: 13, color: colors.primary, fontWeight: "700" },
  error: {
    color: "#dc2626",
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },
  info: {
    color: "#10b981",
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },
  cancelBtn: { alignItems: "center", paddingVertical: spacing.md },
  cancelText: { color: colors.textMuted, fontSize: 14 },
});
