import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, Sparkles, TrendingUp, Users, Video } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getMe, getProgramConfig, ProgramConfig } from "@/src/lib/ambassadors";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function AmbassadorsLanding() {
  const router = useRouter();
  const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await getProgramConfig();
      setConfig(cfg);
      try {
        await getMe();
        setEnrolled(true);
      } catch {
        setEnrolled(false);
      }
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-check enrolment whenever the user returns to this screen.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Auto-bounce enrolled users to dashboard.
  useEffect(() => {
    if (enrolled === true) router.replace("/ambassadors/dashboard");
  }, [enrolled, router]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!config) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.center}>
          <Text style={{ color: colors.textMuted }}>
            Programme details unavailable. Please try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Ambassador Programme</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Sparkles size={28} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Earn while you share</Text>
          <Text style={styles.heroSub}>
            Become an Allsale Ambassador. Share your code, earn commission
            on every order — up to {config.b2c.tiers[config.b2c.tiers.length - 1]?.rate_pct}% per sale.
          </Text>
        </View>

        {/* B2C Tier ladder */}
        <Text style={styles.sectionTitle}>How you earn (NZ · AU · US · UK · CA)</Text>
        <View style={styles.tierLadder}>
          {config.b2c.tiers.map((t, i) => (
            <View key={t.key} style={[styles.tierRow, i === 0 && styles.tierRowFirst]}>
              <View style={styles.tierLeft}>
                <Text style={styles.tierLabel}>{t.label}</Text>
                <Text style={styles.tierThreshold}>
                  {t.min_orders_30d === 0
                    ? "From day one"
                    : `${t.min_orders_30d}+ orders / 30 days`}
                </Text>
              </View>
              <Text style={styles.tierPct}>{t.rate_pct}%</Text>
            </View>
          ))}
          <Text style={styles.tierFootnote}>
            Your customers get {config.b2c.customer_discount_pct}% off when they use your code.
          </Text>
        </View>

        {/* India B2B */}
        <View style={styles.indiaCard}>
          <Text style={styles.indiaPill}>🇮🇳  India</Text>
          <Text style={styles.indiaTitle}>Refer sellers — earn big</Text>
          <Text style={styles.indiaSub}>
            ₹{config.b2b.bounty_inr.toLocaleString("en-IN")} bounty per new seller (after {config.b2b.bounty_trigger_orders} shipped orders)
            plus {config.b2b.hot_phase_rate_pct}% of platform fees for {config.b2b.hot_phase_months} months
            (cap ₹{config.b2b.hot_phase_cap_inr.toLocaleString("en-IN")}) and {config.b2b.tail_rate_pct}% lifetime tail.
          </Text>
          <Text style={styles.indiaSub}>
            Indian Ambassadors also get a customer code — drive both diaspora sales abroad AND seller signups in India.
          </Text>
        </View>

        {/* Why join */}
        <Text style={styles.sectionTitle}>Why join</Text>
        <View style={styles.featureGrid}>
          <View style={styles.featureCard}>
            <TrendingUp size={20} color={colors.primary} />
            <Text style={styles.featureTitle}>Auto-tier up</Text>
            <Text style={styles.featureSub}>Hit {config.b2c.tiers[1]?.min_orders_30d}+ orders / 30 days → unlock {config.b2c.tiers[1]?.rate_pct}%</Text>
          </View>
          <View style={styles.featureCard}>
            <Video size={20} color={colors.primary} />
            <Text style={styles.featureTitle}>Post {config.content_requirement.posts_per_month}/mo</Text>
            <Text style={styles.featureSub}>Tag {config.content_requirement.required_tag} on any platform</Text>
          </View>
          <View style={styles.featureCard}>
            <Users size={20} color={colors.primary} />
            <Text style={styles.featureTitle}>{config.b2c.attribution_days}-day cookie</Text>
            <Text style={styles.featureSub}>Your customers stay attributed for 90 days</Text>
          </View>
        </View>

        <Pressable
          testID="amb-cta-join"
          style={styles.joinBtn}
          onPress={() => router.push("/ambassadors/join")}
        >
          <Text style={styles.joinBtnText}>Apply to join</Text>
        </Pressable>
        <Text style={styles.joinFootnote}>
          Free to join · No minimums · Withdrawals from {"\n"}
          {Object.entries(config.withdrawal_minimums)
            .slice(0, 3)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "800",
    color: colors.text,
    fontSize: 16,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  scroll: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: 8,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  heroSub: { color: "rgba(255,255,255,0.9)", textAlign: "center", fontSize: 13, lineHeight: 19 },
  sectionTitle: { fontWeight: "800", color: colors.text, fontSize: 15, marginTop: spacing.sm },
  tierLadder: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tierRowFirst: { borderTopWidth: 0 },
  tierLeft: { flex: 1 },
  tierLabel: { fontWeight: "800", color: colors.text, fontSize: 14 },
  tierThreshold: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tierPct: { fontWeight: "800", fontSize: 22, color: colors.primary },
  tierFootnote: {
    padding: spacing.md,
    color: colors.textMuted,
    fontSize: 12,
    backgroundColor: colors.surfaceMuted,
    textAlign: "center",
  },
  indiaCard: {
    backgroundColor: "#FFF7ED",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  indiaPill: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: "800",
    fontSize: 11,
  },
  indiaTitle: { fontWeight: "800", color: colors.text, fontSize: 17, marginTop: 4 },
  indiaSub: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  featureGrid: { flexDirection: "row", gap: spacing.sm },
  featureCard: {
    flex: 1,
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  featureTitle: { fontWeight: "800", color: colors.text, fontSize: 13 },
  featureSub: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  joinBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
    marginTop: spacing.md,
  },
  joinBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  joinFootnote: { color: colors.textFaint, textAlign: "center", fontSize: 11, lineHeight: 16 },
});
