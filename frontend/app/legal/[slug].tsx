/**
 * Dynamic legal-page renderer — single source of truth.
 *
 * Fetches `GET /api/policies/{slug}` and renders the structured response.
 * The same backend powers the web frontend at `/legal/[slug]`, so mobile &
 * web stay in lockstep — no more hardcoded policy text drifting between
 * platforms.
 *
 * Supports all 8 policy slugs + the friendly aliases the backend exposes:
 *   terms | privacy | return | payment | cancellation | seller | prohibited | cookies
 *   (plus aliases like seller-agreement, cookie-policy, terms-and-conditions, etc.)
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, ChevronLeft, Mail, RefreshCcw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Section = {
  heading: string;
  paragraph: string | null;
  bullets: string[] | null;
};

type Policy = {
  slug: string;
  title: string;
  effective: string;
  last_updated: string;
  intro?: string | null;
  contact_email: string;
  sections: Section[];
  markdown: string;
};

export default function LegalPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const p = await api<Policy>(`/policies/${slug}`);
      setPolicy(p);
    } catch (e: any) {
      const msg = e?.message || t("legal_page.couldnt_load_default");
      setError(msg.includes("404") ? t("legal_page.not_found", { slug }) : msg);
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="legal-back-btn"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {policy?.title || t("legal_page.loading")}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.errorWrap}>
          <AlertCircle size={32} color={colors.textMuted} />
          <Text style={styles.errorTitle}>{t("legal_page.couldnt_load_title")}</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable
            testID="legal-retry-btn"
            onPress={load}
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }]}
          >
            <RefreshCcw size={14} color="#fff" />
            <Text style={styles.retryText}>{t("legal_page.retry")}</Text>
          </Pressable>
        </View>
      ) : policy ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Effective / updated date */}
          <View style={styles.dateBox}>
            <Text style={styles.dateText}>{t("legal_page.effective_line", { effective: policy.effective, updated: policy.last_updated })}</Text>
          </View>

          {/* Intro paragraph if present */}
          {policy.intro ? (
            <Text style={styles.intro}>{policy.intro}</Text>
          ) : null}

          {/* Sections */}
          {policy.sections.map((sec, idx) => (
            <View key={`${sec.heading}-${idx}`} style={styles.section}>
              <Text style={styles.sectionHeading}>{sec.heading}</Text>
              {sec.paragraph ? (
                <Text style={styles.paragraph}>{sec.paragraph}</Text>
              ) : null}
              {sec.bullets?.length
                ? sec.bullets.map((b, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>•</Text>
                      <Text style={styles.bulletText}>{b}</Text>
                    </View>
                  ))
                : null}
            </View>
          ))}

          {/* Footer with contact email */}
          <Pressable
            testID="legal-contact-btn"
            onPress={() => Linking.openURL(`mailto:${policy.contact_email}`)}
            style={({ pressed }) => [styles.footer, pressed && { opacity: 0.85 }]}
          >
            <Mail size={14} color={colors.primary} />
            <Text style={styles.footerText}>{t("legal_page.questions_prefix")}<Text style={styles.footerEmail}>{policy.contact_email}</Text></Text>
          </Pressable>

          <View style={{ height: 32 }} />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  errorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  errorBody: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
  retry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  retryText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  scroll: { padding: spacing.lg, gap: spacing.md },

  dateBox: {
    alignSelf: "flex-start",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dateText: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },

  intro: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
    backgroundColor: "#fff7ed",
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.sm,
  },

  section: { gap: 8, marginTop: 4 },
  sectionHeading: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
    marginTop: spacing.sm,
    letterSpacing: -0.2,
  },
  paragraph: { fontSize: 14, color: colors.text, lineHeight: 22 },

  bulletRow: { flexDirection: "row", gap: 8, paddingRight: spacing.sm },
  bulletDot: { color: colors.primary, fontSize: 16, lineHeight: 22, fontWeight: "800" },
  bulletText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 22 },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerText: { fontSize: 13, color: colors.textMuted },
  footerEmail: { color: colors.primary, fontWeight: "700" },
});
