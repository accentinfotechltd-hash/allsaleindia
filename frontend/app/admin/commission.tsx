import { useRouter } from "expo-router";
import { ChevronLeft, RefreshCw, TrendingUp } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { adminApi, AdminForbidden, AdminUnauthorized } from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type Cat = {
  category: string;
  bps: number;
  orders: number;
  units: number;
  gmv_cents: number;
  commission_cents: number;
};

type Resp = {
  period_days: number;
  total_orders: number;
  total_gmv_cents: number;
  total_commission_cents: number;
  effective_take_rate_bps: number;
  categories: Cat[];
  tier_map: Record<string, number>;
};

const PERIODS: { label: string; key: string }[] = [
  { label: "7 days", key: "7d" },
  { label: "30 days", key: "30d" },
  { label: "90 days", key: "90d" },
  { label: "1 year", key: "365d" },
  { label: "All time", key: "all" },
];

const fmtNZD = (cents: number) =>
  new Intl.NumberFormat("en-NZ", {
    style: "currency", currency: "NZD", maximumFractionDigits: 0,
  }).format(cents / 100);

const fmtPct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default function AdminCommission() {
  const router = useRouter();
  const { show } = useToast();
  const [period, setPeriod] = useState("30d");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminApi<Resp>(`/admin/commission/analytics?period=${period}`);
      setData(d);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) { router.replace("/admin"); return; }
      if (e instanceof AdminForbidden) { router.replace("/admin"); return; }
      show({ title: e?.message || "Failed to load", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [period, router, show]);

  useEffect(() => { load(); }, [load]);

  const maxCommission = Math.max(1, ...((data?.categories || []).map((c) => c.commission_cents)));

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="commission-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Commission Analytics</Text>
          <Text style={styles.headerSub}>{data?.total_orders ?? 0} orders</Text>
        </View>
        <Pressable testID="commission-refresh" onPress={load} style={styles.iconBtn} hitSlop={8}>
          <RefreshCw size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Period chips */}
      <View style={styles.chipRow}>
        {PERIODS.map((p) => (
          <Pressable
            key={p.key}
            testID={`commission-period-${p.key}`}
            onPress={() => setPeriod(p.key)}
            style={[styles.chip, period === p.key && styles.chipActive]}
          >
            <Text style={[styles.chipText, period === p.key && styles.chipTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : data ? (
          <>
            {/* KPI cards */}
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>GMV</Text>
                <Text style={styles.kpiValue}>{fmtNZD(data.total_gmv_cents)}</Text>
              </View>
              <View style={[styles.kpiCard, styles.kpiAccent]}>
                <Text style={styles.kpiLabel}>Commission earned</Text>
                <Text style={[styles.kpiValue, { color: "#16a34a" }]}>
                  {fmtNZD(data.total_commission_cents)}
                </Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Effective take rate</Text>
                <Text style={styles.kpiValue}>{fmtPct(data.effective_take_rate_bps)}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Categories</Text>
                <Text style={styles.kpiValue}>{data.categories.length}</Text>
              </View>
            </View>

            {/* Per-category breakdown */}
            <Text style={styles.sectionTitle}>Revenue by category</Text>
            {data.categories.length === 0 ? (
              <View style={styles.empty}>
                <TrendingUp size={28} color={colors.textFaint} />
                <Text style={styles.emptyText}>No paid orders in this period</Text>
              </View>
            ) : (
              data.categories.map((c) => {
                const pct = Math.round((c.commission_cents / maxCommission) * 100);
                return (
                  <View key={c.category} style={styles.catCard}>
                    <View style={styles.catHeader}>
                      <Text style={styles.catName}>{c.category}</Text>
                      <View style={styles.catTier}>
                        <Text style={styles.catTierText}>{fmtPct(c.bps)}</Text>
                      </View>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%` }]} />
                    </View>
                    <View style={styles.catMeta}>
                      <Text style={styles.catMetaText}>
                        {c.orders} orders · {c.units} units · GMV {fmtNZD(c.gmv_cents)}
                      </Text>
                      <Text style={styles.catCommission}>{fmtNZD(c.commission_cents)}</Text>
                    </View>
                  </View>
                );
              })
            )}

            {/* Tier reference */}
            <Text style={styles.sectionTitle}>Active commission tiers</Text>
            <View style={styles.tierCard}>
              {Object.entries(data.tier_map).map(([k, v]) => (
                <View key={k} style={styles.tierRow}>
                  <Text style={styles.tierKey}>{k}</Text>
                  <Text style={styles.tierVal}>{fmtPct(v)}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.footnote}>
              Rates are calculated by re-applying the live tier map to every paid order in the window.
              Edit `services/stripe_connect_svc.py` to tune category rates.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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
  headerTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  headerSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  chipRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    padding: spacing.md, backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.text },
  chipTextActive: { color: "#fff" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { padding: 48, alignItems: "center" },
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  kpiCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: 4,
  },
  kpiAccent: { borderColor: "#bbf7d0", backgroundColor: "#f0fdf4" },
  kpiLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  kpiValue: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sectionTitle: {
    fontSize: 13, fontWeight: "800", color: colors.text,
    textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: 8,
  },
  empty: { padding: 32, alignItems: "center", gap: 6 },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  catCard: {
    backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8, gap: 6,
  },
  catHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  catName: { fontSize: 14, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
  catTier: { backgroundColor: "#f0fdf4", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  catTierText: { fontSize: 11, fontWeight: "800", color: "#16a34a" },
  barTrack: { height: 6, backgroundColor: colors.surface, borderRadius: 3, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 3 },
  catMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  catMetaText: { fontSize: 11, color: colors.textMuted, flex: 1 },
  catCommission: { fontSize: 13, fontWeight: "800", color: "#16a34a" },
  tierCard: {
    backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  tierRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tierKey: { fontSize: 12, color: colors.text, textTransform: "capitalize" },
  tierVal: { fontSize: 12, fontWeight: "800", color: colors.primary },
  footnote: { fontSize: 11, color: colors.textFaint, marginTop: spacing.md, lineHeight: 16 },
});
