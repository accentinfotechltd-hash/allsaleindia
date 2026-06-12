import { useRouter } from "expo-router";
import { ChevronLeft, Heart, Trash2 } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCart } from "@/src/contexts/CartContext";
import { useWishlist } from "@/src/contexts/WishlistContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type WishItem = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  category: string;
  rating: number;
  reviews_count: number;
  in_stock: boolean;
  seller_name?: string | null;
  seller_city?: string | null;
  added_at: string;
};

export default function WishlistScreen() {
  const router = useRouter();
  const { formatPrice, info } = useRegion();
  const { add } = useCart();
  const { toggle, refresh } = useWishlist();
  const [items, setItems] = useState<WishItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<WishItem[]>("/wishlist");
      setItems(data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onPullRefresh = () => {
    setRefreshing(true);
    Promise.all([refresh(), load()]);
  };

  const onRemove = async (pid: string) => {
    try {
      await toggle(pid);
      setItems((prev) => prev.filter((p) => p.product_id !== pid));
    } catch {
      // no-op
    }
  };

  const onAddToCart = async (pid: string) => {
    try {
      await add(pid, 1);
    } catch (e) {
      // ignore — context shows alerts where needed
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="wishlist-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>My Wishlist</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Heart size={42} color="#FCA5A5" fill="#FECACA" strokeWidth={1.6} />
          <Text style={styles.emptyTitle}>Your wishlist is empty</Text>
          <Text style={styles.emptySub}>
            Tap the ❤️ on any product to save it for later.
          </Text>
          <Pressable
            onPress={() => router.push("/(tabs)/home")}
            style={styles.cta}
            testID="wishlist-shop-cta"
          >
            <Text style={styles.ctaText}>Start shopping</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.product_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} />
          }
          renderItem={({ item }) => {
            const isLocal = info.currency === "NZD";
            return (
              <Pressable
                testID={`wishlist-card-${item.product_id}`}
                onPress={() => router.push(`/product/${item.product_id}`)}
                style={styles.card}
              >
                <Image source={{ uri: item.image }} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.category}>{item.category.toUpperCase()}</Text>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {item.seller_name ? (
                    <Text style={styles.seller}>by {item.seller_name}</Text>
                  ) : null}
                  <Text style={styles.price}>
                    {isLocal ? formatNZD(item.price_nzd) : formatPrice(item.price_nzd)}{" "}
                    <Text style={styles.currCode}>{info.currency}</Text>
                  </Text>
                  {!item.in_stock ? (
                    <Text style={styles.oos}>Out of stock</Text>
                  ) : null}
                  <View style={styles.cardActions}>
                    <Pressable
                      disabled={!item.in_stock}
                      testID={`wishlist-add-${item.product_id}`}
                      onPress={() => onAddToCart(item.product_id)}
                      style={[
                        styles.addBtn,
                        !item.in_stock && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={styles.addBtnText}>Add to cart</Text>
                    </Pressable>
                    <Pressable
                      testID={`wishlist-remove-${item.product_id}`}
                      onPress={() => onRemove(item.product_id)}
                      style={styles.rmBtn}
                      hitSlop={6}
                    >
                      <Trash2 size={16} color={colors.error} />
                    </Pressable>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 10 },
  emptyTitle: { fontWeight: "800", fontSize: 18, color: colors.text, marginTop: spacing.md },
  emptySub: { color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  cta: { backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, marginTop: spacing.md },
  ctaText: { color: "#fff", fontWeight: "800" },
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  thumb: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surface },
  category: { fontSize: 10, fontWeight: "800", color: colors.primary, letterSpacing: 1 },
  name: { fontWeight: "700", color: colors.text, fontSize: 14, marginTop: 4, lineHeight: 18 },
  seller: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  price: { fontWeight: "800", color: colors.text, fontSize: 15, marginTop: 6 },
  currCode: { color: colors.textFaint, fontWeight: "700", fontSize: 10, letterSpacing: 0.5 },
  oos: { color: colors.error, fontWeight: "700", fontSize: 11, marginTop: 2 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  addBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  rmBtn: { padding: 6 },
});
