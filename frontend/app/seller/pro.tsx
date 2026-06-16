import { useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  Crown,
  ExternalLink,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type ProStatus = {
  active: boolean;
  status?: string;
  plan?: string | null;
  current_period_end?: number | null;
  will_cancel?: boolean;
  price_id_configured?: boolean;
};

const BENEFITS = [
  { icon: Zap, color: "#f97316", title: "9% commission (vs 12%)", body: "Save 25% on every sale. Pays for itself at ₹17k monthly GMV." },
  { icon: Star, color: "#facc15", title: "Featured Seller badge", body: "Gold star on every listing — proven to lift conversion 5–15%." },
  { icon: TrendingUp, color: "#22c55e", title: "Boosted search ranking", body: "Pro sellers rank higher in category & search results." },
  { icon: Sparkles, color: "#a855f7", title: "4 free featured listings / month", body: "Worth ₹1,000/mo on its own — give your best SKUs the spotlight." },
  { icon: Users, color: "#0ea5e9", title: "Priority Trust & Safety support", body: "Same-day response. Disputes resolved faster, cash released sooner." },
  { icon: Crown, color: "#ec4899", title: "Advanced analytics dashboard", body: "Conversion by SKU, traffic sources, abandoned-cart insights." },
];

export default function AllsalePro() {
  const router = useRouter();
  const { show } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<ProStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<ProStatus>("/seller/pro/status");
      setStatus(d);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startCheckout = async () => {
    if (!status?.price_id_configured) {
      show({
        title: "Pro is not yet enabled",
        message: "Our team is finalising pricing. Check back soon.",
        kind: "info",
      });
      return;
    }
    setActing(true);
    try {
      const d = await api<{ url: string }>("/seller/pro/checkout", { method: "POST", body: {} });
      if (Platform.OS === "web") (globalThis as unknown as Window).location.href = d.url;
      else await Linking.openURL(d.url);
    } catch (e: any) {
      show({ title: "Couldn't start checkout", message: e?.message, kind: "error" });
    } finally {
      setActing(false);
    }
  };

  const cancelSub = async () => {
    const ok = await confirm({
      title: "Cancel Allsale Pro?",
      message: "Your benefits stay active until the end of the current billing period. After that you'll return to the standard 12% commission.",
      confirmLabel: "Cancel subscription",
      destructive: true,
    });
    if (!ok) return;
    setActing(true);
    try {
      await api("/seller/pro/cancel", { method: "POST", body: {} });
      show({ title: "Cancellation scheduled", message: "Pro stays active until period end.", kind: "success" });
      load();
    } catch (e: any) {
      show({ title: "Couldn't cancel", message: e?.message, kind: "error" });
    } finally {
      setActing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="pro-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Allsale Pro</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.crownChip}>
            <Crown size={20} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Sell more, keep more.</Text>
          <Text style={styles.heroBody}>
            Allsale Pro slashes your commission from 12% to 9% and unlocks the tools serious sellers use to grow.
          </Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>₹500</Text>
            <Text style={styles.priceUnit}>/ month</Text>
          </View>
          <Text style={styles.priceSub}>Cancel anytime. No setup fees.</Text>
        </View>

        {/* Active banner */}
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : status?.active ? (
          <View style={styles.activeBanner}>
            <CheckCircle2 size={20} color="#16a34a" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.activeTitle}>You&apos;re on Allsale Pro</Text>
              <Text style={styles.activeBody}>
                {status.will_cancel
                  ? "Cancelling at the end of your current period."
                  : `Renews ${
                      status.current_period_end
                        ? new Date(status.current_period_end * 1000).toLocaleDateString()
                        : "monthly"
                    }`}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Benefits */}
        <Text style={styles.sectionLabel}>What you get</Text>
        {BENEFITS.map((b, i) => {
          const Icon = b.icon;
          return (
            <View key={i} style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: b.color + "22" }]}>
                <Icon size={18} color={b.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title}</Text>
                <Text style={styles.benefitBody}>{b.body}</Text>
              </View>
            </View>
          );
        })}

        {/* CTA */}
        <View style={styles.ctaWrap}>
          {!status?.active ? (
            <Pressable
              testID="pro-subscribe-btn"
              onPress={startCheckout}
              disabled={acting}
              style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }, acting && { opacity: 0.7 }]}
            >
              {acting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Crown size={18} color="#fff" />
                  <Text style={styles.ctaText}>
                    {status?.price_id_configured === false ? "Coming soon" : "Subscribe to Pro"}
                  </Text>
                </>
              )}
            </Pressable>
          ) : !status.will_cancel ? (
            <Pressable
              testID="pro-cancel-btn"
              onPress={cancelSub}
              disabled={acting}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.cancelBtnText}>Cancel Allsale Pro</Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="pro-refresh-btn"
            onPress={load}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.secondaryBtnText}>Refresh status</Text>
          </Pressable>
        </View>

        {/* Math */}
        <View style={styles.mathCard}>
          <Text style={styles.mathTitle}>📊 Your savings, modelled</Text>
          <Row label="Monthly GMV" value="₹50,000" />
          <Row label="Standard commission (12%)" value="-₹6,000" />
          <Row label="Pro commission (9%)" value="-₹4,500" highlight />
          <Row label="Pro subscription" value="-₹500" />
          <Row label="You save" value="₹1,000 / month" bold />
        </View>

        <Pressable
          testID="pro-fees-explainer"
          onPress={() => Linking.openURL("https://shop.allsale.co.nz/help/seller-policy")}
          style={styles.linkBtn}
        >
          <Text style={styles.linkText}>Read the full Seller Policy</Text>
          <ExternalLink size={12} color={colors.primary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, highlight, bold }: { label: string; value: string; highlight?: boolean; bold?: boolean }) {
  return (
    <View style={styles.mathRow}>
      <Text style={[styles.mathLabel, bold && { color: colors.text, fontWeight: "800" }]}>{label}</Text>
      <Text
        style={[
          styles.mathValue,
          highlight && { color: "#16a34a" },
          bold && { fontWeight: "800", color: "#16a34a", fontSize: 16 },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800", color: colors.text },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hero: {
    backgroundColor: "#1e293b",
    borderRadius: radius.xl, padding: spacing.lg, gap: 6, marginBottom: spacing.lg,
  },
  crownChip: {
    width: 44, height: 44, borderRadius: 999,
    backgroundColor: "#facc15", alignItems: "center", justifyContent: "center",
    marginBottom: 6,
  },
  heroTitle: { fontSize: 26, fontWeight: "800", color: "#fff", letterSpacing: -0.5 },
  heroBody: { fontSize: 14, color: "#cbd5e1", lineHeight: 21, marginBottom: 8 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 },
  price: { fontSize: 32, fontWeight: "900", color: "#facc15" },
  priceUnit: { fontSize: 14, color: "#cbd5e1", fontWeight: "700" },
  priceSub: { fontSize: 12, color: "#94a3b8" },
  activeBanner: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#dcfce7", borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: "#bbf7d0", marginBottom: spacing.lg,
  },
  activeTitle: { fontSize: 14, fontWeight: "800", color: "#166534" },
  activeBody: { fontSize: 12, color: "#166534", marginTop: 2 },
  sectionLabel: {
    fontSize: 13, fontWeight: "800", color: colors.textMuted,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
  },
  benefit: {
    flexDirection: "row", gap: 12,
    backgroundColor: "#fff", borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  benefitIcon: {
    width: 36, height: 36, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
  },
  benefitTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  benefitBody: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  ctaWrap: { gap: 10, marginTop: spacing.lg, marginBottom: spacing.lg },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 56, borderRadius: radius.pill, backgroundColor: "#facc15",
  },
  ctaText: { color: "#78350f", fontSize: 16, fontWeight: "900" },
  cancelBtn: {
    height: 50, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2",
  },
  cancelBtnText: { color: "#b91c1c", fontSize: 14, fontWeight: "800" },
  secondaryBtn: {
    height: 44, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff",
  },
  secondaryBtnText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  mathCard: {
    backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  mathTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 8 },
  mathRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  mathLabel: { fontSize: 13, color: colors.textMuted },
  mathValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  linkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    marginTop: spacing.lg, padding: spacing.md,
  },
  linkText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
});
