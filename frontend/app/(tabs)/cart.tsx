import { useRouter } from "expo-router";
import { Minus, Plus, ShoppingBag, Trash2, Truck } from "lucide-react-native";
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

import { useCart } from "@/src/contexts/CartContext";
import { colors, formatINR, formatNZD, radius, spacing } from "@/src/lib/theme";

export default function Cart() {
  const router = useRouter();
  const { cart, loading, update, remove } = useCart();

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]} edges={["top"]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (cart.items.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.title}>Your cart</Text>
        </View>
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={32} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>
            Discover authentic Indian sarees, brass, spices and more — handpicked for NZ.
          </Text>
          <Pressable
            testID="cart-shop-now-btn"
            onPress={() => router.replace("/(tabs)/home")}
            style={styles.shopBtn}
          >
            <Text style={styles.shopBtnText}>Start shopping</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Your cart</Text>
        <Text style={styles.subtitle}>
          {cart.items.length} {cart.items.length === 1 ? "item" : "items"}
        </Text>
      </View>

      <FlatList
        data={cart.items}
        keyExtractor={(i) => i.product_id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 220 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View style={styles.row} testID={`cart-item-${item.product_id}`}>
            <Image source={{ uri: item.image }} style={styles.img} />
            <View style={styles.rowBody}>
              <Text style={styles.itemCategory}>{item.category.toUpperCase()}</Text>
              <Text style={styles.itemName} numberOfLines={2}>
                {item.name}
              </Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceNzd}>{formatNZD(item.price_nzd)}</Text>
                <Text style={styles.priceInr}>{formatINR(item.price_inr)}</Text>
              </View>
              <View style={styles.qtyRow}>
                <View style={styles.qtyBox}>
                  <Pressable
                    testID={`cart-decrease-${item.product_id}`}
                    onPress={() => update(item.product_id, Math.max(0, item.quantity - 1))}
                    style={styles.qtyBtn}
                  >
                    <Minus size={14} color={colors.text} />
                  </Pressable>
                  <Text style={styles.qtyNum}>{item.quantity}</Text>
                  <Pressable
                    testID={`cart-increase-${item.product_id}`}
                    onPress={() => update(item.product_id, item.quantity + 1)}
                    style={styles.qtyBtn}
                  >
                    <Plus size={14} color={colors.text} />
                  </Pressable>
                </View>
                <Pressable
                  testID={`cart-remove-${item.product_id}`}
                  onPress={() => remove(item.product_id)}
                  style={styles.removeBtn}
                >
                  <Trash2 size={16} color={colors.error} />
                </Pressable>
              </View>
            </View>
          </View>
        )}
      />

      <View style={styles.summary}>
        <View style={styles.shippingNote}>
          <Truck size={14} color={colors.success} />
          <Text style={styles.shippingText}>
            {cart.shipping_nzd === 0
              ? "Free shipping to NZ unlocked!"
              : `Add ${formatNZD(100 - cart.subtotal_nzd)} more for free shipping`}
          </Text>
        </View>
        <SummaryRow label="Subtotal" value={formatNZD(cart.subtotal_nzd)} />
        <SummaryRow
          label="Shipping to NZ"
          value={cart.shipping_nzd === 0 ? "FREE" : formatNZD(cart.shipping_nzd)}
          highlight={cart.shipping_nzd === 0}
        />
        <SummaryRow
          label={cart.subtotal_nzd > 1000 ? "NZ GST 15% + 10% duty (est.)" : "NZ GST 15% (est.)"}
          value={formatNZD(
            cart.subtotal_nzd > 1000
              ? (cart.subtotal_nzd + cart.shipping_nzd) * 0.15 + cart.subtotal_nzd * 0.1
              : (cart.subtotal_nzd + cart.shipping_nzd) * 0.15,
          )}
        />
        <View style={styles.divider} />
        <SummaryRow label="Total (NZD)" value={formatNZD(cart.total_nzd)} bold />
        <Text style={styles.inrEquiv}>≈ {formatINR(cart.subtotal_inr)}</Text>

        <Pressable
          testID="cart-checkout-btn"
          onPress={() => router.push("/checkout")}
          style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Text style={styles.ctaText}>Checkout · {formatNZD(cart.total_nzd)}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <View style={summaryStyles.row}>
      <Text style={[summaryStyles.label, bold && summaryStyles.bold]}>{label}</Text>
      <Text
        style={[
          summaryStyles.value,
          bold && summaryStyles.bold,
          highlight && { color: colors.success, fontWeight: "800" },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { fontSize: 14, color: colors.textMuted },
  value: { fontSize: 14, color: colors.text, fontWeight: "600" },
  bold: { fontSize: 17, fontWeight: "800", color: colors.text },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  row: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 12,
  },
  img: { width: 90, height: 90, borderRadius: radius.md, backgroundColor: colors.surface },
  rowBody: { flex: 1 },
  itemCategory: { fontSize: 10, color: colors.primary, fontWeight: "800", letterSpacing: 1 },
  itemName: { fontSize: 14, color: colors.text, fontWeight: "600", marginTop: 2, lineHeight: 18 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  priceNzd: { fontSize: 15, fontWeight: "800", color: colors.text },
  priceInr: { fontSize: 11, color: colors.textFaint },
  qtyRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 },
  qtyBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 4,
  },
  qtyBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  qtyNum: { fontSize: 14, fontWeight: "700", color: colors.text, minWidth: 20, textAlign: "center" },
  removeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  summary: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 12,
  },
  shippingNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
  },
  shippingText: { fontSize: 12, color: colors.success, fontWeight: "600" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  inrEquiv: { fontSize: 12, color: colors.textFaint, marginTop: 2, textAlign: "right" },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  emptyText: { fontSize: 14, color: colors.textMuted, marginTop: 8, textAlign: "center", lineHeight: 20 },
  shopBtn: {
    backgroundColor: colors.text,
    paddingHorizontal: 24,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  shopBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
