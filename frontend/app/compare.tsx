import { useRouter } from "expo-router";
import { ChevronLeft, ShoppingCart, Trash2, X } from "lucide-react-native";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useCart } from "@/src/contexts/CartContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { api } from "@/src/lib/api";
import {
  clearCompare,
  getCompareIds,
  toggleCompare,
} from "@/src/lib/compare";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type CompareProduct = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  category: string;
  rating?: number;
  reviews_count?: number;
  in_stock?: boolean;
  stock_count?: number;
  seller_name?: string | null;
  seller_city?: string | null;
};

const ROWS: { key: keyof CompareProduct | "_stock"; label: string }[] = [
  { key: "category", label: "Category" },
  { key: "price_nzd", label: "Price" },
  { key: "rating", label: "Rating" },
  { key: "reviews_count", label: "Reviews" },
  { key: "_stock", label: "Stock" },
  { key: "seller_name", label: "Seller" },
  { key: "seller_city", label: "Ships from" },
];

export default function CompareScreen() {
  const router = useRouter();
  const { add } = useCart();
  const { info, formatPrice } = useRegion();
  const { show } = useToast();
  const [items, setItems] = useState<CompareProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await getCompareIds();
      if (!ids.length) {
        setItems([]);
        return;
      }
      const fetched = await Promise.all(
        ids.map((id) => api<CompareProduct>(`/products/${id}`).catch(() => null)),
      );
      setItems(fetched.filter((p): p is CompareProduct => !!p));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRemove = async (id: string) => {
    await toggleCompare(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  const onClearAll = async () => {
    await clearCompare();
    setItems([]);
  };

  const renderCell = (p: CompareProduct, row: typeof ROWS[number]) => {
    if (row.key === "price_nzd") {
      return info.currency === "NZD"
        ? formatNZD(p.price_nzd)
        : formatPrice(p.price_nzd);
    }
    if (row.key === "_stock") {
      const ok = (p.stock_count ?? 0) > 0 && p.in_stock !== false;
      return ok ? "In stock" : "Out of stock";
    }
    const val = (p as any)[row.key];
    if (val == null || val === "") return "—";
    if (row.key === "rating") return `★ ${Number(val).toFixed(1)}`;
    return String(val);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={8}
          testID="compare-back"
        >
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Compare ({items.length})</Text>
        {items.length > 0 ? (
          <Pressable
            onPress={onClearAll}
            style={styles.iconBtn}
            hitSlop={8}
            testID="compare-clear-all"
          >
            <Trash2 size={18} color={colors.error} />
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing to compare yet</Text>
          <Text style={styles.emptyBody}>
            Tap "Add to compare" on any product to start a side-by-side
            comparison (up to 4 items).
          </Text>
          <Pressable
            onPress={() => router.push("/(tabs)/home")}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>Browse products</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: spacing.md, gap: 10 }}
        >
          {items.map((p) => (
            <View key={p.id} style={styles.col} testID={`compare-col-${p.id}`}>
              <Pressable
                onPress={() => onRemove(p.id)}
                style={styles.removeBtn}
                testID={`compare-remove-${p.id}`}
                hitSlop={6}
              >
                <X size={14} color={colors.error} />
              </Pressable>
              <Pressable onPress={() => router.push(`/product/${p.id}`)}>
                <Image source={{ uri: p.image }} style={styles.thumb} />
                <Text style={styles.name} numberOfLines={2}>
                  {p.name}
                </Text>
              </Pressable>

              {ROWS.map((row) => (
                <View key={row.key} style={styles.row}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue} numberOfLines={2}>
                    {renderCell(p, row)}
                  </Text>
                </View>
              ))}

              <Pressable
                onPress={async () => {
                  try {
                    await add(p.id, 1);
                    show({ title: "Added to cart", kind: "success" });
                  } catch (e: any) {
                    show({ title: e?.message || "Couldn't add", kind: "error" });
                  }
                }}
                style={styles.addBtn}
                testID={`compare-add-${p.id}`}
                disabled={(p.stock_count ?? 0) <= 0}
              >
                <ShoppingCart size={14} color="#fff" />
                <Text style={styles.addBtnText}>Add to cart</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
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
    backgroundColor: "#fff",
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: spacing.xl, gap: 10,
  },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 18 },
  emptyBody: { color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  cta: { backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, marginTop: spacing.md },
  ctaText: { color: "#fff", fontWeight: "800" },

  col: {
    width: 200,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    position: "relative",
  },
  removeBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  thumb: { width: "100%", height: 130, borderRadius: radius.sm, backgroundColor: colors.surface },
  name: { fontWeight: "800", color: colors.text, fontSize: 13, marginTop: 6, lineHeight: 16, minHeight: 32 },
  row: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
  rowValue: { color: colors.text, fontSize: 12, fontWeight: "600", marginTop: 2 },
  addBtn: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: colors.primary,
    paddingVertical: 9,
    borderRadius: 999,
  },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
});
