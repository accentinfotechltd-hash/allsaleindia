import { Link, useRouter } from "expo-router";
import { ChevronLeft, Eye, EyeOff } from "lucide-react-native";
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

import { useAuth } from "@/src/contexts/AuthContext";
import { GoogleSignInButton } from "@/src/components/GoogleSignInButton";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Register() {
  const router = useRouter();
  const { register } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!fullName.trim() || !email.trim() || !password) {
      setErr("Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters");
      return;
    }
    setBusy(true);
    try {
      await register(email.trim(), password, fullName.trim());
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e?.message || "Could not create account");
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
          <Pressable testID="register-back-btn" onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>

          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Join thousands of Kiwis shopping authentic India.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              testID="register-name-input"
              style={styles.input}
              placeholder="Jane Doe"
              placeholderTextColor={colors.textFaint}
              value={fullName}
              onChangeText={setFullName}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="register-email-input"
              style={styles.input}
              placeholder="you@example.co.nz"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="register-password-input"
                style={[styles.input, { flex: 1, borderWidth: 0 }]}
                placeholder="At least 6 characters"
                placeholderTextColor={colors.textFaint}
                secureTextEntry={!showPwd}
                value={password}
                onChangeText={setPassword}
              />
              <Pressable testID="register-toggle-password" onPress={() => setShowPwd((v) => !v)} style={styles.eyeBtn}>
                {showPwd ? <EyeOff size={18} color={colors.textMuted} /> : <Eye size={18} color={colors.textMuted} />}
              </Pressable>
            </View>
          </View>

          {err ? <Text style={styles.error} testID="register-error">{err}</Text> : null}

          <Pressable
            testID="register-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            <Text style={styles.ctaText}>{busy ? "Creating account…" : "Create account"}</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleSignInButton
            testID="register-google-btn"
            label="Sign up with Google"
            redirectTo="/(tabs)/home"
          />

          <Text style={styles.terms}>
            By continuing, you agree to Allsale&apos;s Terms of Service and Privacy Policy.
          </Text>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable testID="register-go-login">
                <Text style={styles.footerLink}>Sign in</Text>
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
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  terms: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: spacing.lg, lineHeight: 18 },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  footerText: { color: colors.textMuted, fontSize: 14 },
  footerLink: { color: colors.primary, fontSize: 14, fontWeight: "700" },
});
