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
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function SellerUpgrade() {
  const router = useRouter();
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const { form, set, setType } = useBusinessForm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      // Sanitize: uppercase, strip non-alphanum. Invalid codes are silently
      // ignored by the backend so we don't need to validate client-side.
      const code = referralCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      await api("/seller/upgrade", {
        method: "POST",
        body: {
          business: {
            ...form,
            gstin: form.gstin.trim() || null,
            cin: form.cin.trim() || null,
            llpin: form.llpin.trim() || null,
          },
          referral_code: code || undefined,
        },
      });
      await refresh();
      router.replace("/seller/dashboard");
    } catch (e: any) {
      setErr(e?.message || t("seller_upgrade.error_default"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable testID="seller-upgrade-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("seller_upgrade.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>
            {t("seller_upgrade.intro")}
          </Text>

          <BusinessFields form={form} set={set} setType={setType} prefix="seller-upgrade" />

          {/* Ambassador referral CTA — Indian sellers referred by an Allsale
              Ambassador get 3 months free Pro. Code is optional + silently
              ignored if invalid; sanitized to A-Z0-9 only. */}
          <View style={styles.referralCard} testID="seller-upgrade-referral-card">
            <View style={styles.referralHeader}>
              <Sparkles size={16} color={colors.primary} />
              <Text style={styles.referralTitle}>{t("seller_upgrade.referral_title")}</Text>
            </View>
            <Text style={styles.referralSub}>
              {t("seller_upgrade.referral_sub_a")}
              <Text style={styles.referralHighlight}>{t("seller_upgrade.referral_sub_highlight")}</Text>
              {t("seller_upgrade.referral_sub_b")}
            </Text>
            <TextInput
              testID="seller-upgrade-referral-code"
              style={styles.referralInput}
              value={referralCode}
              onChangeText={setReferralCode}
              placeholder={t("seller_upgrade.referral_placeholder")}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={40}
            />
            <Text style={styles.referralHint}>
              {t("seller_upgrade.referral_hint")}
            </Text>
          </View>

          {err ? <Text style={styles.error} testID="seller-upgrade-error">{err}</Text> : null}

          <Pressable
            testID="seller-upgrade-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t("seller_upgrade.submit_btn")}</Text>}
          </Pressable>
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
  intro: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
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
  // ---- Referral card ----
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
});
