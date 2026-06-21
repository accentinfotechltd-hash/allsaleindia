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
import CouponInput from "@/src/components/CouponInput";
import GiftWrapToggle from "@/src/components/GiftWrapToggle";
import PointsRedeemInput from "@/src/components/PointsRedeemInput";
import { useRegion } from "@/src/contexts/RegionContext";
import { useTranslation } from "@/src/i18n";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

export default function Cart() {
  const { formatPrice, info } = useRegion();
  const router = useRouter();
  const { cart, loading, update, remove } = useCart();
  const { t } = useTranslation();

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
          <Text style={styles.title}>{t("cart.title")}</Text>
        </View>
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <ShoppingBag size={32} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{t("cart.empty")}</Text>
          <Text style={styles.emptyText}>
            Discover authentic Indian sarees, brass, spices and more — handpicked for NZ.
          </Text>
          <Pressable
            testID="cart-shop-now-btn"
            onPress={() => router.replace("/(tabs)/home")}
            style={styles.shopBtn}
          >
            <Text style={styles.shopBtnText}>{t("cart_screen.start_shopping")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("cart.title")}</Text>
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
                <Text style={styles.priceNzd}>{formatPrice(item.price_nzd)}</Text>
                <Text style={styles.priceLabel}>{t("cart_screen.nzd_label")}</Text>
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
              <View style={{ marginTop: 8 }}>
                <GiftWrapToggle
                  productId={item.product_id}
                  giftWrap={!!item.gift_wrap}
                  giftMessage={item.gift_message}
                />
                {item.gift_wrap && item.gift_message ? (
                  <Text style={styles.giftMessagePreview} numberOfLines={2}>
                    💌 “{item.gift_message}”
                  </Text>
                ) : null}
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
              ? "Free shipping unlocked!"
              : `Add ${formatPrice(100 - cart.subtotal_nzd)} more for free shipping`}
          </Text>
        </View>
        <SummaryRow label="Subtotal" value={formatPrice(cart.subtotal_nzd)} />
        <SummaryRow
          label="Shipping"
          value={cart.shipping_nzd === 0 ? "FREE" : formatPrice(cart.shipping_nzd)}
          highlight={cart.shipping_nzd === 0}
        />
        {cart.discount_nzd > 0 ? (
          <SummaryRow
            label={cart.coupon_code ? `Coupon (${cart.coupon_code})` : "Discount"}
            value={`-${formatPrice(cart.discount_nzd)}`}
            highlight
          />
        ) : null}
        {(cart.gift_wrap_fee_nzd ?? 0) > 0 ? (
          <SummaryRow
            label={`🎁 Gift wrap × ${cart.gift_wrap_count ?? 0}`}
            value={`+${formatPrice(cart.gift_wrap_fee_nzd ?? 0)}`}
          />
        ) : null}
        <View style={{ marginTop: spacing.sm, marginBottom: spacing.sm }}>
          <CouponInput />
        </View>
        <View style={{ marginBottom: spacing.sm }}>
          <PointsRedeemInput />
        </View>
        <SummaryRow
          label={
            cart.tax_at_border
              ? t("tax.line_at_border")
              : cart.tax_inclusive
              ? t("tax.in_gst_inclusive")
              : cart.tax_label_key
              ? `${t(cart.tax_label_key)}${cart.tax_over_threshold ? " (at border)" : ""}`
              : t("tax.line_default")
          }
          value={
            cart.tax_nzd && cart.tax_nzd > 0
              ? formatPrice(cart.tax_nzd)
              : cart.tax_at_border
              ? t("tax.value_at_border")
              : cart.tax_inclusive
              ? t("tax.value_inclusive")
              : formatPrice(0)
          }
        />
        <View style={styles.divider} />
        <SummaryRow label={`Total (${info.currency})`} value={formatPrice(cart.total_nzd)} bold />
        {info.currency !== "NZD" ? (
          <SummaryRow label="In NZD" value={formatNZD(cart.total_nzd)} />
        ) : null}

        <Pressable
          testID="cart-checkout-btn"
          onPress={() => router.push("/checkout")}
          style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Text style={styles.ctaText}>{t("cart_screen.checkout_cta", { total: formatPrice(cart.total_nzd) })}</Text>
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
  priceLabel: { fontSize: 10, color: colors.textFaint, fontWeight: "700", letterSpacing: 0.5 },
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
  giftMessagePreview: { color: "#7C2D12", fontSize: 11, marginTop: 4, fontStyle: "italic", lineHeight: 14 },
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
