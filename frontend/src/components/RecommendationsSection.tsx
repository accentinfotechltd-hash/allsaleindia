import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Sparkles, Star } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { useRegion } from "@/src/contexts/RegionContext";
import WishlistButton from "@/src/components/WishlistButton";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Product = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  category: string;
  rating?: number;
  reviews_count?: number;
};

export default function RecommendationsSection({ productId }: { productId: string }) {
  const router = useRouter();
  const { formatPrice, info } = useRegion();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<Product[]>(`/products/${productId}/recommendations?limit=8`, { auth: false });
      setItems(d || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap} testID="recommendations-section">
      <View style={styles.headerRow}>
        <Sparkles size={16} color={colors.primary} />
        <Text style={styles.heading}>You may also like</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroller}>
        {items.map((p) => {
          const isLocal = info.currency === "NZD";
          return (
            <Pressable
              key={p.id}
              testID={`rec-${p.id}`}
              onPress={() => router.push(`/product/${p.id}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.imgWrap}>
                <Image source={{ uri: p.image }} style={styles.img} />
                <WishlistButton productId={p.id} size={14} />
              </View>
              <Text style={styles.name} numberOfLines={2}>{p.name}</Text>
              {(p.rating || 0) > 0 ? (
                <View style={styles.ratingRow}>
                  <Star size={11} color="#F59E0B" fill="#F59E0B" />
                  <Text style={styles.ratingText}>
                    {p.rating?.toFixed(1)}
                    {p.reviews_count ? ` (${p.reviews_count})` : ""}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.price}>
                {isLocal ? formatNZD(p.price_nzd) : formatPrice(p.price_nzd)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { padding: spacing.lg, alignItems: "center" },
  wrap: { marginTop: spacing.xl, gap: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  scroller: { gap: spacing.sm, paddingTop: spacing.sm, paddingRight: spacing.lg },
  card: { width: 140, gap: 4 },
  imgWrap: { position: "relative" },
  img: { width: "100%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  name: { color: colors.text, fontWeight: "700", fontSize: 12, marginTop: 6, minHeight: 32, lineHeight: 16 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  price: { fontWeight: "800", color: colors.text, fontSize: 14, marginTop: 2 },
});
