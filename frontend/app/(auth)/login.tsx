import { Link, useRouter } from "expo-router";
import { ChevronLeft, Eye, EyeOff, Fingerprint } from "lucide-react-native";
import { useEffect, useState } from "react";
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

import { useAuth } from "@/src/contexts/AuthContext";
import { GoogleSignInButton } from "@/src/components/GoogleSignInButton";
import { AppleSignInButton } from "@/src/components/AppleSignInButton";
import { useTranslation } from "@/src/i18n";
import {
  type BiometricCapability,
  getBiometricCapability,
  hasPairedDevice,
  pairedEmail,
} from "@/src/lib/biometric";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Login() {
  const router = useRouter();
  const { login, loginWithBiometric } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bioCap, setBioCap] = useState<BiometricCapability | null>(null);
  const [bioReady, setBioReady] = useState(false);          // device is paired
  const [bioEmail, setBioEmail] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);

  // Probe biometric availability + pairing on mount so we can offer a
  // "Sign in with Face ID" button. Web/unsupported devices simply hide it.
  useEffect(() => {
    (async () => {
      const [cap, paired, em] = await Promise.all([
        getBiometricCapability(),
        hasPairedDevice(),
        pairedEmail(),
      ]);
      setBioCap(cap);
      setBioReady(paired);
      setBioEmail(em);
    })();
  }, []);

  const onBiometricSignIn = async () => {
    setErr("");
    setBioBusy(true);
    try {
      const ok = await loginWithBiometric();
      if (ok) {
        router.replace("/(tabs)/home");
      } else {
        setErr("Biometric sign-in cancelled or failed. Please use your password.");
      }
    } catch (e: any) {
      setErr(e?.message || "Biometric sign-in failed");
    } finally {
      setBioBusy(false);
    }
  };

  const submit = async () => {
    setErr("");
    if (!email.trim() || !password) {
      setErr(t("auth.enter_credentials"));
      return;
    }
    setBusy(true);
    try {
      const result = await login(email.trim(), password);
      if (result.kind === "2fa_required") {
        router.replace({
          pathname: "/(auth)/two-factor",
          params: {
            token: result.ephemeralToken,
            masked: result.maskedEmail,
            ttl: String(result.ttlMinutes),
          },
        });
        return;
      }
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e?.message || t("auth.login_failed"));
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
          <Pressable testID="login-back-btn" onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          <Text style={styles.title}>{t("auth.welcome_back")}</Text>
          <Text style={styles.subtitle}>{t("auth.welcome_back_sub")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("auth.email")}</Text>
            <TextInput
              testID="login-email-input"
              style={styles.input}
              placeholder={t("auth.email_placeholder")}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{t("auth.password")}</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="login-password-input"
                style={[styles.input, { flex: 1, borderWidth: 0 }]}
                placeholder="Your password"
                placeholderTextColor={colors.textFaint}
                secureTextEntry={!showPwd}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable testID="login-toggle-password" onPress={() => setShowPwd((v) => !v)} style={styles.eyeBtn}>
                {showPwd ? <EyeOff size={18} color={colors.textMuted} /> : <Eye size={18} color={colors.textMuted} />}
              </Pressable>
            </View>
          </View>

          {err ? <Text style={styles.error} testID="login-error">{err}</Text> : null}

          <Pressable
            testID="login-forgot-password"
            onPress={() => router.push("/(auth)/forgot-password")}
            style={styles.forgotBtn}
            hitSlop={8}
          >
            <Text style={styles.forgotText}>{t("auth.forgot_password")}</Text>
          </Pressable>

          <Pressable
            testID="login-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            <Text style={styles.ctaText}>{busy ? "Signing in…" : "Sign in"}</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {bioReady && bioCap?.available ? (
            <Pressable
              testID="login-biometric-btn"
              disabled={bioBusy || busy}
              onPress={onBiometricSignIn}
              style={({ pressed }) => [
                styles.bioBtn,
                pressed && { transform: [{ scale: 0.98 }] },
                (bioBusy || busy) && { opacity: 0.7 },
              ]}
            >
              <Fingerprint size={20} color={colors.primary} />
              <Text style={styles.bioBtnText}>
                {bioBusy
                  ? "Authenticating…"
                  : bioEmail
                  ? `Sign in as ${bioEmail} with ${bioCap.label}`
                  : `Sign in with ${bioCap.label}`}
              </Text>
            </Pressable>
          ) : null}

          <GoogleSignInButton
            testID="login-google-btn"
            label="Continue with Google"
            redirectTo="/(tabs)/home"
          />

          <AppleSignInButton
            testID="login-apple-btn"
            redirectTo="/(tabs)/home"
          />

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t("auth.new_to_allsale")}</Text>
            <Link href="/(auth)/register" asChild>
              <Pressable testID="login-go-register">
                <Text style={styles.footerLink}>{t("auth.create_account_link")}</Text>
              </Pressable>
            </Link>
          </View>
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
  title: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 8, marginBottom: spacing.xl },
  field: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 8 },
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
  },
  eyeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
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
  bioBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
    marginBottom: spacing.md,
  },
  bioBtnText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  footerText: { color: colors.textMuted, fontSize: 14 },
  footerLink: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  forgotBtn: { alignSelf: "flex-end", paddingVertical: 6, marginTop: -4 },
  forgotText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
});
