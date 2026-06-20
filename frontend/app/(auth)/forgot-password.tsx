import { useRouter } from "expo-router";
import { ChevronLeft, CheckCircle2, Mail } from "lucide-react-native";
import { useState } from "react";
import {
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

import { api } from "@/src/lib/api";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setErr("Enter a valid email address");
      return;
    }
    setBusy(true);
    try {
      // Backend always returns 204 to avoid revealing whether the email exists.
      await api("/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email: trimmed },
      });
      setSent(true);
    } catch (e: any) {
      // Even on transport errors, show the same "if your email exists…" message
      // so we never leak account existence. Surface a generic friendly note.
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

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
            testID="forgot-back-btn"
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={8}
          >
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          {!sent ? (
            <>
              <View style={styles.iconBubble}>
                <Mail size={28} color={colors.primary} />
              </View>
              <Text style={styles.title}>{t("auth.forgot_title")}</Text>
              <Text style={styles.subtitle}>
                Enter the email associated with your Allsale account and we&apos;ll
                send you a link to reset it. The link is valid for 1 hour.
              </Text>

              <View style={styles.field}>
                <Text style={styles.label}>{t("auth.email")}</Text>
                <TextInput
                  testID="forgot-email-input"
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  value={email}
                  onChangeText={setEmail}
                  returnKeyType="send"
                  onSubmitEditing={submit}
                />
              </View>

              {err ? (
                <Text style={styles.error} testID="forgot-error">
                  {err}
                </Text>
              ) : null}

              <Pressable
                testID="forgot-submit-btn"
                disabled={busy}
                onPress={submit}
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { transform: [{ scale: 0.98 }] },
                  busy && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.ctaText}>
                  {busy ? "Sending…" : "Send reset link"}
                </Text>
              </Pressable>

              <Pressable
                testID="forgot-back-to-login"
                onPress={() => router.replace("/(auth)/login")}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>{t("auth.back_to_signin")}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.iconBubble, styles.successBubble]}>
                <CheckCircle2 size={32} color="#16a34a" />
              </View>
              <Text style={styles.title} testID="forgot-success-title">
                Check your inbox
              </Text>
              <Text style={styles.subtitle}>
                If an account exists for{" "}
                <Text style={styles.emailEmphasis}>{email.trim()}</Text>,
                you&apos;ll receive a password-reset link within a few minutes. The
                link is valid for 1 hour.
              </Text>
              <Text style={styles.helpText}>
                Can&apos;t find it? Check your spam folder or try a different email.
              </Text>

              <Pressable
                testID="forgot-resend-btn"
                onPress={() => setSent(false)}
                style={styles.secondaryCta}
              >
                <Text style={styles.secondaryCtaText}>{t("auth.try_diff_email")}</Text>
              </Pressable>

              <Pressable
                testID="forgot-back-to-login-success"
                onPress={() => router.replace("/(auth)/login")}
                style={styles.linkBtn}
              >
                <Text style={styles.linkText}>{t("auth.back_to_signin")}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  iconBubble: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  successBubble: { backgroundColor: "#dcfce7" },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 10,
    marginBottom: spacing.xl,
    lineHeight: 22,
  },
  emailEmphasis: { color: colors.text, fontWeight: "700" },
  helpText: {
    fontSize: 13,
    color: colors.textFaint,
    marginTop: -spacing.md,
    marginBottom: spacing.xl,
  },
  field: { marginBottom: spacing.md },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#fff",
  },
  error: { color: colors.error, fontSize: 13, marginTop: 4, marginBottom: 8 },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondaryCta: {
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  secondaryCtaText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  linkBtn: { alignItems: "center", marginTop: spacing.lg, padding: spacing.sm },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
});
