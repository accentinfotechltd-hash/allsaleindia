import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useRegion } from "@/src/contexts/RegionContext";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

export type ProductLite = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  category: string;
  rating?: number;
  reviews_count?: number;
  seller_name?: string | null;
  seller_city?: string | null;
};

export function ProductCard({
  product,
  onPress,
  width,
}: {
  product: ProductLite;
  onPress: () => void;
  width: number;
}) {
  const { info, formatPrice } = useRegion();
  const isLocal = info.currency === "NZD";
  return (
    <Pressable
      testID={`product-card-${product.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { width }, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <View style={styles.imageWrap}>
        <Image source={{ uri: product.image }} style={styles.image} />
      </View>
      <View style={styles.body}>
        <Text style={styles.category} numberOfLines={1}>
          {product.category.toUpperCase()}
        </Text>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        {product.seller_name || product.seller_city ? (
          <Text style={styles.seller} numberOfLines={1}>
            by {product.seller_name || "Seller"}
            {product.seller_city ? ` · ${product.seller_city}` : ""}
          </Text>
        ) : null}
        <View style={styles.priceRow}>
          <Text style={styles.priceNzd}>
            {isLocal ? formatNZD(product.price_nzd) : formatPrice(product.price_nzd)}
          </Text>
          <Text style={styles.priceLabel}>{info.currency}</Text>
        </View>
        {!isLocal ? (
          <Text style={styles.priceNzdSub}>NZ${product.price_nzd.toFixed(2)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  imageWrap: { aspectRatio: 1, backgroundColor: colors.surface },
  image: { width: "100%", height: "100%" },
  body: { padding: spacing.md, gap: 4 },
  category: { fontSize: 10, fontWeight: "700", color: colors.primary, letterSpacing: 1 },
  name: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 18, minHeight: 36 },
  seller: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  priceNzd: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  priceLabel: { fontSize: 10, color: colors.textFaint, fontWeight: "700", letterSpacing: 0.5 },
  priceNzdSub: { fontSize: 10, color: colors.textFaint, fontWeight: "600", marginTop: 2 },
});
