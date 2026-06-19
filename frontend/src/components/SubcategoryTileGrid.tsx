/**
 * Amazon-style "Shop by subcategory" tile grid.
 *
 * Renders a 2-column grid of square tiles, each showing the subcategory
 * thumbnail (sample product image) + name + live product count.
 *
 * Tapping a tile navigates to `/category/{categoryName}/{subcategoryName}`,
 * a dedicated, deep-linkable subcategory page (mirrors the legacy
 * subcategory chip behaviour but with its own URL + back stack entry).
 */
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export type SubcategoryTile = {
  name: string;
  product_count: number;
  sample_image: string | null;
};

type Response = {
  category: string;
  blurb: string;
  subcategories: SubcategoryTile[];
};

export default function SubcategoryTileGrid({
  category,
}: {
  category: string;
}) {
  const router = useRouter();
  const [tiles, setTiles] = useState<SubcategoryTile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await api<Response>(
          `/categories/${encodeURIComponent(category)}/subcategories`,
          { auth: false }
        );
        if (!cancelled) setTiles(data.subcategories || []);
      } catch {
        if (!cancelled) setTiles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category]);

  if (loading) {
    return (
      <View style={styles.loading} testID="subcat-tiles-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (tiles.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Shop by subcategory</Text>
        <Text style={styles.headingSub}>{tiles.length} sections</Text>
      </View>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <Pressable
            key={t.name}
            testID={`subcat-tile-${t.name.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and")}`}
            onPress={() =>
              router.push({
                pathname: "/category/[name]/[subcategory]",
                params: { name: category, subcategory: t.name },
              })
            }
            style={({ pressed }) => [
              styles.tile,
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={styles.thumbWrap}>
              {t.sample_image ? (
                <Image source={{ uri: t.sample_image }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbPlaceholderText}>
                    {t.name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              {t.product_count > 0 ? (
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{t.product_count}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.label}>
              <Text style={styles.tileName} numberOfLines={2}>
                {t.name}
              </Text>
              <ChevronRight size={14} color={colors.textMuted} />
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const TILE_GAP = 12;

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  loading: { padding: spacing.lg, alignItems: "center" },
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  heading: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  headingSub: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: TILE_GAP,
  },
  tile: {
    width: `48%` as const,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  thumbWrap: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: colors.surface,
    position: "relative",
  },
  thumb: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  thumbPlaceholderText: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.primary,
    letterSpacing: -0.5,
  },
  countPill: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  label: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  tileName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 17,
  },
});
