/**
 * "Browse all categories" tile mosaic for the Search screen empty state.
 *
 * Pulls every top-level category from `/categories/tiles` and renders a
 * 2-column visual grid (image + name + subcategory count). Tapping a tile
 * pushes `/category/{name}`, which itself renders the subcategory tile
 * grid — same look-and-feel pattern as Amazon's "Shop by department"
 * mosaic on iOS / Android.
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

export type CategoryTile = {
  name: string;
  blurb: string;
  subcategory_count: number;
  product_count: number;
  sample_image: string | null;
};

type Response = { tiles: CategoryTile[] };

export default function CategoryTileGrid() {
  const router = useRouter();
  const [tiles, setTiles] = useState<CategoryTile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<Response>("/categories/tiles", {
          auth: false,
        });
        if (!cancelled) setTiles(data.tiles || []);
      } catch {
        if (!cancelled) setTiles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.loading} testID="category-tiles-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (tiles.length === 0) return null;

  return (
    <View style={styles.wrap} testID="category-tile-grid">
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Browse all categories</Text>
        <Text style={styles.headingSub}>{tiles.length} departments</Text>
      </View>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <Pressable
            key={t.name}
            testID={`category-tile-${t.name.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and").replace(/'/g, "")}`}
            onPress={() =>
              router.push({
                pathname: "/category/[name]",
                params: { name: t.name },
              })
            }
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.thumbWrap}>
              {t.sample_image ? (
                <Image source={{ uri: t.sample_image }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbPlaceholderText}>
                    {t.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.gradient} />
              <Text style={styles.tileTitle} numberOfLines={2}>
                {t.name}
              </Text>
            </View>
            <View style={styles.footer}>
              <Text style={styles.footerMeta} numberOfLines={1}>
                {t.subcategory_count} section
                {t.subcategory_count === 1 ? "" : "s"}
                {t.product_count > 0 ? ` · ${t.product_count} item${t.product_count === 1 ? "" : "s"}` : ""}
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
  wrap: { gap: spacing.sm, paddingTop: spacing.sm },
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP },
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
    aspectRatio: 4 / 3,
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
  // Soft gradient overlay so the white tile title pops on busy photos.
  gradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  tileTitle: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 8,
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.3,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  footerMeta: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "600",
  },
});
