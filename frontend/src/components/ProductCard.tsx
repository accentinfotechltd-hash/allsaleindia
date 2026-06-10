import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, formatINR, formatNZD, radius, spacing } from "@/src/lib/theme";

export type ProductLite = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  category: string;
  rating?: number;
  reviews_count?: number;
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
        <View style={styles.priceRow}>
          <Text style={styles.priceNzd}>{formatNZD(product.price_nzd)}</Text>
          <Text style={styles.priceInr}>{formatINR(product.price_inr)}</Text>
        </View>
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
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 },
  priceNzd: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  priceInr: { fontSize: 11, color: colors.textFaint },
});
