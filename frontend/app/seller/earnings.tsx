import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowDownToLine,
  BarChart3,
  Calendar,
  ChevronLeft,
  Coins,
  HandCoins,
  Info,
  PiggyBank,
  TrendingUp,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Period = "7d" | "30d" | "90d" | "365d";

type Summary = {
  period: string;
  period_days: number;
  total_orders: number;
  total_units: number;
  gross_nzd: number;
  commission_paid_nzd: number;
  net_earnings_nzd: number;
  effective_take_rate_bps: number;
  effective_take_rate_pct: number;
  avg_order_value_nzd: number;
  tier_map: Record<string, number>;
};

type CategoryRow = {
  category: string;
  bps: number;
  pct: number;
  orders: number;
  units: number;
  gross_nzd: number;
  commission_paid_nzd: number;
  net_earnings_nzd: number;
  share_of_total_pct: number;
};

type CategoryResponse = {
  period: string;
  total_gross_nzd: number;
  total_commission_paid_nzd: number;
  total_net_earnings_nzd: number;
  categories: CategoryRow[];
};

type TimelineBucket = {
  date: string;
  orders: number;
  units: number;
  gross_nzd: number;
  commission_paid_nzd: number;
  net_earnings_nzd: number;
};

type Timeline = {
  days: number;
  buckets: TimelineBucket[];
  peak_day: TimelineBucket | null;
  avg_daily_net_nzd: number;
};

const PERIODS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "1 year" },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function SellerEarningsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>("30d");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<CategoryResponse | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (p: Period = period) => {
    try {
      const days =
        p === "7d" ? 7 : p === "30d" ? 30 : p === "90d" ? 90 : 365;
      const [s, c, t] = await Promise.all([
        api<Summary>(`/seller/earnings/summary?period=${p}`),
        api<CategoryResponse>(`/seller/earnings/by-category?period=${p}`),
        api<Timeline>(`/seller/earnings/timeline?days=${days}`),
      ]);
      setSummary(s);
      setCategories(c);
      setTimeline(t);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      load(period);
    }, [load, period]),
  );

  const onChangePeriod = useCallback((p: Period) => {
    setPeriod(p);
    setLoading(true);
    load(p);
  }, [load]);

  if (loading || !summary || !categories || !timeline) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

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
              load(period);
            }}
            tintColor={colors.primary}
          />
        }
      >
        {/* Period selector */}
        <View style={styles.periodRow}>
          {PERIODS.map((p) => {
            const active = p.value === period;
            return (
              <Pressable
                key={p.value}
                testID={`earnings-period-${p.value}`}
                onPress={() => onChangePeriod(p.value)}
                style={({ pressed }) => [
                  styles.periodChip,
                  active && styles.periodChipActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.periodChipText,
                    active && styles.periodChipTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Hero card: net earnings */}
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <PiggyBank size={14} color="#fff" />
            <Text style={styles.heroBadgeText}>NET EARNINGS</Text>
          </View>
          <Text style={styles.heroAmount}>{formatNZD(summary.net_earnings_nzd)}</Text>
          <Text style={styles.heroCaption}>
            {summary.total_orders} orders · {summary.total_units} units sold
          </Text>
          <View style={styles.heroBreakdown}>
            <View style={styles.heroLine}>
              <Text style={styles.heroLineLabel}>Gross sales</Text>
              <Text style={styles.heroLineValue}>{formatNZD(summary.gross_nzd)}</Text>
            </View>
            <View style={styles.heroLine}>
              <Text style={[styles.heroLineLabel, { color: "#fed7aa" }]}>
                Platform fee ({summary.effective_take_rate_pct}%)
              </Text>
              <Text style={[styles.heroLineValue, { color: "#fed7aa" }]}>
                − {formatNZD(summary.commission_paid_nzd)}
              </Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroLine}>
              <Text style={[styles.heroLineLabel, { color: "#fff", fontWeight: "700" }]}>
                Net to you
              </Text>
              <Text style={[styles.heroLineValue, { color: "#fff", fontWeight: "800" }]}>
                {formatNZD(summary.net_earnings_nzd)}
              </Text>
            </View>
          </View>
        </View>

        {/* KPI grid */}
        <View style={styles.kpiGrid}>
          <KpiCard
            icon={<HandCoins size={18} color={colors.primary} />}
            label="Avg order value"
            value={formatNZD(summary.avg_order_value_nzd)}
          />
          <KpiCard
            icon={<TrendingUp size={18} color="#10b981" />}
            label="Daily avg (net)"
            value={formatNZD(timeline.avg_daily_net_nzd)}
          />
          <KpiCard
            icon={<Coins size={18} color="#f59e0b" />}
            label="Take rate"
            value={`${summary.effective_take_rate_pct}%`}
          />
          <KpiCard
            icon={<Calendar size={18} color="#6366f1" />}
            label="Best day"
            value={
              timeline.peak_day
                ? formatNZD(timeline.peak_day.net_earnings_nzd)
                : "—"
            }
            sub={
              timeline.peak_day
                ? new Date(timeline.peak_day.date).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : undefined
            }
          />
        </View>

        {/* Timeline bar chart */}
        <SectionTitle icon={<BarChart3 size={16} color={colors.primary} />} text="Daily net earnings" />
        <View style={styles.chartCard}>
          <TimelineChart buckets={timeline.buckets} />
        </View>

        {/* Category breakdown */}
        <SectionTitle icon={<ArrowDownToLine size={16} color={colors.primary} />} text="By category" />
        {categories.categories.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No sales in this period yet.</Text>
          </View>
        ) : (
          <View style={styles.catCard}>
            {categories.categories.map((c, idx) => (
              <View
                key={c.category}
                style={[
                  styles.catRow,
                  idx === categories.categories.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.catHeader}>
                    <Text style={styles.catName} numberOfLines={1}>
                      {capitalise(c.category)}
                    </Text>
                    <View style={styles.tierTag}>
                      <Text style={styles.tierTagText}>{c.pct}%</Text>
                    </View>
                  </View>
                  <Text style={styles.catMeta}>
                    {c.orders} orders · {c.units} units
                  </Text>
                  <View style={styles.shareTrack}>
                    <View
                      style={[
                        styles.shareFill,
                        { width: `${Math.max(2, c.share_of_total_pct)}%` },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.catRight}>
                  <Text style={styles.catNet}>{formatNZD(c.net_earnings_nzd)}</Text>
                  <Text style={styles.catFee}>
                    fee {formatNZD(c.commission_paid_nzd)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footerCard}>
          <Info size={14} color={colors.textMuted} style={{ marginTop: 2 }} />
          <Text style={styles.footerText}>
            Platform fees are tiered: <Text style={styles.bold}>8%</Text> for
            electronics, <Text style={styles.bold}>12%</Text> for most categories,{" "}
            <Text style={styles.bold}>15%</Text> for jewellery. Net earnings shown
            here represent your share before payout-tier holds & reserves —
            see <Text style={styles.bold}>Payouts</Text> for the actual release
            schedule.
          </Text>
        </View>

        {/* Cross-link to existing payouts screen */}
        <Pressable
          testID="earnings-go-to-payouts"
          onPress={() => router.push("/seller/payouts")}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.ctaText}>View payout schedule →</Text>
        </Pressable>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
      >
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Earnings</Text>
      <View style={{ width: 22 }} />
    </View>
  );
}

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.sectionTitle}>
      {icon}
      <Text style={styles.sectionTitleText}>{text}</Text>
    </View>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.kpiCard}>
      <View style={styles.kpiIcon}>{icon}</View>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function TimelineChart({ buckets }: { buckets: TimelineBucket[] }) {
  // Group very-long timelines down into ~30 bars so each bar stays
  // visible.  The grouping is by index buckets, not real-world weeks,
  // which keeps the math simple.
  const groups = useMemo(() => {
    if (buckets.length <= 30) return buckets;
    const bucketSize = Math.ceil(buckets.length / 30);
    const out: TimelineBucket[] = [];
    for (let i = 0; i < buckets.length; i += bucketSize) {
      const chunk = buckets.slice(i, i + bucketSize);
      const sum = chunk.reduce(
        (acc, b) => {
          acc.orders += b.orders;
          acc.units += b.units;
          acc.gross_nzd += b.gross_nzd;
          acc.commission_paid_nzd += b.commission_paid_nzd;
          acc.net_earnings_nzd += b.net_earnings_nzd;
          return acc;
        },
        {
          date: chunk[0].date,
          orders: 0,
          units: 0,
          gross_nzd: 0,
          commission_paid_nzd: 0,
          net_earnings_nzd: 0,
        },
      );
      out.push(sum);
    }
    return out;
  }, [buckets]);

  const max = Math.max(1, ...groups.map((b) => b.net_earnings_nzd));
  const allZero = groups.every((b) => b.net_earnings_nzd === 0);

  if (allZero) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>No sales in this window yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.chartBody}>
      {groups.map((b, idx) => {
        const h = Math.max(2, Math.round((b.net_earnings_nzd / max) * 90));
        const isPeak = b.net_earnings_nzd === max && max > 0;
        return (
          <View key={`${b.date}-${idx}`} style={styles.barWrap}>
            <View
              style={[
                styles.bar,
                {
                  height: h,
                  backgroundColor: isPeak ? colors.primary : "#c4b5fd",
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function capitalise(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.text },

  // Period selector
  periodRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
  },
  periodChipActive: {
    backgroundColor: colors.primary,
  },
  periodChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
  },
  periodChipTextActive: { color: "#fff" },

  // Hero
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  heroAmount: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroCaption: { color: "#e9d5ff", fontSize: 13, fontWeight: "600" },
  heroBreakdown: { marginTop: spacing.sm, gap: 6 },
  heroLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroLineLabel: { color: "#e9d5ff", fontSize: 13, fontWeight: "500" },
  heroLineValue: { color: "#fff", fontSize: 14, fontWeight: "700" },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginVertical: 4,
  },

  // KPI grid
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  kpiCard: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  kpiIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  kpiLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  kpiValue: { color: colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  kpiSub: { color: colors.textMuted, fontSize: 11, fontWeight: "500" },

  // Section titles
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  sectionTitleText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },

  // Chart
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 130,
  },
  chartBody: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 100,
    gap: 3,
  },
  barWrap: { flex: 1, justifyContent: "flex-end", alignItems: "center", height: "100%" },
  bar: { width: "100%", borderRadius: 3 },
  chartEmpty: { paddingVertical: spacing.lg, alignItems: "center" },
  chartEmptyText: { color: colors.textMuted, fontSize: 13 },

  // Category breakdown
  catCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catRow: {
    flexDirection: "row",
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  catHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  catName: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  tierTag: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tierTagText: { color: colors.textMuted, fontSize: 10, fontWeight: "800" },
  catMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  shareTrack: {
    height: 4,
    backgroundColor: "#f1f5f9",
    borderRadius: 2,
    marginTop: 8,
    overflow: "hidden",
  },
  shareFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 2 },
  catRight: { alignItems: "flex-end", justifyContent: "center", minWidth: 92 },
  catNet: { color: colors.text, fontSize: 15, fontWeight: "800" },
  catFee: { color: "#dc2626", fontSize: 11, fontWeight: "500", marginTop: 2 },

  // Footer + empty
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  footerCard: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#f8fafc",
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerText: { color: colors.textMuted, fontSize: 12, flex: 1, lineHeight: 17 },
  bold: { fontWeight: "800", color: colors.text },

  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
