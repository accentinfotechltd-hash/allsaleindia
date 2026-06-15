import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ShieldCheck, ShieldOff } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
  const [success, setSuccess] = useState<{ title: string; body: string } | null>(null);
  const [showDisableModal, setShowDisableModal] = useState(false);
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

  // Auto-dismiss success banner after 5s
  useEffect(() => {
    if (!success) return;
    const tid = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(tid);
  }, [success]);

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
      setSuccess({
        title: s.two_factor_enabled ? t("two_factor.enabled_alert") : t("two_factor.disabled_alert"),
        body: s.two_factor_enabled
          ? t("two_factor.enabled_alert_body")
          : t("two_factor.disabled_alert_body"),
      });
    } catch (e: any) {
      setErr(e?.message || t("two_factor.could_not_verify"));
    } finally {
      setBusy(false);
    }
  };

  const disableConfirm = () => {
    setShowDisableModal(true);
  };

  const doDisable = async () => {
    setShowDisableModal(false);
    await requestDisable();
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

              {success && (
                <View testID="2fa-success-banner" style={styles.successBanner}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.successTitle}>{success.title}</Text>
                    <Text style={styles.successBody}>{success.body}</Text>
                  </View>
                  <Pressable
                    testID="2fa-success-dismiss"
                    onPress={() => setSuccess(null)}
                    hitSlop={12}
                  >
                    <Text style={styles.successDismiss}>×</Text>
                  </Pressable>
                </View>
              )}

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

      <Modal
        visible={showDisableModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDisableModal(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowDisableModal(false)}
        >
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("two_factor.turn_off_title")}</Text>
            <Text style={styles.modalBody}>{t("two_factor.turn_off_msg")}</Text>
            <View style={styles.modalButtons}>
              <Pressable
                testID="2fa-disable-modal-cancel"
                onPress={() => setShowDisableModal(false)}
                style={styles.modalCancel}
              >
                <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                testID="2fa-disable-modal-confirm"
                onPress={doDisable}
                style={styles.modalConfirm}
              >
                <Text style={styles.modalConfirmText}>{t("two_factor.turn_off")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#a7f3d0",
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  successTitle: { fontSize: 15, fontWeight: "700", color: "#065f46", marginBottom: 2 },
  successBody: { fontSize: 13, color: "#047857", lineHeight: 18 },
  successDismiss: { fontSize: 24, color: "#065f46", fontWeight: "700", paddingHorizontal: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  modalBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.sm },
  modalButtons: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  modalCancel: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    backgroundColor: "#f1f5f9",
  },
  modalCancelText: { color: colors.text, fontWeight: "600", fontSize: 14 },
  modalConfirm: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    backgroundColor: "#dc2626",
  },
  modalConfirmText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
