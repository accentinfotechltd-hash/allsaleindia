import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Globe2, ShieldCheck, ShoppingBag, Star, Truck } from "lucide-react-native";
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

import { useCart } from "@/src/contexts/CartContext";
import { api } from "@/src/lib/api";
import { colors, formatINR, formatNZD, radius, spacing } from "@/src/lib/theme";

type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  price_nzd: number;
  price_inr: number;
  image: string;
  rating: number;
  reviews_count: number;
  shipping_days_min: number;
  shipping_days_max: number;
  origin: string;
};

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { add } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const p = await api<Product>(`/products/${id}`, { auth: false });
        setProduct(p);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onAdd = async () => {
    if (!product) return;
    setAdding(true);
    try {
      await add(product.id, 1);
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    } catch {
      // ignored
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
          <Image source={{ uri: product.image }} style={styles.hero} />
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
            disabled={adding}
            onPress={onAdd}
            style={({ pressed }) => [
              styles.cta,
              pressed && { transform: [{ scale: 0.98 }] },
              adding && { opacity: 0.7 },
              added && { backgroundColor: colors.success },
            ]}
          >
            <ShoppingBag size={18} color="#fff" />
            <Text style={styles.ctaText}>{added ? "Added to cart" : adding ? "Adding…" : "Add to cart"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
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
});
