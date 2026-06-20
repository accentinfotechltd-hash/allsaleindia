import { useRouter } from "expo-router";
import { ChevronLeft, Sparkles } from "lucide-react-native";
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
import { useTranslation } from "@/src/i18n";
import { api, setToken } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function SellerSignup() {
  const router = useRouter();
  const { refresh } = useAuth();
  const { t } = useTranslation();
  const { form, set, setType } = useBusinessForm();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!email.trim() || !password) {
      setErr(t("seller_signup.email_password_required"));
      return;
    }
    setBusy(true);
    try {
      // Sanitize ambassador code: strip non-alphanum, uppercase. Backend
      // silently ignores invalid codes, so no client-side validation needed.
      const code = referralCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const res = await api<{ user: any; access_token: string }>("/seller/register", {
        method: "POST",
        auth: false,
        body: {
          email: email.trim(),
          password,
          business: {
            ...form,
            gstin: form.gstin.trim() || null,
            cin: form.cin.trim() || null,
            llpin: form.llpin.trim() || null,
          },
          referral_code: code || undefined,
        },
      });
      await setToken(res.access_token);
      await refresh();
      router.replace("/seller/dashboard");
    } catch (e: any) {
      setErr(e?.message || t("seller_signup.could_not_create"));
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
        <Text style={styles.title}>{t("seller_signup.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.section}>ACCOUNT</Text>
          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>{t("seller_signup.email_label")}</Text>
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
            <Text style={styles.label}>{t("seller_signup.password_label")}</Text>
            <TextInput
              testID="seller-signup-password"
              value={password}
              onChangeText={setPassword}
              placeholder={t("seller_signup.password_placeholder")}
              placeholderTextColor={colors.textFaint}
              secureTextEntry
              style={styles.input}
            />
          </View>

          <BusinessFields form={form} set={set} setType={setType} prefix="seller-signup" />

          {/* Ambassador referral CTA — Indian sellers referred by an
              Allsale Ambassador get 3 months Pro free. Optional + silently
              ignored by backend if invalid. Sanitized to A-Z0-9. */}
          <View style={styles.referralCard} testID="seller-signup-referral-card">
            <View style={styles.referralHeader}>
              <Sparkles size={16} color={colors.primary} />
              <Text style={styles.referralTitle}>{t("seller_signup.referral_title")}</Text>
            </View>
            <Text style={styles.referralSub}>
              {t("seller_signup.referral_sub_pre")}
              <Text style={styles.referralHighlight}>{t("seller_signup.referral_highlight")}</Text>
              {t("seller_signup.referral_sub_post")}
            </Text>
            <TextInput
              testID="seller-signup-referral-code"
              style={styles.referralInput}
              value={referralCode}
              onChangeText={setReferralCode}
              placeholder={t("seller_signup.referral_placeholder")}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
            />
            <Text style={styles.referralHint}>
              {t("seller_signup.referral_hint")}
            </Text>
          </View>

          {err ? <Text style={styles.error} testID="seller-signup-error">{err}</Text> : null}

          <Pressable
            testID="seller-signup-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t("seller_signup.submit")}</Text>}
          </Pressable>

          <Text style={styles.terms}>
            {t("seller_signup.terms")}
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
  // ---- Referral card (mirrors /seller/upgrade) ----
  referralCard: {
    marginTop: spacing.lg,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 8,
  },
  referralHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  referralTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  referralSub: { color: "#78350F", fontSize: 12, lineHeight: 18 },
  referralHighlight: { color: colors.primary, fontWeight: "800" },
  referralInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  referralHint: { color: "#9A3412", fontSize: 11, fontStyle: "italic" },
  terms: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: spacing.md, lineHeight: 18 },
});
