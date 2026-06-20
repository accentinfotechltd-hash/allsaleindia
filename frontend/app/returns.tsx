/**
 * Buyer-side "My Returns" screen.
 *
 * Lists every return request the current user has submitted, grouped by
 * status, with a quick link back to the underlying order.
 */
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, RefreshCcw } from "lucide-react-native";
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

import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type ReturnItem = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  quantity: number;
};

type ReturnRequest = {
  id: string;
  order_id: string;
  items: ReturnItem[];
  reason: string;
  status: string; // pending_seller | approved | rejected | refunded | cancelled
  refund_amount_nzd: number;
  restocking_fee_nzd: number;
  buyer_pays_shipping: boolean;
  created_at: string;
  decided_at?: string | null;
  decision_note?: string | null;
};

const STATUS_PILL: Record<string, { bg: string; fg: string; labelKey: string }> = {
  pending_seller: { bg: "#FEF3C7", fg: "#92400E", labelKey: "buyer_returns.status_pending_seller" },
  approved:       { bg: "#DBEAFE", fg: "#1E40AF", labelKey: "buyer_returns.status_approved" },
  refunded:       { bg: "#D1FAE5", fg: "#065F46", labelKey: "buyer_returns.status_refunded" },
  rejected:       { bg: "#FEE2E2", fg: "#991B1B", labelKey: "buyer_returns.status_rejected" },
  cancelled:      { bg: "#E5E7EB", fg: "#374151", labelKey: "buyer_returns.status_cancelled" },
};

const REASON_KEY: Record<string, string> = {
  damaged_on_arrival: "buyer_returns.reason_damaged",
  wrong_item: "buyer_returns.reason_wrong",
  not_as_described: "buyer_returns.reason_not_described",
  defective: "buyer_returns.reason_defective",
  changed_my_mind: "buyer_returns.reason_changed_mind",
};

export default function MyReturnsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api<ReturnRequest[]>("/returns/me");
      setReturns(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="myreturns-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("buyer_returns.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : returns.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <RefreshCcw size={28} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t("buyer_returns.empty_title")}</Text>
          <Text style={styles.emptyText}>
            {t("buyer_returns.empty_body")}
          </Text>
          <Pressable
            testID="myreturns-orders-link"
            onPress={() => router.push("/orders")}
            style={styles.ordersBtn}
          >
            <Text style={styles.ordersBtnText}>{t("buyer_returns.go_orders_btn")}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={returns}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: 12 }}
          renderItem={({ item }) => {
            const pill = STATUS_PILL[item.status] || STATUS_PILL.pending_seller;
            const orderShort = item.order_id.replace("order_", "").slice(0, 8).toUpperCase();
            const date = new Date(item.created_at);
            return (
              <Pressable
                testID={`myreturn-row-${item.id}`}
                onPress={() => router.push(`/order/${item.order_id}`)}
                style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.99 }] }]}
              >
                <View style={styles.rowHead}>
                  <View>
                    <Text style={styles.orderId}>{t("buyer_returns.order_prefix")}{orderShort}</Text>
                    <Text style={styles.dateText}>
                      {date.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                    <Text style={[styles.statusText, { color: pill.fg }]}>{t(pill.labelKey)}</Text>
                  </View>
                </View>

                <Text style={styles.reason}>
                  {t("buyer_returns.reason_prefix")}<Text style={{ fontWeight: "700", color: colors.text }}>{REASON_KEY[item.reason] ? t(REASON_KEY[item.reason]) : item.reason}</Text>
                </Text>

                <View style={styles.thumbRow}>
                  {item.items.slice(0, 4).map((it) => (
                    <Image key={it.product_id} source={{ uri: it.image }} style={styles.thumb} />
                  ))}
                  {item.items.length > 4 ? (
                    <View style={[styles.thumb, styles.thumbMore]}>
                      <Text style={styles.thumbMoreText}>+{item.items.length - 4}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.refundRow}>
                  <Text style={styles.refundLabel}>
                    {t(item.status === "refunded" ? "buyer_returns.refund_issued" : item.status === "rejected" ? "buyer_returns.refund_estimated" : "buyer_returns.refund_pending")}
                  </Text>
                  <Text style={styles.refundAmount}>{formatNZD(item.refund_amount_nzd)}</Text>
                </View>
                {item.restocking_fee_nzd > 0 ? (
                  <Text style={styles.restock}>{t("buyer_returns.restock_fee", { amount: formatNZD(item.restocking_fee_nzd) })}</Text>
                ) : null}
                {item.decision_note ? (
                  <Text style={styles.note}>{t("buyer_returns.seller_note", { note: item.decision_note })}</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyIcon: { width: 60, height: 60, borderRadius: 999, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  emptyText: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: "center", lineHeight: 19 },
  ordersBtn: { marginTop: spacing.lg, backgroundColor: colors.text, paddingHorizontal: 22, paddingVertical: 12, borderRadius: radius.pill },
  ordersBtnText: { color: "#fff", fontWeight: "800", letterSpacing: 0.3 },
  row: { padding: spacing.md, backgroundColor: "#fff", borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  orderId: { fontSize: 14, fontWeight: "800", color: colors.text, letterSpacing: 0.4 },
  dateText: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  reason: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  thumbRow: { flexDirection: "row", gap: 6, marginTop: spacing.sm },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbMore: { alignItems: "center", justifyContent: "center", backgroundColor: colors.text },
  thumbMoreText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  refundRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  refundLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  refundAmount: { fontSize: 16, fontWeight: "800", color: colors.text },
  restock: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  note: { fontSize: 12, color: colors.text, marginTop: 8, fontStyle: "italic" },
});
