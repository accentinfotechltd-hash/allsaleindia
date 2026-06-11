import { useFocusEffect, useRouter } from "expo-router";
import { Banknote, ChevronLeft, Wallet } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Payout = {
  id: string;
  order_id: string;
  company_name: string;
  items_count: number;
  gross_nzd: number;
  commission_nzd: number;
  net_payable_nzd: number;
  status: string; // pending | paid_out
  created_at: string;
  paid_out_at: string | null;
};

type Summary = {
  payouts: Payout[];
  lifetime_earnings_nzd: number;
  pending_nzd: number;
  paid_out_nzd: number;
};

export default function SellerPayouts() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await api<Summary>("/seller/payouts");
      setData(s);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="seller-payouts-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Payouts</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data.payouts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: 10 }}
          ListHeaderComponent={
            <View>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>Lifetime earnings</Text>
                <Text style={styles.heroValue} testID="payouts-lifetime">{formatNZD(data.lifetime_earnings_nzd)}</Text>
                <Text style={styles.heroNote}>After 15% platform commission</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statCard}>
                  <Wallet size={16} color={colors.primary} />
                  <Text style={styles.statLabel}>Pending</Text>
                  <Text style={styles.statValue} testID="payouts-pending">{formatNZD(data.pending_nzd)}</Text>
                </View>
                <View style={styles.statCard}>
                  <Banknote size={16} color={colors.success} />
                  <Text style={styles.statLabel}>Paid out</Text>
                  <Text style={styles.statValue} testID="payouts-paid">{formatNZD(data.paid_out_nzd)}</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Recent payouts</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No payouts yet</Text>
              <Text style={styles.emptyText}>
                When a buyer&apos;s payment for one of your listings is confirmed, a payout is created here.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const paid = item.status === "paid_out";
            return (
              <View style={styles.row} testID={`payout-row-${item.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowOrder}>Order #{item.order_id.replace("order_", "").slice(0, 8).toUpperCase()}</Text>
                  <Text style={styles.rowMeta}>
                    {item.items_count} item{item.items_count === 1 ? "" : "s"} · Gross {formatNZD(item.gross_nzd)} · Fee {formatNZD(item.commission_nzd)}
                  </Text>
                  <Text style={styles.rowDate}>
                    {new Date(item.created_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}
                    {paid && item.paid_out_at
                      ? ` · paid ${new Date(item.paid_out_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}`
                      : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={styles.rowAmount}>{formatNZD(item.net_payable_nzd)}</Text>
                  <View
                    style={[
                      styles.pill,
                      { backgroundColor: paid ? colors.successSoft : "#FEF3C7" },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        { color: paid ? colors.success : "#92400E" },
                      ]}
                    >
                      {paid ? "PAID" : "PENDING"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
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
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  heroCard: {
    padding: spacing.lg,
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
  },
  heroLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  heroValue: { color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1, marginTop: 4 },
  heroNote: { color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 4 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700", letterSpacing: 0.5 },
  statValue: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: 8, letterSpacing: -0.2 },
  empty: { padding: spacing.lg, alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: radius.lg },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  emptyText: { fontSize: 12, color: colors.textMuted, marginTop: 6, textAlign: "center", lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 12,
  },
  rowOrder: { fontSize: 13, fontWeight: "800", color: colors.text, letterSpacing: 0.5 },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  rowDate: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: "800", color: colors.text },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
});
