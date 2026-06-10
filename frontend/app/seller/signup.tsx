import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
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

import { BusinessFields, useBusinessForm } from "@/src/components/BusinessFields";
import { useAuth } from "@/src/contexts/AuthContext";
import { api, setToken } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function SellerSignup() {
  const router = useRouter();
  const { refresh } = useAuth();
  const { form, set } = useBusinessForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!email.trim() || !password) {
      setErr("Email and password are required");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ user: any; access_token: string }>("/seller/register", {
        method: "POST",
        auth: false,
        body: {
          email: email.trim(),
          password,
          business: { ...form, cin: form.cin.trim() || null },
        },
      });
      await setToken(res.access_token);
      await refresh();
      router.replace("/seller/dashboard");
    } catch (e: any) {
      setErr(e?.message || "Could not create seller account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable testID="seller-signup-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Seller signup</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.section}>ACCOUNT</Text>
          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="seller-signup-email"
              value={email}
              onChangeText={setEmail}
              placeholder="business@yourcompany.in"
              placeholderTextColor={colors.textFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="seller-signup-password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.textFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>

          <BusinessFields form={form} set={set} prefix="seller-signup" />

          {err ? <Text style={styles.error} testID="seller-signup-error">{err}</Text> : null}

          <Pressable
            testID="seller-signup-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Create seller account</Text>}
          </Pressable>

          <Text style={styles.terms}>
            By continuing, you confirm your business is registered in India and you are authorized to list its
            products on Allsale.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  section: { fontSize: 11, fontWeight: "800", color: colors.primary, letterSpacing: 1.5, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
  },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  terms: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: spacing.md, lineHeight: 18 },
});
