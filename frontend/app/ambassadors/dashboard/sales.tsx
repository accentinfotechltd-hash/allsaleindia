import { useRouter } from "expo-router";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
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

import { useToast } from "@/src/components/UiOverlayProvider";
import {
  AmbassadorMe,
  formatMoney,
  getMe,
  listSales,
  SaleRow,
} from "@/src/lib/ambassadors";
import { colors, radius, spacing } from "@/src/lib/theme";

const PAGE_SIZE = 30;

/**
 * Deep-linkable sales view (`/ambassadors/dashboard/sales`).
 * Mirrors the inline tab on /ambassadors/dashboard but as a dedicated route
 * so the URL can be shared (e.g. “check my sales”) and supports paginated
 * load-more without scrolling past the overview cards.
 */
export default function AmbassadorSales() {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<AmbassadorMe | null>(null);
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (replace = true) => {
    try {
      const [m, page] = await Promise.all([
        replace ? getMe() : Promise.resolve(me),
        listSales(PAGE_SIZE, replace ? 0 : rows.length),
      ]);
      if (m) setMe(m);
      setRows((prev) => (replace ? page : [...prev, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("not enrolled")) {
        router.replace("/ambassadors");
        return;
      }
      toast.show({ title: "Couldn't load sales", body: msg, kind: "error" });
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [me, rows.length, router, toast]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  const onLoadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    load(false);
  };

  // Aggregate quick stats for the strip at the top.
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const available = rows.filter((r) => r.locked_at && new Date(r.locked_at) <= new Date()).length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="amb-sales-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sales</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (contentSize.height - (contentOffset.y + layoutMeasurement.height) < 200) {
            onLoadMore();
          }
        }}
        scrollEventThrottle={400}
      >
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : !me ? null : (
          <>
            {/* Summary strip */}
            <View style={styles.summary}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{rows.length}{hasMore ? "+" : ""}</Text>
                <Text style={styles.summaryLabel}>Showing</Text>
              </View>
              <View style={styles.summarySep} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{formatMoney(totalCommission, me.payout_currency)}</Text>
                <Text style={styles.summaryLabel}>Commission</Text>
              </View>
              <View style={styles.summarySep} />
              <View style={styles.summaryCol}>
                <Text style={[styles.summaryValue, { color: colors.success }]}>{available}</Text>
                <Text style={styles.summaryLabel}>Available</Text>
              </View>
            </View>

            {rows.length === 0 ? (
              <View style={styles.empty}>
                <Sparkles size={28} color={colors.textFaint} />
                <Text style={styles.emptyText}>
                  No sales yet. Share your code <Text style={styles.bold}>{me.code}</Text> to start earning!
                </Text>
              </View>
            ) : (
              rows.map((s) => (
                <View key={s.order_id} style={styles.row} testID={`amb-sale-row-${s.order_short_id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.orderId}>#{s.order_short_id}</Text>
                    <Text style={styles.orderMeta}>
                      {new Date(s.placed_at).toLocaleDateString()} · {s.status}
                    </Text>
                    <Text style={styles.orderTotal}>Order total {formatMoney(s.order_total, s.currency)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.commission}>+{formatMoney(s.commission, s.currency)}</Text>
                    <Text style={[
                      styles.lockTag,
                      s.locked_at && new Date(s.locked_at) <= new Date() && { color: colors.success },
                    ]}>
                      {s.locked_at && new Date(s.locked_at) <= new Date() ? "available" : "on hold"}
                    </Text>
                  </View>
                </View>
              ))
            )}
            {loadingMore && (
              <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />
            )}
            {!hasMore && rows.length > 0 && (
              <Text style={styles.endMarker}>End of history — {rows.length} sales total</Text>
            )}
          </>
        )}
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
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl * 2 },
  center: { padding: spacing.xxl, alignItems: "center" },
  summary: { flexDirection: "row", backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  summaryCol: { flex: 1, alignItems: "center" },
  summaryValue: { fontWeight: "800", color: colors.text, fontSize: 17 },
  summaryLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  summarySep: { width: 1, backgroundColor: colors.border },
  empty: { padding: spacing.xxl, alignItems: "center", gap: 10 },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  bold: { color: colors.text, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  orderId: { fontWeight: "800", color: colors.text, fontSize: 13 },
  orderMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2, textTransform: "capitalize" },
  orderTotal: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
  commission: { fontWeight: "800", color: colors.success, fontSize: 14 },
  lockTag: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontWeight: "700" },
  endMarker: { color: colors.textFaint, textAlign: "center", marginVertical: spacing.lg, fontSize: 11 },
});
