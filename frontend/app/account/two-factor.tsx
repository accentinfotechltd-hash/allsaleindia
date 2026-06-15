import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ShieldCheck, ShieldOff } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Status = { two_factor_enabled: boolean; masked_email: string };

export default function TwoFactorSettings() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<"idle" | "enable_code" | "disable_code">("idle");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const inputRef = useRef<TextInput | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api<Status>("/auth/2fa/status");
      setStatus(s);
    } catch (e: any) {
      setErr(e?.message || "Could not load 2FA status");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (phase !== "idle") {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [phase]);

  const requestEnable = async () => {
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      const r = await api<{ sent: boolean; masked_email: string }>(
        "/auth/2fa/request-enable",
        { method: "POST", body: {} }
      );
      setInfo(`Code sent to ${r.masked_email}`);
      setPhase("enable_code");
      setCode("");
    } catch (e: any) {
      setErr(e?.message || "Could not send code");
    } finally {
      setBusy(false);
    }
  };

  const requestDisable = async () => {
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      const r = await api<{ sent: boolean; masked_email: string }>(
        "/auth/2fa/request-disable",
        { method: "POST", body: {} }
      );
      setInfo(`Code sent to ${r.masked_email}`);
      setPhase("disable_code");
      setCode("");
    } catch (e: any) {
      setErr(e?.message || "Could not send code");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setErr("");
    if (code.length !== 6) {
      setErr("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const path =
        phase === "enable_code" ? "/auth/2fa/confirm-enable" : "/auth/2fa/confirm-disable";
      const s = await api<Status>(path, { method: "POST", body: { code } });
      setStatus(s);
      setPhase("idle");
      setCode("");
      Alert.alert(
        s.two_factor_enabled ? "2FA enabled 🔒" : "2FA disabled",
        s.two_factor_enabled
          ? "From now on, you'll need an email code to sign in."
          : "Your account no longer requires an email code at sign in."
      );
    } catch (e: any) {
      setErr(e?.message || "Could not verify code");
    } finally {
      setBusy(false);
    }
  };

  const disableConfirm = () => {
    Alert.alert(
      "Turn off two-factor authentication?",
      "Your account will be less secure. We'll send a code to verify it's you.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn off", style: "destructive", onPress: requestDisable },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="2fa-settings-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Two-factor authentication</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : !user ? (
            <Text style={styles.muted}>{t("two_factor.please_sign_in")}</Text>
          ) : (
            <>
              <View
                style={[
                  styles.statusCard,
                  status?.two_factor_enabled ? styles.statusOn : styles.statusOff,
                ]}
              >
                {status?.two_factor_enabled ? (
                  <ShieldCheck size={28} color="#10b981" />
                ) : (
                  <ShieldOff size={28} color="#94a3b8" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusTitle}>
                    {status?.two_factor_enabled
                      ? t("two_factor.status_on")
                      : t("two_factor.status_off")}
                  </Text>
                  <Text style={styles.statusBody}>
                    {status?.two_factor_enabled
                      ? t("two_factor.status_on_body", { email: status.masked_email })
                      : t("two_factor.status_off_body")}
                  </Text>
                </View>
              </View>

              {phase === "idle" && (
                <View style={{ gap: spacing.sm }}>
                  {status?.two_factor_enabled ? (
                    <Pressable
                      testID="2fa-disable-btn"
                      disabled={busy}
                      onPress={disableConfirm}
                      style={[styles.danger, busy && { opacity: 0.5 }]}
                    >
                      {busy ? (
                        <ActivityIndicator color="#dc2626" />
                      ) : (
                        <Text style={styles.dangerText}>{t("two_factor.turn_off")}</Text>
                      )}
                    </Pressable>
                  ) : (
                    <Pressable
                      testID="2fa-enable-btn"
                      disabled={busy}
                      onPress={requestEnable}
                      style={[styles.cta, busy && { opacity: 0.5 }]}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.ctaText}>{t("two_factor.turn_on")}</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              )}

              {phase !== "idle" && (
                <View style={styles.codeBlock}>
                  <Text style={styles.codeLabel}>{t("two_factor.code_prompt")}</Text>
                  <TextInput
                    ref={inputRef}
                    testID="2fa-settings-code-input"
                    style={styles.codeInput}
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    placeholder="••••••"
                    placeholderTextColor={colors.textFaint}
                  />
                  {!!err && <Text style={styles.error}>{err}</Text>}
                  {!!info && <Text style={styles.infoText}>{info}</Text>}
                  <Pressable
                    testID="2fa-settings-confirm-btn"
                    disabled={busy || code.length !== 6}
                    onPress={confirm}
                    style={[
                      phase === "enable_code" ? styles.cta : styles.danger,
                      (busy || code.length !== 6) && { opacity: 0.5 },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator
                        color={phase === "enable_code" ? "#fff" : "#dc2626"}
                      />
                    ) : (
                      <Text
                        style={
                          phase === "enable_code" ? styles.ctaText : styles.dangerText
                        }
                      >
                        {phase === "enable_code"
                          ? t("two_factor.confirm_enable")
                          : t("two_factor.confirm_disable")}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setPhase("idle");
                      setCode("");
                      setErr("");
                      setInfo("");
                    }}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
              )}

              <Text style={styles.helpText}>{t("two_factor.help_text")}</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  scroll: { padding: spacing.lg, gap: spacing.md },
  statusCard: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  statusOn: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  statusOff: { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" },
  statusTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 4 },
  statusBody: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  danger: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingVertical: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerText: { color: "#dc2626", fontSize: 16, fontWeight: "700" },
  codeBlock: { gap: spacing.sm },
  codeLabel: { fontSize: 13, color: colors.textMuted },
  codeInput: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 12,
    textAlign: "center",
    paddingVertical: 18,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    color: colors.text,
  },
  error: { color: "#dc2626", fontSize: 13, textAlign: "center" },
  infoText: { color: "#10b981", fontSize: 13, textAlign: "center" },
  cancelText: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
  helpText: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: spacing.md,
  },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 },
});
: colors.textMuted, fontSize: 14, textAlign: "center", marginTop: 40 },
});
