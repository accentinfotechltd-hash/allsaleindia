import { useRouter } from "expo-router";
import { AlertTriangle, CheckCircle2, ChevronLeft, Search, ShieldCheck } from "lucide-react-native";
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

import { useTranslation } from "@/src/i18n";
import { checkProhibited, NZ_FAQS, ProhibitedResult } from "@/src/lib/nz";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function ProhibitedChecker() {
  const router = useRouter();
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ProhibitedResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setResult(await checkProhibited(text));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable testID="prohibited-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("buyer_prohibited.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.heroTitle}>{t("buyer_prohibited.hero_title")}</Text>
          <Text style={styles.heroSub}>{t("buyer_prohibited.hero_sub")}</Text>

          <View style={styles.inputRow}>
            <Search size={18} color={colors.textMuted} />
            <TextInput
              testID="prohibited-input"
              value={text}
              onChangeText={setText}
              placeholder={t("buyer_prohibited.placeholder")}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCorrect={false}
            />
          </View>

          <Pressable
            testID="prohibited-check-btn"
            disabled={busy || !text.trim()}
            onPress={run}
            style={({ pressed }) => [
              styles.cta,
              pressed && { transform: [{ scale: 0.98 }] },
              (busy || !text.trim()) && { opacity: 0.5 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t("buyer_prohibited.check_btn")}</Text>}
          </Pressable>

          {result ? (
            result.allowed ? (
              <View style={[styles.resultCard, { backgroundColor: colors.successSoft }]} testID="prohibited-result-allowed">
                <CheckCircle2 size={22} color={colors.success} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.resultTitle, { color: colors.success }]}>{t("buyer_prohibited.allowed")}</Text>
                  <Text style={styles.resultBody}>{result.advice}</Text>
                </View>
              </View>
            ) : (
              <View style={[styles.resultCard, { backgroundColor: "#FEE2E2" }]} testID="prohibited-result-banned">
                <AlertTriangle size={22} color={colors.error} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.resultTitle, { color: colors.error }]}>{t("buyer_prohibited.banned")}</Text>
                  <Text style={styles.resultBody}>{result.reason}</Text>
                  <Text style={[styles.resultBody, { marginTop: 4 }]}>{result.advice}</Text>
                  {result.matched_term ? (
                    <Text style={styles.resultMatched}>{t("buyer_prohibited.matched_prefix", { term: result.matched_term })}</Text>
                  ) : null}
                </View>
              </View>
            )
          ) : null}

          <View style={styles.commonBanned}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <ShieldCheck size={14} color={colors.text} />
              <Text style={styles.commonTitle}>{t("buyer_prohibited.common_title")}</Text>
            </View>
            <Text style={styles.commonBody}>{t("buyer_prohibited.common_body")}</Text>
          </View>

          <Text style={styles.faqTitle}>{t("buyer_prohibited.faq_title")}</Text>
          {NZ_FAQS.map((f, i) => (
            <View key={i} style={styles.faqRow}>
              <Text style={styles.faqQ}>{f.q}</Text>
              <Text style={styles.faqA}>{f.a}</Text>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heroTitle: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.6, lineHeight: 32 },
  heroSub: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 20 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.lg, paddingHorizontal: spacing.md, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  input: { flex: 1, fontSize: 14, color: colors.text },
  cta: { backgroundColor: colors.primary, height: 52, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  resultCard: { flexDirection: "row", gap: 12, padding: spacing.md, borderRadius: radius.lg, marginTop: spacing.lg, alignItems: "flex-start" },
  resultTitle: { fontSize: 15, fontWeight: "800" },
  resultBody: { color: colors.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
  resultMatched: { color: colors.textMuted, fontSize: 11, marginTop: 6 },
  commonBanned: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.xl, gap: 8 },
  commonTitle: { fontSize: 11, fontWeight: "800", color: colors.text, letterSpacing: 1.5 },
  commonBody: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  faqTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm, letterSpacing: -0.3 },
  faqRow: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8, backgroundColor: "#fff" },
  faqQ: { fontSize: 13, fontWeight: "700", color: colors.text },
  faqA: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 18 },
});
