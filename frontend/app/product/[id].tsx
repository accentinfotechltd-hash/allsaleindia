import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Globe2, PackageX, Ruler, ShieldCheck, ShoppingBag, Star, Truck } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, View, Alert, ActivityIndicator, Image, Pressable, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import SizeGuideModal from "@/src/components/SizeGuideModal";
import { useCart } from "@/src/contexts/CartContext";
import { api } from "@/src/lib/api";
import { chartsForCategory } from "@/src/lib/sizeCharts";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory?: string;
  price_nzd: number;
  price_inr: number;
  image: string;
  images?: string[];
  rating: number;
  reviews_count: number;
  shipping_days_min: number;
  shipping_days_max: number;
  origin: string;
  colors: string[];
  sizes: string[];
  stock_count: number;
  in_stock: boolean;
  seller_name?: string | null;
  seller_city?: string | null;
};

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { add } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const p = await api<Product>(`/products/${id}`, { auth: false });
        setProduct(p);
        if (p.colors?.length) setSelectedColor(p.colors[0]);
        if (p.sizes?.length) setSelectedSize(p.sizes[0]);
        // Fire-and-forget analytics ping (anonymous view counter).
        api(`/products/${id}/track-view`, { method: "POST", auth: false }).catch(() => {});
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const [galleryIdx, setGalleryIdx] = useState(0);
  const galleryWidth = Dimensions.get("window").width;
  const gallery = useMemo(() => {
    const imgs = (product?.images && product.images.length > 0)
      ? product.images
      : product?.image
        ? [product.image]
        : [];
    return imgs.slice(0, 10);
  }, [product]);

  const onGalleryScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    setGalleryIdx(Math.round(x / Math.max(1, galleryWidth)));
  };
  const hasSizeChart = useMemo(
    () => product ? chartsForCategory(product.category, product.subcategory).length > 0 : false,
    [product]
  );
  const outOfStock = product ? product.stock_count <= 0 || product.in_stock === false : false;
  const lowStock = product ? !outOfStock && product.stock_count > 0 && product.stock_count <= 5 : false;

  const onAdd = async () => {
    if (!product) return;
    if (outOfStock) return;
    setAdding(true);
    try {
      await add(product.id, 1);
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch (e: any) {
      Alert.alert("Couldn't add", e?.message || "Please try again.");
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={styles.muted}>Product not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <ScrollView
            testID="product-gallery"
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onGalleryScroll}
            style={{ width: galleryWidth }}
          >
            {gallery.map((uri, i) => (
              <Image
                key={i}
                source={{ uri }}
                style={[styles.hero, { width: galleryWidth }]}
                testID={`product-gallery-img-${i}`}
              />
            ))}
          </ScrollView>
          {gallery.length > 1 ? (
            <View style={styles.heroDots}>
              {gallery.map((_, i) => (
                <View
                  key={i}
                  style={[styles.heroDot, i === galleryIdx && styles.heroDotActive]}
                />
              ))}
            </View>
          ) : null}
          {gallery.length > 1 ? (
            <View style={styles.heroCount} testID="product-gallery-count">
              <Text style={styles.heroCountText}>
                {galleryIdx + 1} / {gallery.length}
              </Text>
            </View>
          ) : null}
          <SafeAreaView edges={["top"]} style={styles.heroOverlay}>
            <Pressable
              testID="product-back-btn"
              onPress={() => router.back()}
              style={styles.backBtn}
            >
              <ChevronLeft size={22} color={colors.text} />
            </Pressable>
          </SafeAreaView>
        </View>

        <View style={styles.body}>
          <Text style={styles.category}>{product.category.toUpperCase()}</Text>
          <Text style={styles.name}>{product.name}</Text>
          {product.seller_name || product.seller_city ? (
            <Text style={styles.sellerLine} testID="product-seller-line">
              by {product.seller_name || "Seller"}
              {product.seller_city ? ` · ${product.seller_city}, India` : " · India"}
            </Text>
          ) : null}

          <View style={styles.ratingRow}>
            <Star size={14} color="#F59E0B" fill="#F59E0B" />
            <Text style={styles.ratingText}>
              {product.rating.toFixed(1)}{" "}
              <Text style={styles.ratingCount}>({product.reviews_count} reviews)</Text>
            </Text>
          </View>

          <View style={styles.priceCard}>
            <View>
              <Text style={styles.priceNzd}>{formatNZD(product.price_nzd)} NZD</Text>
              <Text style={styles.priceInr}>Inclusive of seller pricing</Text>
            </View>
            <View style={styles.discountTag}>
              <Text style={styles.discountText}>Direct import</Text>
            </View>
          </View>

          <View style={styles.factsCard}>
            <Fact icon={<Truck size={16} color={colors.primary} />} title="Shipping to NZ" value={`${product.shipping_days_min}-${product.shipping_days_max} days`} />
            <View style={styles.divider} />
            <Fact icon={<Globe2 size={16} color={colors.primary} />} title="Ships from" value={product.origin} />
            <View style={styles.divider} />
            <Fact icon={<ShieldCheck size={16} color={colors.primary} />} title="Buyer protection" value="Refund if not as described" />
          </View>

          {/* Stock indicator */}
          {outOfStock ? (
            <View style={styles.stockBanner} testID="product-out-of-stock">
              <PackageX size={16} color={colors.error} />
              <Text style={styles.stockBannerText}>Out of stock</Text>
            </View>
          ) : lowStock ? (
            <View style={styles.stockLow} testID="product-low-stock">
              <Text style={styles.stockLowText}>
                Only {product.stock_count} left in stock — order soon
              </Text>
            </View>
          ) : (
            <View style={styles.stockOk} testID="product-in-stock">
              <Text style={styles.stockOkText}>In stock</Text>
            </View>
          )}

          {/* Colors */}
          {product.colors?.length ? (
            <View style={styles.variantSection}>
              <Text style={styles.variantLabel}>
                Color{selectedColor ? ` · ${selectedColor}` : ""}
              </Text>
              <View style={styles.chipsRow}>
                {product.colors.map((c) => {
                  const selected = selectedColor === c;
                  return (
                    <Pressable
                      key={c}
                      testID={`product-color-${c.toLowerCase().replace(/\s/g, "-")}`}
                      onPress={() => setSelectedColor(c)}
                      style={({ pressed }) => [
                        styles.chip,
                        selected && styles.chipSelected,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <View style={[styles.colorDot, { backgroundColor: colorToHex(c) }]} />
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Sizes + Size guide */}
          {product.sizes?.length ? (
            <View style={styles.variantSection}>
              <View style={styles.sizeHeader}>
                <Text style={styles.variantLabel}>
                  Size{selectedSize ? ` · ${selectedSize}` : ""}
                </Text>
                {hasSizeChart ? (
                  <Pressable
                    testID="product-size-guide-btn"
                    onPress={() => setShowSizeGuide(true)}
                    style={({ pressed }) => [styles.sizeGuideLink, pressed && { opacity: 0.7 }]}
                  >
                    <Ruler size={13} color={colors.primary} />
                    <Text style={styles.sizeGuideLinkText}>Size guide</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.chipsRow}>
                {product.sizes.map((s) => {
                  const selected = selectedSize === s;
                  return (
                    <Pressable
                      key={s}
                      testID={`product-size-${s.toLowerCase().replace(/\s/g, "-")}`}
                      onPress={() => setSelectedSize(s)}
                      style={({ pressed }) => [
                        styles.sizeChip,
                        selected && styles.sizeChipSelected,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text
                        style={[styles.sizeChipText, selected && styles.sizeChipTextSelected]}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : hasSizeChart ? (
            <Pressable
              testID="product-size-guide-btn"
              onPress={() => setShowSizeGuide(true)}
              style={({ pressed }) => [styles.standaloneSizeGuide, pressed && { opacity: 0.85 }]}
            >
              <Ruler size={16} color={colors.primary} />
              <Text style={styles.standaloneSizeGuideText}>View size guide (NZ ↔ India)</Text>
            </Pressable>
          ) : null}

          <Text style={styles.sectionTitle}>About this item</Text>
          <Text style={styles.description}>{product.description}</Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.bottomBar}>
        <View style={styles.bottomInner}>
          <View>
            <Text style={styles.bottomLabel}>Total</Text>
            <Text style={styles.bottomPrice}>{formatNZD(product.price_nzd)}</Text>
          </View>
          <Pressable
            testID="product-add-to-cart-btn"
            accessibilityState={{ disabled: adding || outOfStock }}
            disabled={adding || outOfStock}
            onPress={onAdd}
            style={({ pressed }) => [
              styles.cta,
              pressed && { transform: [{ scale: 0.98 }] },
              adding && { opacity: 0.7 },
              added && { backgroundColor: colors.success },
              outOfStock && styles.ctaDisabled,
            ]}
          >
            <ShoppingBag size={18} color="#fff" />
            <Text style={styles.ctaText}>
              {outOfStock
                ? "Out of stock"
                : added
                  ? "Added to cart"
                  : adding
                    ? "Adding…"
                    : "Add to cart"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <SizeGuideModal
        visible={showSizeGuide}
        onClose={() => setShowSizeGuide(false)}
        category={product.category}
        subcategory={product.subcategory}
      />
    </View>
  );
}

/** Map common color names to a hex. Falls back to a neutral grey. */
function colorToHex(name: string): string {
  const m: Record<string, string> = {
    red: "#DC2626",
    maroon: "#7F1D1D",
    orange: "#EA580C",
    saffron: "#F59E0B",
    yellow: "#FACC15",
    green: "#16A34A",
    emerald: "#059669",
    teal: "#0D9488",
    blue: "#2563EB",
    indigo: "#4338CA",
    purple: "#7C3AED",
    pink: "#DB2777",
    black: "#0F172A",
    grey: "#64748B",
    gray: "#64748B",
    white: "#F8FAFC",
    silver: "#94A3B8",
    gold: "#D97706",
    "rose gold": "#F472B6",
    brass: "#A16207",
    "antique brass": "#78350F",
    brown: "#78350F",
    tan: "#A16207",
  };
  return m[name.trim().toLowerCase()] || "#94A3B8";
}

function Fact({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.factTitle}>{title}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted },
  heroWrap: { aspectRatio: 1, backgroundColor: colors.surface },
  hero: { width: "100%", height: "100%" },
  heroOverlay: { position: "absolute", left: 0, right: 0, top: 0, padding: spacing.md },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: spacing.lg },
  category: { fontSize: 11, color: colors.primary, fontWeight: "800", letterSpacing: 1.5 },
  name: { fontSize: 24, fontWeight: "800", color: colors.text, marginTop: 6, letterSpacing: -0.6, lineHeight: 30 },
  sellerLine: { fontSize: 13, color: colors.textMuted, fontWeight: "600", marginTop: 4 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  ratingText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  ratingCount: { color: colors.textMuted, fontWeight: "500" },
  priceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    marginTop: spacing.lg,
  },
  priceNzd: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.6 },
  priceInr: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  discountTag: {
    backgroundColor: colors.text,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  discountText: { color: "#fff", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  factsCard: {
    marginTop: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  fact: { flexDirection: "row", alignItems: "center", padding: spacing.sm, paddingHorizontal: spacing.md, gap: 12 },
  factIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  factTitle: { color: colors.textMuted, fontSize: 12 },
  factValue: { color: colors.text, fontWeight: "700", fontSize: 14, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: spacing.xl, letterSpacing: -0.3 },
  description: { color: colors.textMuted, marginTop: spacing.sm, lineHeight: 22, fontSize: 14 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  bottomInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    gap: spacing.md,
  },
  bottomLabel: { color: colors.textMuted, fontSize: 12 },
  bottomPrice: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  cta: {
    backgroundColor: colors.primary,
    height: 52,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  ctaDisabled: { backgroundColor: colors.textFaint },
  stockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: "#FEE2E2",
    marginTop: spacing.lg,
  },
  stockBannerText: { color: colors.error, fontWeight: "800", fontSize: 13 },
  stockLow: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: "#FEF3C7",
    marginTop: spacing.lg,
  },
  stockLowText: { color: "#92400E", fontWeight: "700", fontSize: 12 },
  stockOk: { marginTop: spacing.lg },
  stockOkText: { color: colors.success, fontWeight: "700", fontSize: 12 },
  variantSection: { marginTop: spacing.lg },
  variantLabel: { fontSize: 13, fontWeight: "800", color: colors.text, marginBottom: 10 },
  sizeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sizeGuideLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  sizeGuideLinkText: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  chipSelected: { borderColor: colors.text, backgroundColor: colors.text },
  chipText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  chipTextSelected: { color: "#fff" },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  sizeChip: {
    minWidth: 48,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  sizeChipSelected: { borderColor: colors.text, backgroundColor: colors.text },
  sizeChipText: { fontSize: 13, color: colors.text, fontWeight: "700" },
  sizeChipTextSelected: { color: "#fff" },
  standaloneSizeGuide: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  standaloneSizeGuideText: { color: colors.primary, fontWeight: "800", fontSize: 13 },
  heroDots: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  heroDotActive: {
    backgroundColor: "#fff",
    width: 18,
  },
  heroCount: {
    position: "absolute",
    top: 16,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  heroCountText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
});
