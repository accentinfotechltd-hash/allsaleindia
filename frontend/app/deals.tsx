/**
 * Today's Deals — Amazon-style deal-discovery destination.
 *
 * Sections:
 *   1. Hero (count of active flash sales + tagline)
 *   2. Flash Sales — 2-col grid with live countdown timers, sale price /
 *      strikethrough original, discount %, units-sold progress bar, "Shop"
 *      CTA → /product/{id}
 *   3. Active Coupons — horizontal strip (logged-in only) with Copy code
 *   4. More deals — products in active flash sales with discount_pct >= 10,
 *      surfaced via the existing min_discount_pct facet on /products
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft,
  Clock,
  Copy,
  Flame,
  Tag,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductCard, ProductLite } from "@/src/components/ProductCard";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const GUTTER = 12;
const CARD_W = (SCREEN_W - spacing.lg * 2 - GUTTER) / 2;

type FlashSale = {
  id: string;
  product_id: string;
  product_name: string;
  product_image: string;
  seller_name?: string;
  sale_price_nzd: number;
  original_price_nzd: number;
  discount_pct: number;
  ends_at: string;
  starts_at: string;
  units_sold: number;
  units_max: number;
  is_deal_of_the_day: boolean;
  sold_out: boolean;
};

type Coupon = {
  code: string;
  description: string;
  type: string;
  value: number;
  min_order_nzd: number;
  max_discount_nzd: number | null;
  scope: string;
  owner_name?: string;
  valid_to: string | null;
};

export default function DealsPage() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [flashSales, setFlashSales] = useState<FlashSale[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [discountProducts, setDiscountProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fs, dp, cp] = await Promise.all([
        api<FlashSale[]>("/flash-sales/active?limit=20", { auth: false }),
        api<ProductLite[]>("/products?min_discount_pct=10&limit=20", {
          auth: false,
        }),
        user
          ? api<Coupon[]>("/coupons/active").catch(() => [])
          : Promise.resolve([] as Coupon[]),
      ]);
      setFlashSales(fs);
      setDiscountProducts(dp);
      setCoupons(cp);
    } catch {
      // Render empty state
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Re-render once per second so countdown timers stay live.
  useEffect(() => {
    if (flashSales.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [flashSales.length]);

  const copyCode = useCallback(
    async (code: string) => {
      await Clipboard.setStringAsync(code);
      toast.show({ title: `Copied "${code}"`, kind: "success" });
    },
    [toast]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="deals-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={styles.title}>Today&apos;s Deals</Text>
          <Text style={styles.subtitle}>
            {flashSales.length > 0
              ? `${flashSales.length} flash sale${flashSales.length === 1 ? "" : "s"} live now`
              : "Limited-time offers, refreshed daily"}
          </Text>
        </View>
        <View style={styles.heroIcon}>
          <Flame size={22} color="#DC2626" />
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          {/* Section 1 — Flash sales grid (with countdowns) */}
          {flashSales.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Zap size={14} color="#DC2626" />
                <Text style={styles.sectionLabel}>Flash sales</Text>
              </View>
              <View style={styles.grid}>
                {flashSales.map((fs) => (
                  <FlashSaleCard
                    key={fs.id}
                    sale={fs}
                    onPress={() => router.push(`/product/${fs.product_id}`)}
                    tick={tick}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* Section 2 — Coupons (logged-in only) */}
          {user && coupons.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Tag size={14} color="#7C3AED" />
                <Text style={styles.sectionLabel}>Coupons for you</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.couponRow}
              >
                {coupons.map((c) => (
                  <CouponCard
                    key={c.code}
                    coupon={c}
                    onCopy={() => copyCode(c.code)}
                  />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Section 3 — More deals (uses min_discount_pct facet) */}
          {discountProducts.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>
                  More deals · 10%+ off
                </Text>
              </View>
              <FlatList
                data={discountProducts}
                keyExtractor={(p) => p.id}
                numColumns={2}
                scrollEnabled={false}
                columnWrapperStyle={{
                  gap: GUTTER,
                  paddingHorizontal: spacing.lg,
                }}
                contentContainerStyle={{ gap: GUTTER }}
                renderItem={({ item }) => (
                  <ProductCard
                    product={item}
                    width={CARD_W}
                    onPress={() => router.push(`/product/${item.id}`)}
                  />
                )}
              />
            </View>
          ) : null}

          {/* Empty state */}
          {flashSales.length === 0 &&
          discountProducts.length === 0 &&
          coupons.length === 0 ? (
            <View style={styles.empty}>
              <Flame size={32} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No live deals right now</Text>
              <Text style={styles.emptySub}>
                Check back soon — new flash sales drop daily.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Flash sale card with live countdown timer.
// ---------------------------------------------------------------------------
function FlashSaleCard({
  sale,
  onPress,
  tick: _tick, // re-render trigger; not consumed
}: {
  sale: FlashSale;
  onPress: () => void;
  tick: number;
}) {
  const ms = new Date(sale.ends_at).getTime() - Date.now();
  const ended = ms <= 0;
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const countdownLabel = h > 24
    ? `${Math.floor(h / 24)}d left`
    : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const soldPct =
    sale.units_max > 0
      ? Math.min(100, Math.round((sale.units_sold / sale.units_max) * 100))
      : 0;

  return (
    <Pressable
      testID={`flash-sale-${sale.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.fsCard, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.fsImageWrap}>
        <Image source={{ uri: sale.product_image }} style={styles.fsImage} />
        <View style={styles.fsDiscountBadge}>
          <Text style={styles.fsDiscountText}>-{sale.discount_pct}%</Text>
        </View>
        {sale.is_deal_of_the_day ? (
          <View style={styles.fsDealBadge}>
            <Text style={styles.fsDealText}>Deal of the day</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.fsBody}>
        <Text style={styles.fsName} numberOfLines={2}>
          {sale.product_name}
        </Text>
        <View style={styles.fsPriceRow}>
          <Text style={styles.fsSalePrice}>
            {formatNZD(sale.sale_price_nzd)}
          </Text>
          <Text style={styles.fsOrigPrice}>
            {formatNZD(sale.original_price_nzd)}
          </Text>
        </View>
        {sale.units_max > 0 ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${soldPct}%` }]}
              />
            </View>
            <Text style={styles.progressText}>
              {sale.units_sold} sold
              {soldPct >= 70 ? ` · ${soldPct}% claimed` : ""}
            </Text>
          </View>
        ) : null}
        <View style={styles.fsTimerRow}>
          <Clock size={11} color={ended ? colors.textMuted : "#DC2626"} />
          <Text
            style={[
              styles.fsTimerText,
              ended && { color: colors.textMuted },
            ]}
          >
            {ended ? "Ended" : countdownLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Coupon card with Copy code action.
// ---------------------------------------------------------------------------
function CouponCard({
  coupon,
  onCopy,
}: {
  coupon: Coupon;
  onCopy: () => void;
}) {
  const valueLabel =
    coupon.type === "percentage"
      ? `${coupon.value}% off`
      : `${formatNZD(coupon.value)} off`;
  return (
    <View style={styles.couponCard} testID={`coupon-${coupon.code}`}>
      <View style={styles.couponLeft}>
        <Text style={styles.couponValue}>{valueLabel}</Text>
        <Text style={styles.couponDesc} numberOfLines={2}>
          {coupon.description}
        </Text>
        {coupon.min_order_nzd > 0 ? (
          <Text style={styles.couponMin}>
            Min order {formatNZD(coupon.min_order_nzd)}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID={`coupon-copy-${coupon.code}`}
        onPress={onCopy}
        style={styles.couponCodeBtn}
      >
        <Text style={styles.couponCode}>{coupon.code}</Text>
        <Copy size={12} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
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
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { marginTop: spacing.lg, gap: spacing.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
  },
  sectionLabel: {
    fontWeight: "800",
    color: colors.text,
    fontSize: 15,
    letterSpacing: -0.3,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GUTTER,
    paddingHorizontal: spacing.lg,
  },
  // Flash sale card
  fsCard: {
    width: CARD_W,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  fsImageWrap: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: colors.surface,
    position: "relative",
  },
  fsImage: { width: "100%", height: "100%" },
  fsDiscountBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#DC2626",
  },
  fsDiscountText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  fsDealBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#000",
  },
  fsDealText: { color: "#fff", fontWeight: "800", fontSize: 8.5, letterSpacing: 0.4 },
  fsBody: { padding: 10, gap: 6 },
  fsName: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 16,
  },
  fsPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  fsSalePrice: {
    fontSize: 16,
    fontWeight: "800",
    color: "#DC2626",
    letterSpacing: -0.5,
  },
  fsOrigPrice: {
    fontSize: 11,
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  progressWrap: { gap: 3 },
  progressTrack: {
    height: 4,
    width: "100%",
    borderRadius: 2,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#DC2626",
    borderRadius: 2,
  },
  progressText: {
    fontSize: 9.5,
    color: colors.textMuted,
    fontWeight: "700",
  },
  fsTimerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  fsTimerText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#DC2626",
    fontVariant: ["tabular-nums"],
  },
  // Coupon
  couponRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  couponCard: {
    width: 250,
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  couponLeft: { flex: 1, padding: spacing.md, gap: 4 },
  couponValue: {
    fontSize: 16,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: -0.4,
  },
  couponDesc: {
    fontSize: 11,
    color: colors.text,
    fontWeight: "600",
    lineHeight: 15,
  },
  couponMin: { fontSize: 10, color: colors.textMuted, fontWeight: "600" },
  couponCodeBtn: {
    width: 80,
    backgroundColor: "#F5F3FF",
    borderLeftWidth: 1,
    borderLeftColor: "#DDD6FE",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  couponCode: {
    fontSize: 12,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.5,
  },
  // Empty
  empty: {
    paddingTop: 60,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
});
