/**
 * Low-stock & stockout alerts for the seller analytics dashboard.
 *
 * Pulls `/seller/analytics/low-stock` and renders an urgency-ranked list:
 *   • Out of stock   → red banner, "Lost sales now"
 *   • Critical (≤3d) → orange chip
 *   • Low (≤7d)      → yellow chip
 *
 * Tapping a row deep-links to the listing's edit screen so the seller can
 * bump `stock_count`. Hidden entirely when no alerts exist (clean UX).
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  AlertTriangle,
  PackageX,
  TrendingDown,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Urgency = "out" | "critical" | "low";

type Alert = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  stock_count: number;
  in_stock: boolean;
  sold_window: number;
  window_days: number;
  daily_velocity: number;
  days_of_cover: number | null;
  urgency: Urgency;
  recommended_restock: number;
};

type LowStockResponse = {
  window_days: number;
  threshold: number;
  alerts: Alert[];
  summary: {
    total_alerts: number;
    out_of_stock: number;
    critical: number;
    low: number;
    est_lost_revenue_window_nzd: number;
  };
};

const URGENCY_STYLES: Record<
  Urgency,
  { bg: string; fg: string; border: string; label: string }
> = {
  out: {
    bg: "#FEE2E2",
    fg: "#B91C1C",
    border: "#FCA5A5",
    label: "Out of stock",
  },
  critical: {
    bg: "#FFEDD5",
    fg: "#C2410C",
    border: "#FDBA74",
    label: "Critical",
  },
  low: {
    bg: "#FEF3C7",
    fg: "#A16207",
    border: "#FCD34D",
    label: "Low",
  },
};

export default function LowStockAlerts() {
  const router = useRouter();
  const [data, setData] = useState<LowStockResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<LowStockResponse>(
        "/seller/analytics/low-stock?threshold=10&window_days=30"
      );
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!data || data.alerts.length === 0) {
    return null;
  }

  const { summary, alerts } = data;

  return (
    <View style={styles.wrap} testID="low-stock-section">
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <AlertCircle size={16} color={colors.error} />
          <Text style={styles.heading}>Stock alerts</Text>
        </View>
        <View style={styles.countPill} testID="low-stock-count">
          <Text style={styles.countText}>{summary.total_alerts}</Text>
        </View>
      </View>

      {/* Summary banner */}
      <View style={styles.banner}>
        <View style={styles.bannerStats}>
          {summary.out_of_stock > 0 ? (
            <View style={styles.bannerStat}>
              <Text style={[styles.bannerStatValue, { color: "#B91C1C" }]}>
                {summary.out_of_stock}
              </Text>
              <Text style={styles.bannerStatLabel}>out</Text>
            </View>
          ) : null}
          {summary.critical > 0 ? (
            <View style={styles.bannerStat}>
              <Text style={[styles.bannerStatValue, { color: "#C2410C" }]}>
                {summary.critical}
              </Text>
              <Text style={styles.bannerStatLabel}>critical</Text>
            </View>
          ) : null}
          {summary.low > 0 ? (
            <View style={styles.bannerStat}>
              <Text style={[styles.bannerStatValue, { color: "#A16207" }]}>
                {summary.low}
              </Text>
              <Text style={styles.bannerStatLabel}>low</Text>
            </View>
          ) : null}
        </View>
        {summary.est_lost_revenue_window_nzd > 0 ? (
          <View style={styles.lossPill}>
            <TrendingDown size={11} color={colors.error} />
            <Text style={styles.lossText}>
              Est. lost sales ·{" "}
              <Text style={{ fontWeight: "800" }}>
                {formatNZD(summary.est_lost_revenue_window_nzd)}
              </Text>
            </Text>
          </View>
        ) : null}
      </View>

      {/* Rows */}
      {alerts.map((a) => (
        <Pressable
          key={a.product_id}
          testID={`low-stock-row-${a.product_id}`}
          onPress={() => router.push(`/seller/edit-listing/${a.product_id}`)}
          style={styles.row}
        >
          <Image source={{ uri: a.image }} style={styles.thumb} />
          {a.urgency === "out" ? (
            <View style={styles.outBadge}>
              <PackageX size={14} color="#fff" />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowName} numberOfLines={1}>
                {a.name}
              </Text>
              <UrgencyChip urgency={a.urgency} />
            </View>
            <Text style={styles.rowMeta}>
              {a.stock_count} unit{a.stock_count === 1 ? "" : "s"} ·{" "}
              {a.days_of_cover !== null
                ? `${a.days_of_cover}d cover`
                : "no recent sales"}
              {a.daily_velocity > 0
                ? ` · ${a.daily_velocity}/day`
                : ""}
            </Text>
            <View style={styles.ctaRow}>
              <View style={styles.restockPill}>
                <Text style={styles.restockText}>
                  Restock ≥ {a.recommended_restock}
                </Text>
              </View>
              <Text style={styles.tapHint}>Tap to edit →</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function UrgencyChip({ urgency }: { urgency: Urgency }) {
  const cfg = URGENCY_STYLES[urgency];
  const Icon =
    urgency === "out" ? PackageX : urgency === "critical" ? AlertCircle : AlertTriangle;
  return (
    <View
      style={[
        styles.urgencyChip,
        { backgroundColor: cfg.bg, borderColor: cfg.border },
      ]}
      testID={`urgency-${urgency}`}
    >
      <Icon size={10} color={cfg.fg} />
      <Text style={[styles.urgencyText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.sm },
  loading: { padding: spacing.md, alignItems: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: { fontSize: 16, fontWeight: "800", color: colors.text },
  countPill: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  banner: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    gap: 8,
  },
  bannerStats: { flexDirection: "row", gap: spacing.lg },
  bannerStat: { alignItems: "flex-start" },
  bannerStatValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  bannerStatLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  lossPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  lossText: { fontSize: 11, color: colors.error, fontWeight: "600" },
  row: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  outBadge: {
    position: "absolute",
    top: spacing.md - 4,
    left: spacing.md - 4,
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "space-between",
  },
  rowName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: "700",
  },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  restockPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  restockText: { color: colors.primary, fontWeight: "700", fontSize: 11 },
  tapHint: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  urgencyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  urgencyText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
});
