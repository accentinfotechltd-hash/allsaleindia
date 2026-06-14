import { useFocusEffect, useRouter } from "expo-router";
import {
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Crown,
  HandCoins,
  Info,
  Shield,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type TierData = {
  tier: {
    name: string;
    label: string;
    payout_hold_days: number;
    reserve_pct: number;
    reserve_hold_days: number;
    color: string;
    perks: string[];
  };
  metrics: {
    delivered_orders: number;
    returned_orders: number;
    return_rate: number;
    avg_rating: number;
    review_count: number;
  };
  progress: {
    next_tier: string | null;
    next_tier_label?: string;
    orders_needed: number;
    return_rate_ok: boolean;
    rating_ok: boolean;
    progress_pct: number;
  };
};

type Payout = {
  id: string;
  order_id: string;
  items_count: number;
  gross_nzd: number;
  net_payable_nzd: number;
  reserve_nzd: number;
  tier: string | null;
  status: string;
  release_at: string | null;
  reserve_release_at: string | null;
  created_at: string;
  paid_out_at: string | null;
};

type Summary = {
  payouts: Payout[];
  lifetime_earnings_nzd: number;
  paid_out_nzd: number;
  held_nzd: number;
  available_nzd: number;
  reserve_held_nzd: number;
  next_release_at: string | null;
  tier: string | null;
};

const TIER_ICON: Record<string, any> = {
  starter: Sparkles,
  verified: CheckCircle2,
  trusted: Shield,
  top: Crown,
};

export default function SellerPayoutsScreen() {
  const router = useRouter();
  const [tier, setTier] = useState<TierData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        api<TierData>("/seller/tier"),
        api<Summary>("/seller/payouts"),
      ]);
      setTier(t);
      setSummary(s);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !tier || !summary) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const TierIcon = TIER_ICON[tier.tier.name] || Award;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Header onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* Tier hero */}
        <View style={[styles.tierCard, { borderColor: tier.tier.color }]}>
          <View style={[styles.tierBadge, { backgroundColor: tier.tier.color }]}>
            <TierIcon size={20} color="#fff" />
            <Text style={styles.tierBadgeText}>{tier.tier.label.toUpperCase()}</Text>
          </View>
          <Text style={styles.tierHeadline}>
            Payouts arrive <Text style={{ color: tier.tier.color }}>T+{tier.tier.payout_hold_days}</Text>{" "}
            after delivery
          </Text>
          {tier.tier.reserve_pct > 0 ? (
            <Text style={styles.tierSub}>
              {(tier.tier.reserve_pct * 100).toFixed(0)}% reserve held for {tier.tier.reserve_hold_days} days against returns.
            </Text>
          ) : (
            <Text style={styles.tierSub}>No reserve withheld — you keep 100%.</Text>
          )}

          <View style={styles.perksRow}>
            {tier.tier.perks.map((p) => (
              <View key={p} style={styles.perkChip}>
                <CheckCircle2 size={11} color={tier.tier.color} />
                <Text style={styles.perkText}>{p}</Text>
              </View>
            ))}
          </View>

          {/* Progress to next tier */}
          {tier.progress.next_tier ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressHeader}>
                <TrendingUp size={14} color={colors.primary} />
                <Text style={styles.progressTitle}>
                  Next: <Text style={{ color: colors.primary }}>{tier.progress.next_tier_label}</Text>
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.progressPct}>{tier.progress.progress_pct}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, tier.progress.progress_pct)}%`, backgroundColor: colors.primary },
                  ]}
                />
              </View>
              <View style={styles.progressList}>
                {tier.progress.orders_needed > 0 ? (
                  <ProgressItem ok={false} text={`${tier.progress.orders_needed} more delivered orders`} />
                ) : (
                  <ProgressItem ok text="Order count met" />
                )}
                <ProgressItem
                  ok={tier.progress.return_rate_ok}
                  text={tier.progress.return_rate_ok ? "Return rate is healthy" : "Lower your return rate"}
                />
                <ProgressItem
                  ok={tier.progress.rating_ok}
                  text={tier.progress.rating_ok ? "Rating threshold met" : "Improve your seller rating"}
                />
              </View>
            </View>
          ) : (
            <View style={[styles.progressBlock, { backgroundColor: "#FEF3C7" }]}>
              <Crown size={16} color="#92400E" />
              <Text style={[styles.progressTitle, { color: "#92400E" }]}>
                You&apos;re already at the top tier
              </Text>
            </View>
          )}
        </View>

        {/* Earnings breakdown */}
        <View style={styles.row2}>
          <StatCard
            icon={<Wallet size={16} color={colors.success} />}
            label="Available"
            value={formatNZD(summary.available_nzd)}
            color={colors.success}
            highlight
          />
          <StatCard
            icon={<Clock size={16} color={colors.textMuted} />}
            label="Held"
            value={formatNZD(summary.held_nzd)}
          />
        </View>
        <View style={styles.row2}>
          <StatCard
            icon={<Shield size={16} color="#F59E0B" />}
            label="Reserve"
            value={formatNZD(summary.reserve_held_nzd)}
          />
          <StatCard
            icon={<Coins size={16} color={colors.text} />}
            label="Paid out"
            value={formatNZD(summary.paid_out_nzd)}
          />
        </View>

        {summary.next_release_at ? (
          <View style={styles.nextRelease}>
            <Clock size={14} color={colors.primary} />
            <Text style={styles.nextReleaseText}>
              Next release: {new Date(summary.next_release_at).toLocaleDateString()}
            </Text>
          </View>
        ) : null}

        {/* Cash advance CTA */}
        <Pressable
          testID="financing-cta"
          onPress={() => router.push("/seller/financing")}
          style={({ pressed }) => [styles.financingCta, pressed && { opacity: 0.9 }]}
        >
          <View style={styles.financingIcon}>
            <HandCoins size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.financingTitle}>Need money sooner?</Text>
            <Text style={styles.financingSub}>
              Get 70–90% advance on confirmed orders via NBFC partners.
            </Text>
          </View>
          <ChevronRight size={18} color="#fff" />
        </Pressable>

        {/* Recent payouts list */}
        <Text style={styles.sectionTitle}>Recent payouts</Text>
        {summary.payouts.length === 0 ? (
          <View style={styles.empty}>
            <Wallet size={28} color={colors.textFaint} />
            <Text style={styles.emptyText}>
              No payouts yet — they&apos;ll appear once orders are delivered.
            </Text>
          </View>
        ) : (
          summary.payouts.slice(0, 20).map((p) => (
            <View key={p.id} style={styles.payoutRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.payoutTop}>
                  <Text style={styles.payoutOrder}>
                    Order #{p.order_id.replace("order_", "").slice(0, 8).toUpperCase()}
                  </Text>
                  <PayoutBadge status={p.status} />
                </View>
                <Text style={styles.payoutMeta}>
                  {p.items_count} item{p.items_count > 1 ? "s" : ""} ·{" "}
                  {new Date(p.created_at).toLocaleDateString()}
                  {p.reserve_nzd > 0 ? ` · ${formatNZD(p.reserve_nzd)} reserve` : ""}
                </Text>
                {p.release_at && p.status !== "paid_out" ? (
                  <Text style={styles.payoutEta}>
                    {p.status === "reserve_held" && p.reserve_release_at
                      ? `Reserve releases ${new Date(p.reserve_release_at).toLocaleDateString()}`
                      : `Releases ${new Date(p.release_at).toLocaleDateString()}`}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.payoutAmount}>{formatNZD(p.net_payable_nzd)}</Text>
            </View>
          ))
        )}

        {/* How it works */}
        <View style={styles.infoCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Info size={14} color={colors.primary} />
            <Text style={styles.infoTitle}>How payouts work</Text>
          </View>
          <Text style={styles.infoBody}>
            1. Buyer pays via Stripe → your earnings are recorded as <Text style={{ fontWeight: "800" }}>Held</Text>.{"\n"}
            2. Order is marked delivered by Shiprocket → release timer starts.{"\n"}
            3. After T+{tier.tier.payout_hold_days} days, your money moves to <Text style={{ fontWeight: "800" }}>Available</Text>.{"\n"}
            {tier.tier.reserve_pct > 0
              ? `4. ${(tier.tier.reserve_pct * 100).toFixed(0)}% reserve unlocks after ${tier.tier.reserve_hold_days} more days.\n`
              : ""}
            {tier.tier.reserve_pct > 0 ? "5." : "4."} Admin disburses via Stripe → status becomes <Text style={{ fontWeight: "800" }}>Paid out</Text>.
          </Text>
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function PayoutBadge({ status }: { status: string }) {
  const s = (() => {
    switch (status) {
      case "held":
      case "pending":
        return { bg: "#FEF3C7", fg: "#92400E", label: "Held" };
      case "reserve_held":
        return { bg: "#FFE4D9", fg: "#9A3412", label: "Reserve" };
      case "available":
        return { bg: "#D1FAE5", fg: "#065F46", label: "Available" };
      case "paid_out":
        return { bg: "#DBEAFE", fg: "#1E3A8A", label: "Paid out" };
      case "cancelled":
        return { bg: "#FEE2E2", fg: "#991B1B", label: "Cancelled" };
      default:
        return { bg: colors.surface, fg: colors.text, label: status };
    }
  })();
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function ProgressItem({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.progressItem}>
      <CheckCircle2 size={14} color={ok ? colors.success : colors.textFaint} />
      <Text style={[styles.progressItemText, !ok && { color: colors.textMuted }]}>{text}</Text>
    </View>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
      <View style={styles.statHeader}>
        {icon}
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable testID="payouts-back" onPress={onBack} style={styles.backBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>Payouts & tier</Text>
      <View style={{ width: 40 }} />
    </View>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  tierCard: {
    backgroundColor: "#fff",
    borderRadius: radius.xl,
    borderWidth: 2,
    padding: spacing.lg,
    gap: 10,
  },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  tierBadgeText: { color: "#fff", fontWeight: "900", fontSize: 11, letterSpacing: 0.6 },
  tierHeadline: { fontSize: 20, fontWeight: "800", color: colors.text, marginTop: 4, lineHeight: 26 },
  tierSub: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  perksRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  perkChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  perkText: { fontSize: 11, fontWeight: "700", color: colors.text },
  progressBlock: {
    marginTop: 8,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 6,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: 6, width: "100%" },
  progressTitle: { fontSize: 13.5, fontWeight: "800", color: colors.text },
  progressPct: { fontSize: 13, fontWeight: "800", color: colors.primary },
  progressTrack: {
    width: "100%",
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999 },
  progressList: { gap: 4, marginTop: 4, width: "100%" },
  progressItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressItemText: { fontSize: 12.5, color: colors.text, fontWeight: "600" },
  row2: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  statCardHighlight: { borderColor: colors.success, backgroundColor: "#F0FDF4" },
  statHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  statLabel: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.3 },
  statValue: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  nextRelease: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  nextReleaseText: { fontSize: 12.5, fontWeight: "700", color: colors.primaryDark },
  financingCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDark,
  },
  financingIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  financingTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  financingSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginTop: spacing.md },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.xl },
  payoutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  payoutTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  payoutOrder: { fontSize: 13, fontWeight: "800", color: colors.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.3 },
  payoutMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontWeight: "600" },
  payoutEta: { fontSize: 11.5, color: colors.primary, marginTop: 2, fontWeight: "700" },
  payoutAmount: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  infoCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    gap: 6,
    marginTop: spacing.md,
  },
  infoTitle: { fontSize: 13, fontWeight: "800", color: colors.primaryDark },
  infoBody: { fontSize: 12.5, color: colors.text, lineHeight: 19 },
});
