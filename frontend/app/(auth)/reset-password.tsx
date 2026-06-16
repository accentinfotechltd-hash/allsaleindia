import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react-native";
import { useMemo, useState } from "react";
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
import { colors, radius, spacing } from "@/src/lib/theme";

/**
 * Reset-password screen — consumes the token sent by `forgot-password.tsx`.
 *
 * The token arrives via deep link / query param: `/reset-password?token=…`.
 * If the param is missing (user got here some other way) we let them paste
 * it in by hand.
 */
export default function ResetPassword() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const initialToken = useMemo(
    () => (typeof params.token === "string" ? params.token : ""),
    [params.token]
  );

  const [token, setToken] = useState(initialToken);
  const [pwd, setPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ email?: string } | null>(null);

  const pwdProblem = useMemo(() => {
    if (!pwd) return null;
    if (pwd.length < 8) return "At least 8 characters";
    if (!/\d/.test(pwd)) return "Include at least one number";
    return null;
  }, [pwd]);

  const submit = async () => {
    setErr("");
    const t = token.trim();
    if (!t) {
      setErr("Paste the reset link or token from your email");
      return;
    }
    if (pwd.length < 8 || !/\d/.test(pwd)) {
      setErr("Password must be 8+ characters and include a number");
      return;
    }
    if (pwd !== confirmPwd) {
      setErr("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; email?: string }>(
        "/auth/reset-password",
        {
          method: "POST",
          auth: false,
          body: { token: t, new_password: pwd },
        }
      );
      setDone({ email: res.email });
    } catch (e: any) {
      setErr(e?.message || "Couldn't reset password — link may have expired");
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
            testID="reset-back-btn"
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={8}
          >
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          {!done ? (
            <>
              <View style={styles.iconBubble}>
                <KeyRound size={28} color={colors.primary} />
              </View>
              <Text style={styles.title}>Choose a new password</Text>
              <Text style={styles.subtitle}>
                Set a strong password you&apos;ll remember. After you reset, you&apos;ll
                be signed out of every other device.
              </Text>

              {!initialToken ? (
                <View style={styles.field}>
                  <Text style={styles.label}>Reset token</Text>
                  <TextInput
                    testID="reset-token-input"
                    style={styles.input}
                    placeholder="Paste from your email"
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={token}
                    onChangeText={setToken}
                  />
                  <Text style={styles.helpInline}>
                    Open the email we sent you and tap the reset button — or
                    paste the token here.
                  </Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>New password</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    testID="reset-new-password-input"
                    style={[styles.input, { flex: 1, borderWidth: 0 }]}
                    placeholder="At least 8 characters, 1 number"
                    placeholderTextColor={colors.textFaint}
                    secureTextEntry={!showPwd}
                    value={pwd}
                    onChangeText={setPwd}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    testID="reset-toggle-password"
                    onPress={() => setShowPwd((v) => !v)}
                    style={styles.eyeBtn}
                    hitSlop={8}
                  >
                    {showPwd ? (
                      <EyeOff size={18} color={colors.textMuted} />
                    ) : (
                      <Eye size={18} color={colors.textMuted} />
                    )}
                  </Pressable>
                </View>
                {pwdProblem ? (
                  <Text style={styles.helpInline} testID="reset-pwd-hint">
                    {pwdProblem}
                  </Text>
                ) : null}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  testID="reset-confirm-password-input"
                  style={styles.input}
                  placeholder="Re-enter new password"
                  placeholderTextColor={colors.textFaint}
                  secureTextEntry={!showPwd}
                  value={confirmPwd}
                  onChangeText={setConfirmPwd}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {err ? (
                <Text style={styles.error} testID="reset-error">
                  {err}
                </Text>
              ) : null}

              <Pressable
                testID="reset-submit-btn"
                disabled={busy}
                onPress={submit}
                style={({ pressed }) => [
                  styles.cta,
                  pressed && { transform: [{ scale: 0.98 }] },
                  busy && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.ctaText}>
                  {busy ? "Updating…" : "Update password"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.iconBubble, styles.successBubble]}>
                <CheckCircle2 size={32} color="#16a34a" />
              </View>
              <Text style={styles.title} testID="reset-success-title">
                Password updated
              </Text>
              <Text style={styles.subtitle}>
                {done.email
                  ? `Your password for ${done.email} has been changed. `
                  : "Your password has been changed. "}
                Sign in with your new password to continue.
              </Text>
              <Pressable
                testID="reset-go-login-btn"
                onPress={() => router.replace("/(auth)/login")}
                style={styles.cta}
              >
                <Text style={styles.ctaText}>Sign in</Text>
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
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingRight: spacing.sm,
    backgroundColor: "#fff",
  },
  eyeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  helpInline: { fontSize: 12, color: colors.textFaint, marginTop: 6 },
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
});
