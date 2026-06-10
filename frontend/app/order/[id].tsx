import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, MapPin, Package } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Order = {
  id: string;
  items: { product_id: string; name: string; image: string; price_nzd: number; quantity: number }[];
  subtotal_nzd: number;
  shipping_nzd: number;
  total_nzd: number;
  address: {
    full_name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postcode: string;
    country: string;
    phone: string;
  };
  status: string;
  payment_status: string;
  created_at: string;
  estimated_delivery: string;
};

const TIMELINE = [
  { key: "paid", label: "Order confirmed" },
  { key: "shipped", label: "Shipped from India" },
  { key: "delivered", label: "Delivered in NZ" },
];

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const o = await api<Order>(`/orders/${id}`);
        setOrder(o);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={{ color: colors.textMuted }}>Order not found.</Text>
      </SafeAreaView>
    );
  }

  const orderStages = ["paid", "shipped", "delivered"];
  const currentIdx = orderStages.indexOf(order.status);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="order-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Order details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.iconCircle}>
            <Package size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNum}>
              Order #{order.id.replace("order_", "").slice(0, 8).toUpperCase()}
            </Text>
            <Text style={styles.orderDate}>
              {new Date(order.created_at).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })}
            </Text>
          </View>
        </View>

        <View style={styles.deliveryBanner}>
          <Text style={styles.deliveryLabel}>Estimated arrival</Text>
          <Text style={styles.deliveryDate}>{order.estimated_delivery}</Text>
        </View>

        <Text style={styles.sectionTitle}>Tracking</Text>
        <View style={styles.timeline}>
          {TIMELINE.map((t, i) => {
            const done = i <= currentIdx;
            return (
              <View key={t.key} style={styles.timelineRow}>
                <View style={[styles.dot, done && styles.dotDone]} />
                <Text style={[styles.timelineLabel, done && styles.timelineLabelDone]}>{t.label}</Text>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionTitle}>Items</Text>
        {order.items.map((it) => (
          <View key={it.product_id} style={styles.itemRow}>
            <Image source={{ uri: it.image }} style={styles.itemImg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
              <Text style={styles.itemMeta}>Qty {it.quantity}</Text>
            </View>
            <Text style={styles.itemPrice}>{formatNZD(it.price_nzd * it.quantity)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Shipping address</Text>
        <View style={styles.addressCard}>
          <MapPin size={16} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.addressName}>{order.address.full_name}</Text>
            <Text style={styles.addressLine}>
              {order.address.line1}
              {order.address.line2 ? `, ${order.address.line2}` : ""}
            </Text>
            <Text style={styles.addressLine}>
              {order.address.city}, {order.address.region} {order.address.postcode}
            </Text>
            <Text style={styles.addressLine}>{order.address.country}</Text>
            <Text style={styles.addressPhone}>{order.address.phone}</Text>
          </View>
        </View>

        <View style={styles.totals}>
          <Line label="Subtotal" value={formatNZD(order.subtotal_nzd)} />
          <Line
            label="Shipping"
            value={order.shipping_nzd === 0 ? "FREE" : formatNZD(order.shipping_nzd)}
            highlight={order.shipping_nzd === 0}
          />
          <View style={styles.divider} />
          <Line label="Total (NZD)" value={formatNZD(order.total_nzd)} bold />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Line({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineBold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.lineBold, highlight && { color: colors.success, fontWeight: "800" }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
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
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  orderNum: { fontSize: 14, fontWeight: "800", color: colors.text },
  orderDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  deliveryBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
  },
  deliveryLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  deliveryDate: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 4, letterSpacing: -0.3 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginTop: spacing.lg, marginBottom: 8 },
  timeline: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, gap: 12 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 999, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.primary },
  timelineLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  timelineLabelDone: { color: colors.text },
  itemRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  itemImg: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surface },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: "800", color: colors.text },
  addressCard: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  addressName: { fontSize: 14, fontWeight: "800", color: colors.text },
  addressLine: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  addressPhone: { fontSize: 13, color: colors.text, marginTop: 4 },
  totals: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  lineLabel: { fontSize: 13, color: colors.textMuted },
  lineValue: { fontSize: 13, color: colors.text, fontWeight: "600" },
  lineBold: { fontSize: 16, fontWeight: "800", color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
});
