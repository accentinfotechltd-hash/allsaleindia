import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, Package, RefreshCcw, Star, XCircle } from "lucide-react-native";
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

import DeliveryRatingSheet from "@/src/components/DeliveryRatingSheet";
import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { useRegion } from "@/src/contexts/RegionContext";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Order = {
  id: string;
  items: { product_id: string; name: string; image: string; price_nzd: number; quantity: number }[];
  total_nzd: number;
  status: string;
  payment_status: string;
  created_at: string;
  estimated_delivery: string;
  cancellable_until?: string | null;
  delivery_rating?: { stars: number; comment?: string } | null;
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending: { bg: "#FEF3C7", text: "#92400E" },
  paid: { bg: "#DBEAFE", text: "#1E40AF" },
  shipped: { bg: "#E0E7FF", text: "#3730A3" },
  delivered: { bg: "#D1FAE5", text: "#065F46" },
  cancelled: { bg: "#FEE2E2", text: "#991B1B" },
};

export default function Orders() {
  const { formatPrice } = useRegion();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingFor, setRatingFor] = useState<
    null | { id: string; stars: number; comment: string }
  >(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Order[]>("/orders");
      setOrders(list);
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelOrder = useCallback(
    async (orderId: string) => {
      const ok = await confirm({
        title: "Cancel this order?",
        message: "You'll receive a full refund within 5–10 business days.",
        confirmLabel: "Cancel order",
        cancelLabel: "Keep order",
        destructive: true,
      });
      if (!ok) return;
      try {
        await api(`/orders/${orderId}/cancel`, { method: "POST", body: { reason: "" } });
        toast.show({ title: "Order cancelled", body: "Your refund will be processed shortly.", kind: "success" });
        await load();
      } catch (e: any) {
        toast.show({ title: "Couldn't cancel", body: e?.message || "Please try again.", kind: "error" });
      }
    },
    [load, confirm, toast],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="orders-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>My orders</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Package size={28} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>Once you place an order, it will show up here.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: 12 }}
          renderItem={({ item }) => {
            const tone = STATUS_COLOR[item.status] || STATUS_COLOR.pending;
            const date = new Date(item.created_at);
            return (
              <Pressable
                testID={`order-row-${item.id}`}
                onPress={() => router.push(`/order/${item.id}`)}
                style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.99 }] }]}
              >
                <View style={styles.rowHead}>
                  <Text style={styles.orderId}>#{item.id.replace("order_", "").slice(0, 8).toUpperCase()}</Text>
                  <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.statusText, { color: tone.text }]}>{item.status.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.orderDate}>{date.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}</Text>
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
                <View style={styles.rowFoot}>
                  <Text style={styles.deliveryText}>Est. delivery: {item.estimated_delivery}</Text>
                  <Text style={styles.totalText}>{formatPrice(item.total_nzd)}</Text>
                </View>

                {item.status === "delivered" ? (
                  <View style={styles.deliveredActions}>
                    <Pressable
                      testID={`orders-rate-delivery-${item.id}`}
                      onPress={(e) => {
                        e.stopPropagation();
                        setRatingFor({
                          id: item.id,
                          stars: item.delivery_rating?.stars || 0,
                          comment: item.delivery_rating?.comment || "",
                        });
                      }}
                      style={styles.rateLink}
                    >
                      <Star
                        size={13}
                        color={item.delivery_rating ? "#F59E0B" : colors.primary}
                        fill={item.delivery_rating ? "#F59E0B" : "transparent"}
                      />
                      <Text style={styles.rateLinkText}>
                        {item.delivery_rating
                          ? `You rated ${item.delivery_rating.stars}★ · Edit`
                          : "Rate delivery"}
                      </Text>
                    </Pressable>
                    <Pressable
                      testID={`orders-return-link-${item.id}`}
                      onPress={(e) => {
                        e.stopPropagation();
                        router.push(`/order/${item.id}/return`);
                      }}
                      style={styles.returnLink}
                    >
                      <RefreshCcw size={13} color={colors.primary} />
                      <Text style={styles.returnLinkText}>Request return</Text>
                    </Pressable>
                  </View>
                ) : (() => {
                  // Cancel allowed while order is still pre-shipped.
                  const canCancel =
                    ["paid", "pending"].includes(item.status) &&
                    item.payment_status === "paid";
                  if (!canCancel) return null;
                  return (
                    <Pressable
                      testID={`orders-cancel-link-${item.id}`}
                      onPress={(e) => {
                        e.stopPropagation();
                        cancelOrder(item.id);
                      }}
                      style={styles.cancelLink}
                    >
                      <XCircle size={13} color={colors.error} />
                      <Text style={styles.cancelLinkText}>Cancel order</Text>
                      <Text style={styles.cancelHint}> · before dispatch</Text>
                    </Pressable>
                  );
                })()}
              </Pressable>
            );
          }}
        />
      )}

      {ratingFor ? (
        <DeliveryRatingSheet
          visible
          orderId={ratingFor.id}
          initialStars={ratingFor.stars}
          initialComment={ratingFor.comment}
          onClose={() => setRatingFor(null)}
          onSubmitted={() => {
            setRatingFor(null);
            load();
          }}
        />
      ) : null}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  emptyText: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: "center" },
  row: {
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 13, fontWeight: "800", color: colors.text, letterSpacing: 0.5 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  orderDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  thumbRow: { flexDirection: "row", gap: 6, marginTop: spacing.sm },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbMore: { alignItems: "center", justifyContent: "center", backgroundColor: colors.text },
  thumbMoreText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  rowFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deliveryText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  totalText: { fontSize: 15, fontWeight: "800", color: colors.text },
  returnLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  returnLinkText: { fontSize: 12, color: colors.primary, fontWeight: "700" },
  cancelLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelLinkText: { fontSize: 12, color: colors.error, fontWeight: "700" },
  cancelHint: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  deliveredActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexWrap: "wrap",
  },
  rateLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rateLinkText: { fontSize: 12, color: colors.primary, fontWeight: "700" },
});
