import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AlertTriangle, Globe, RefreshCcw, Repeat, Users } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Insights = {
  window_days: number;
  returns: {
    total_returns: number;
    total_paid_orders: number;
    returns_rate_pct: number;
    refund_total_nzd: number;
    by_reason: { reason: string; count: number }[];
  };
  by_region: {
    country: string;
    flag: string;
    orders: number;
    units: number;
    revenue_nzd: number;
    share_pct: number;
  }[];
  customers: {
    total_unique: number;
    repeat_buyers: number;
    repeat_rate_pct: number;
    by_country: { country: string; flag: string; count: number; share_pct: number }[];
    aov_nzd: number;
  };
};

const HEALTHY_RETURNS_THRESHOLD = 5; // < 5% is great, > 10% is concerning

export default function InsightsSection({
  days = 30,
}: {
  days?: 7 | 30 | 90;
}) {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<7 | 30 | 90>(days);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<Insights>(`/seller/analytics/insights?days=${period}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  const empty =
    data.returns.total_paid_orders === 0 && data.by_region.length === 0;

  return (
    <View style={styles.wrap} testID="insights-section">
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Insights</Text>
        <View style={styles.rangeRow}>
          {[7, 30, 90].map((d) => {
            const active = period === d;
            return (
              <Pressable
                key={d}
                testID={`insights-range-${d}`}
                onPress={() => setPeriod(d as 7 | 30 | 90)}
                style={[styles.rangePill, active && styles.rangePillActive]}
              >
                <Text
                  style={[styles.rangeText, active && styles.rangeTextActive]}
                >
                  {d}d
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {empty ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No paid orders in the last {period} days yet. Once orders flow in, insights will populate here.
          </Text>
        </View>
      ) : (
        <>
          {/* Returns rate */}
          <View style={styles.card} testID="insights-returns">
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}>
                <RefreshCcw size={16} color={colors.primary} />
              </View>
              <Text style={styles.cardTitle}>Returns rate</Text>
              <View
                style={[
                  styles.healthChip,
                  data.returns.returns_rate_pct <= HEALTHY_RETURNS_THRESHOLD
                    ? styles.healthGood
                    : data.returns.returns_rate_pct <= 10
                      ? styles.healthOk
                      : styles.healthBad,
                ]}
              >
                <Text
                  style={[
                    styles.healthText,
                    data.returns.returns_rate_pct <= HEALTHY_RETURNS_THRESHOLD
                      ? { color: colors.success }
                      : data.returns.returns_rate_pct <= 10
                        ? { color: "#A16207" }
                        : { color: colors.error },
                  ]}
                >
                  {data.returns.returns_rate_pct <= HEALTHY_RETURNS_THRESHOLD
                    ? "Healthy"
                    : data.returns.returns_rate_pct <= 10
                      ? "Watch"
                      : "Concerning"}
                </Text>
              </View>
            </View>
            <View style={styles.statRow}>
              <Stat
                label="Rate"
                value={`${data.returns.returns_rate_pct.toFixed(1)}%`}
                emphasis
              />
              <Stat
                label="Returns"
                value={data.returns.total_returns.toString()}
              />
              <Stat
                label="Refunded"
                value={formatNZD(data.returns.refund_total_nzd)}
              />
            </View>
            {data.returns.by_reason.length > 0 ? (
              <View style={styles.reasonRow}>
                {data.returns.by_reason.slice(0, 4).map((r) => (
                  <View key={r.reason} style={styles.reasonChip}>
                    <AlertTriangle size={10} color={colors.textMuted} />
                    <Text style={styles.reasonText}>
                      {r.reason.replace(/_/g, " ")} · {r.count}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* Revenue by region */}
          {data.by_region.length > 0 ? (
            <View style={styles.card} testID="insights-by-region">
              <View style={styles.cardHead}>
                <View style={styles.cardIcon}>
                  <Globe size={16} color={colors.primary} />
                </View>
                <Text style={styles.cardTitle}>Revenue by region</Text>
              </View>
              {data.by_region.map((r) => (
                <View key={r.country} style={styles.regionRow} testID={`region-${r.country}`}>
                  <Text style={styles.regionFlag}>{r.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.regionTitleRow}>
                      <Text style={styles.regionCode}>{r.country}</Text>
                      <Text style={styles.regionAmount}>
                        {formatNZD(r.revenue_nzd)}
                      </Text>
                    </View>
                    <View style={styles.regionBar}>
                      <View
                        style={[
                          styles.regionFill,
                          { width: `${Math.max(2, r.share_pct)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.regionMeta}>
                      {r.orders} order{r.orders === 1 ? "" : "s"} · {r.units} unit
                      {r.units === 1 ? "" : "s"} · {r.share_pct.toFixed(0)}%
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Customer demographics */}
          <View style={styles.card} testID="insights-customers">
            <View style={styles.cardHead}>
              <View style={styles.cardIcon}>
                <Users size={16} color={colors.primary} />
              </View>
              <Text style={styles.cardTitle}>Customers</Text>
            </View>
            <View style={styles.statRow}>
              <Stat
                label="Unique"
                value={data.customers.total_unique.toString()}
                emphasis
              />
              <Stat
                label="Repeat"
                value={`${data.customers.repeat_rate_pct.toFixed(0)}%`}
              />
              <Stat
                label="Avg order"
                value={formatNZD(data.customers.aov_nzd)}
              />
            </View>
            {data.customers.repeat_buyers > 0 ? (
              <View style={styles.repeatPill}>
                <Repeat size={11} color={colors.success} />
                <Text style={styles.repeatText}>
                  {data.customers.repeat_buyers} repeat buyer
                  {data.customers.repeat_buyers === 1 ? "" : "s"} · keep them coming back 🎉
                </Text>
              </View>
            ) : null}
            {data.customers.by_country.length > 0 ? (
              <View style={styles.demoGrid}>
                {data.customers.by_country.slice(0, 6).map((c) => (
                  <View key={c.country} style={styles.demoChip} testID={`demo-${c.country}`}>
                    <Text style={styles.demoFlag}>{c.flag}</Text>
                    <View>
                      <Text style={styles.demoCode}>{c.country}</Text>
                      <Text style={styles.demoMeta}>
                        {c.count} ({c.share_pct.toFixed(0)}%)
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, emphasis && styles.statValueEmphasis]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.md },
  loading: { padding: spacing.lg, alignItems: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heading: { fontSize: 16, fontWeight: "800", color: colors.text },
  rangeRow: { flexDirection: "row", gap: 4 },
  rangePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
  },
  rangePillActive: { backgroundColor: colors.primary },
  rangeText: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  rangeTextActive: { color: "#fff" },
  emptyCard: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: spacing.sm,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIcon: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontWeight: "800", color: colors.text, flex: 1, fontSize: 14 },
  healthChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  healthGood: { backgroundColor: "#ECFDF5" },
  healthOk: { backgroundColor: "#FEF3C7" },
  healthBad: { backgroundColor: "#FEE2E2" },
  healthText: { fontSize: 11, fontWeight: "800" },
  statRow: { flexDirection: "row", gap: spacing.md },
  stat: { flex: 1 },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    marginTop: 2,
    letterSpacing: -0.4,
  },
  statValueEmphasis: { color: colors.primary },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  reasonChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  reasonText: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  regionRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 6,
  },
  regionFlag: { fontSize: 22, width: 28, textAlign: "center" },
  regionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  regionCode: { fontWeight: "800", color: colors.text },
  regionAmount: { fontWeight: "800", color: colors.text, fontSize: 13 },
  regionBar: {
    height: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 4,
  },
  regionFill: { height: "100%", backgroundColor: colors.primary },
  regionMeta: {
    marginTop: 4,
    color: colors.textMuted,
    fontSize: 11,
  },
  repeatPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  repeatText: { color: colors.success, fontWeight: "700", fontSize: 11 },
  demoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  demoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  demoFlag: { fontSize: 16 },
  demoCode: { fontWeight: "800", color: colors.text, fontSize: 12 },
  demoMeta: { color: colors.textMuted, fontSize: 10 },
});
