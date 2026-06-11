/**
 * Seller analytics dashboard.
 *
 * Shows per-listing performance counters (views, cart adds, sold, revenue,
 * conversion) plus aggregate summary cards and "Top 5" lists.
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  BarChart3,
  ChevronLeft,
  Eye,
  ShoppingCart,
  TrendingUp,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type ListingRow = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  stock_count: number;
  in_stock: boolean;
  views: number;
  cart_adds: number;
  sold: number;
  revenue_nzd: number;
  conversion_pct: number;
};

type Summary = {
  total_listings: number;
  total_views: number;
  total_cart_adds: number;
  total_sold: number;
  total_revenue_nzd: number;
  overall_conversion_pct: number;
};

type Data = {
  listings: ListingRow[];
  summary: Summary;
  top_by_views: ListingRow[];
  top_by_sold: ListingRow[];
};

export default function SellerAnalyticsScreen() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<Data>("/seller/analytics");
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="analytics-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data.listings.slice().sort((a, b) => b.views - a.views)}
          keyExtractor={(r) => r.product_id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
          ListHeaderComponent={
            <View>
              {/* Summary cards */}
              <View style={styles.summaryGrid}>
                <SummaryCard
                  icon={<Eye size={16} color={colors.primary} />}
                  label="Total views"
                  value={data.summary.total_views.toLocaleString()}
                />
                <SummaryCard
                  icon={<ShoppingCart size={16} color={colors.primary} />}
                  label="Add to carts"
                  value={data.summary.total_cart_adds.toLocaleString()}
                />
                <SummaryCard
                  icon={<BarChart3 size={16} color={colors.primary} />}
                  label="Units sold"
                  value={data.summary.total_sold.toLocaleString()}
                />
                <SummaryCard
                  icon={<TrendingUp size={16} color={colors.primary} />}
                  label="Revenue"
                  value={formatNZD(data.summary.total_revenue_nzd)}
                />
              </View>

              <View style={styles.conversionPill}>
                <TrendingUp size={14} color={colors.success} />
                <Text style={styles.conversionText}>
                  Overall conversion · <Text style={{ fontWeight: "800" }}>{data.summary.overall_conversion_pct}%</Text>
                  {"  "}({data.summary.total_sold} sold ÷ {data.summary.total_views} views)
                </Text>
              </View>

              {/* Top 5 by views */}
              {data.top_by_views.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Top 5 by views</Text>
                  {data.top_by_views.map((r, idx) => (
                    <TopRow key={r.product_id} rank={idx + 1} row={r} metric="views" />
                  ))}
                </View>
              ) : null}

              {/* Top 5 by sold */}
              {data.top_by_sold.some((r) => r.sold > 0) ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Top 5 by units sold</Text>
                  {data.top_by_sold
                    .filter((r) => r.sold > 0)
                    .map((r, idx) => (
                      <TopRow key={r.product_id} rank={idx + 1} row={r} metric="sold" />
                    ))}
                </View>
              ) : null}

              <Text style={[styles.sectionTitle, { marginTop: spacing.xl, marginBottom: spacing.sm }]}>
                All listings ({data.listings.length})
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`analytics-row-${item.product_id}`}
              onPress={() => router.push(`/product/${item.product_id}`)}
              style={styles.row}
            >
              <Image source={{ uri: item.image }} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.rowPrice}>{formatNZD(item.price_nzd)} · stock {item.stock_count}</Text>
                <View style={styles.metricsRow}>
                  <Metric label="Views" value={item.views} />
                  <Metric label="Carts" value={item.cart_adds} />
                  <Metric label="Sold" value={item.sold} />
                  <Metric label="Conv" value={`${item.conversion_pct}%`} highlight />
                </View>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No analytics yet. Once shoppers view your listings, stats will appear here.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryIcon}>{icon}</View>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} testID={`metric-${label.toLowerCase()}`}>
        <Text style={highlight ? { color: colors.success } : undefined}>{value}</Text>
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function TopRow({ rank, row, metric }: { rank: number; row: ListingRow; metric: "views" | "sold" }) {
  return (
    <View style={styles.topRow}>
      <Text style={styles.topRank}>#{rank}</Text>
      <Image source={{ uri: row.image }} style={styles.topThumb} />
      <View style={{ flex: 1 }}>
        <Text style={styles.topName} numberOfLines={1}>{row.name}</Text>
        <Text style={styles.topMeta}>
          {metric === "views"
            ? `${row.views.toLocaleString()} views · ${row.conversion_pct}% conversion`
            : `${row.sold} sold · ${formatNZD(row.revenue_nzd)}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  summaryCard: { width: "48%", padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  summaryIcon: { width: 32, height: 32, borderRadius: 999, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  summaryLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700", letterSpacing: 0.5 },
  summaryValue: { fontSize: 20, color: colors.text, fontWeight: "800", marginTop: 4, letterSpacing: -0.3 },
  conversionPill: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.successSoft, marginTop: spacing.md },
  conversionText: { color: colors.success, fontSize: 12, flex: 1 },
  section: { marginTop: spacing.xl },
  sectionTitle: { fontSize: 14, color: colors.text, fontWeight: "800", letterSpacing: -0.2, marginBottom: spacing.sm },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  topRank: { fontSize: 13, color: colors.primary, fontWeight: "800", width: 28 },
  topThumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surface },
  topName: { fontSize: 13, color: colors.text, fontWeight: "600" },
  topMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: "row", gap: 12, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", marginBottom: 8 },
  thumb: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surface },
  rowName: { fontSize: 13, color: colors.text, fontWeight: "600", lineHeight: 17 },
  rowPrice: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  metricsRow: { flexDirection: "row", gap: 14, marginTop: 8 },
  metric: {},
  metricValue: { fontSize: 14, color: colors.text, fontWeight: "800" },
  metricLabel: { fontSize: 10, color: colors.textMuted, marginTop: 1, letterSpacing: 0.5 },
  empty: { paddingVertical: spacing.xxl, alignItems: "center" },
  emptyText: { textAlign: "center", color: colors.textMuted, fontSize: 13, lineHeight: 18 },
});
