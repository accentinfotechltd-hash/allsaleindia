import { useRouter } from "expo-router";
import { Plus, RotateCcw, ShoppingCart } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { useCart } from "@/src/contexts/CartContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type BuyItAgainItem = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  price_inr: number;
  category: string;
  rating?: number;
  reviews_count?: number;
  seller_name?: string | null;
  times_purchased: number;
  last_purchased_at?: string | null;
};

/**
 * Buy-it-again horizontal rail — surfaces products from the buyer's past
 * **delivered** orders, sorted by most-recently bought first. One-tap
 * "Add to cart" on every card to drive repeat purchases.
 *
 * • Renders nothing if user is logged out or has no qualifying orders.
 * • Out-of-stock products are filtered server-side.
 * • Each card shows a small "Bought N×" badge if the product was reordered
 *   before, which is a strong social proof for the buyer themselves.
 */
export default function BuyItAgainRail({ limit = 12 }: { limit?: number }) {
  const router = useRouter();
  const { user } = useAuth();
  const { add } = useCart();
  const { info, formatPrice } = useRegion();
  const { show } = useToast();
  const [items, setItems] = useState<BuyItAgainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const resp = await api<{ items: BuyItAgainItem[] }>(
        `/orders/buy-it-again?limit=${limit}`,
      );
      setItems(resp.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user, limit]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;
  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.primary} size="small" />
      </View>
    );
  }
  if (!items.length) return null;

  const onAdd = async (pid: string) => {
    setAdding(pid);
    try {
      await add(pid, 1);
      show({ title: "Added to cart", kind: "success" });
    } catch (e: any) {
      show({ title: e?.message || "Couldn't add", kind: "error" });
    } finally {
      setAdding(null);
    }
  };

  return (
    <View style={styles.wrap} testID="buy-it-again-rail">
      <View style={styles.header}>
        <RotateCcw size={14} color={colors.primary} />
        <Text style={styles.title}>Buy it again</Text>
        <Text style={styles.subtitle}>
          From your past orders
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {items.map((p) => {
          const isLocal = info.currency === "NZD";
          const price = isLocal ? formatNZD(p.price_nzd) : formatPrice(p.price_nzd);
          return (
            <Pressable
              key={p.id}
              testID={`buy-it-again-card-${p.id}`}
              onPress={() => router.push(`/product/${p.id}`)}
              style={({ pressed }) => [
                styles.card,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={{ position: "relative" }}>
                <Image source={{ uri: p.image }} style={styles.thumb} />
                {p.times_purchased > 1 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Bought {p.times_purchased}×</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.name} numberOfLines={2}>
                {p.name}
              </Text>
              <Text style={styles.price} numberOfLines={1}>
                {price}{" "}
                <Text style={styles.currCode}>{info.currency}</Text>
              </Text>
              <Pressable
                testID={`buy-it-again-add-${p.id}`}
                disabled={adding === p.id}
                onPress={() => onAdd(p.id)}
                style={({ pressed }) => [
                  styles.addBtn,
                  pressed && { opacity: 0.85 },
                  adding === p.id && { opacity: 0.55 },
                ]}
              >
                {adding === p.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Plus size={12} color="#fff" />
                    <Text style={styles.addBtnText}>Add</Text>
                  </>
                )}
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  loadingWrap: { padding: spacing.sm, alignItems: "flex-start" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  title: {
    fontWeight: "800",
    fontSize: 16,
    color: colors.text,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 11,
    marginLeft: 4,
    fontStyle: "italic",
  },
  scroller: {
    paddingHorizontal: spacing.lg,
    gap: 10,
  },
  card: {
    width: 140,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: {
    width: "100%",
    height: 100,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  badge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  name: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    marginTop: 8,
    lineHeight: 15,
    minHeight: 30,
  },
  price: {
    fontWeight: "800",
    fontSize: 13,
    color: colors.text,
    marginTop: 4,
  },
  currCode: {
    color: colors.textFaint,
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.3,
  },
  addBtn: {
    marginTop: 8,
    backgroundColor: colors.primary,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  addBtnText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 11,
  },
});
