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
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!email.trim() || !password) {
      setErr("Enter your email and password");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setErr(e?.message || "Login failed");
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

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to keep shopping authentic India.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="login-email-input"
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
            testID="login-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            <Text style={styles.ctaText}>{busy ? "Signing in…" : "Sign in"}</Text>
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New to Allsale? </Text>
            <Link href="/(auth)/register" asChild>
              <Pressable testID="login-go-register">
                <Text style={styles.footerLink}>Create account</Text>
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
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xl },
  footerText: { color: colors.textMuted, fontSize: 14 },
  footerLink: { color: colors.primary, fontSize: 14, fontWeight: "700" },
});
