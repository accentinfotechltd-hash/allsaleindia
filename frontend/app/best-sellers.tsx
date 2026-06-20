/**
 * Best Sellers leaderboard — Amazon-style category top-50.
 *
 * Header sticky chips let buyers switch between "All categories" and any
 * top-level category. Each row shows a rank badge (#1, #2, ...), the
 * product image + name + rating + price, and a "Bestseller" ribbon on
 * top-3. Tapping a row → /product/{id}. The server may surface either
 * window_sales-ranked items or rating-fallback (when no recent sales) —
 * we show a small inline banner explaining which is active.
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  Star,
  Trophy,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { fetchTaxonomy, type TaxonomyNode } from "@/src/lib/nz";
import { useRegion } from "@/src/contexts/RegionContext";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Row = {
  rank: number;
  units_sold_window: number;
  product: {
    id: string;
    name: string;
    image: string;
    price_nzd: number;
    rating?: number;
    reviews_count?: number;
    category?: string;
    seller_name?: string;
  };
};

type Response = {
  category: string | null;
  window_days: number;
  source: "window_sales" | "rating_fallback";
  count: number;
  items: Row[];
};

export default function BestSellersScreen() {
  const router = useRouter();
  const { category: paramCategory } = useLocalSearchParams<{
    category?: string;
  }>();
  const { formatPrice, info } = useRegion();
  const [data, setData] = useState<Response | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(
    paramCategory ? String(paramCategory) : null
  );
  const [loading, setLoading] = useState(true);

  // Pre-load taxonomy once for the category chips.
  useEffect(() => {
    fetchTaxonomy().then((nodes: TaxonomyNode[]) => {
      setCategories(nodes.map((n) => n.name));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = selected
        ? `?category=${encodeURIComponent(selected)}&limit=50`
        : "?limit=50";
      const d = await api<Response>(`/best-sellers${q}`, { auth: false });
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const isLocal = info.currency === "NZD";
  const fmt = (n: number) => (isLocal ? formatNZD(n) : formatPrice(n));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="bestsellers-back"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={styles.title}>Best Sellers</Text>
          <Text style={styles.subtitle}>
            {selected
              ? `Top in ${selected}`
              : `Top across the marketplace`}
          </Text>
        </View>
        <View style={styles.trophyBubble}>
          <Trophy size={20} color="#D97706" />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        <Chip
          label="All"
          active={selected === null}
          onPress={() => setSelected(null)}
          testID="bestseller-chip-all"
        />
        {categories.map((c) => (
          <Chip
            key={c}
            label={c}
            active={selected === c}
            onPress={() => setSelected(c)}
            testID={`bestseller-chip-${c.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and")}`}
          />
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(r) => `${r.rank}-${r.product.id}`}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
            gap: 10,
          }}
          ListHeaderComponent={
            data && data.source === "rating_fallback" ? (
              <View style={styles.fallbackBanner}>
                <Text style={styles.fallbackText}>
                  No recent sales yet — showing all-time top-rated. Check
                  back as orders flow in.
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Trophy size={36} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No best sellers here yet</Text>
              <Text style={styles.emptySub}>
                Pick another category or check back soon.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`bestseller-row-${item.product.id}`}
              onPress={() => router.push(`/product/${item.product.id}`)}
              style={({ pressed }) => [
                styles.row,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.rankWrap}>
                <Text
                  style={[
                    styles.rankNum,
                    item.rank <= 3 && styles.rankNumTop3,
                  ]}
                >
                  #{item.rank}
                </Text>
                {item.rank <= 3 ? (
                  <View style={styles.rankRibbon}>
                    <Text style={styles.rankRibbonText}>Bestseller</Text>
                  </View>
                ) : null}
              </View>
              <Image
                source={{ uri: item.product.image }}
                style={styles.thumb}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.name} numberOfLines={2}>
                  {item.product.name}
                </Text>
                {item.product.seller_name ? (
                  <Text style={styles.seller} numberOfLines={1}>
                    by {item.product.seller_name}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {item.product.rating ? (
                    <View style={styles.ratingBlock}>
                      <Star size={11} color="#F59E0B" fill="#F59E0B" />
                      <Text style={styles.ratingText}>
                        {item.product.rating.toFixed(1)}
                        {item.product.reviews_count
                          ? ` (${item.product.reviews_count})`
                          : ""}
                      </Text>
                    </View>
                  ) : null}
                  {item.units_sold_window > 0 ? (
                    <Text style={styles.soldText}>
                      {item.units_sold_window} sold
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.price}>{fmt(item.product.price_nzd)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
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
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  trophyBubble: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  chipsRow: {
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackBanner: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FEF9C3",
    borderWidth: 1,
    borderColor: "#FDE68A",
    marginBottom: spacing.sm,
  },
  fallbackText: { fontSize: 11, color: "#854D0E", fontWeight: "700" },
  empty: {
    paddingTop: 60,
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
  },
  row: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  rankWrap: {
    width: 48,
    alignItems: "center",
    gap: 4,
  },
  rankNum: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: -0.8,
  },
  rankNumTop3: { color: "#D97706" },
  rankRibbon: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  rankRibbonText: {
    fontSize: 8,
    fontWeight: "800",
    color: "#854D0E",
    letterSpacing: 0.3,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  name: { fontWeight: "700", color: colors.text, fontSize: 13, lineHeight: 17 },
  seller: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  ratingBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  ratingText: {
    fontSize: 11,
    color: colors.text,
    fontWeight: "700",
  },
  soldText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "700",
  },
  price: {
    fontWeight: "800",
    color: colors.text,
    fontSize: 15,
    letterSpacing: -0.3,
    marginTop: 2,
  },
});
