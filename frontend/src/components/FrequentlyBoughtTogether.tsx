/**
 * "Frequently Bought Together" — Amazon-style bundle widget on the
 * Product Detail Page.
 *
 * Renders the anchor product image + a `+` separator + each FBT item
 * with a checkbox. Each checkbox is selected by default; the buyer can
 * uncheck items they don't want. The footer shows the running total
 * and an "Add N items to cart" CTA that calls `addToCart()` per
 * selected item.
 *
 * Data source: `/products/{id}/frequently-bought-together` which
 * computes co-purchase frequency from real paid orders, falling back
 * to same-category top-rated picks when there's no historical signal
 * yet. The `source` field in the response drives the section copy
 * ("Frequently bought together" vs "Pairs well with").
 */
import { useRouter } from "expo-router";
import { Check, Plus, ShoppingBag } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useCart } from "@/src/contexts/CartContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type FBTItem = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  rating: number;
  reviews_count: number;
  in_stock: boolean;
  frequency: number;
};

type Anchor = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
};

type FBTResponse = {
  anchor: Anchor;
  items: FBTItem[];
  bundle_count: number;
  bundle_total_nzd: number;
  source: "order_history" | "category_fallback" | "empty";
};

export default function FrequentlyBoughtTogether({
  productId,
}: {
  productId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { add } = useCart();
  const { formatPrice, info } = useRegion();
  const [data, setData] = useState<FBTResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const d = await api<FBTResponse>(
          `/products/${productId}/frequently-bought-together?limit=3`,
          { auth: false }
        );
        if (cancelled) return;
        setData(d);
        // Default-select all FBT items (anchor is always implicit, no checkbox)
        setSelected(new Set(d.items.map((it) => it.id)));
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onAddBundle = useCallback(async () => {
    if (!data || selected.size === 0) return;
    setAdding(true);
    try {
      // Cart context's `add(productId, qty?)` adds (or increments) a line.
      // We loop sequentially so the server's stock check runs in order.
      for (const it of data.items) {
        if (!selected.has(it.id)) continue;
        await add(it.id, 1);
      }
      toast.show({
        title: `${selected.size} item${selected.size === 1 ? "" : "s"} added to cart`,
        kind: "success",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't add bundle";
      toast.show({ title: msg, kind: "error" });
    } finally {
      setAdding(false);
    }
  }, [data, selected, add, toast]);

  if (loading) {
    return (
      <View style={styles.loading} testID="fbt-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!data || data.items.length === 0) return null;

  const isLocal = info.currency === "NZD";
  const fmt = (n: number) => (isLocal ? formatNZD(n) : formatPrice(n));

  // Recompute total based on user selection (anchor is always included).
  const liveTotal =
    data.anchor.price_nzd +
    data.items
      .filter((it) => selected.has(it.id))
      .reduce((sum, it) => sum + it.price_nzd, 0);

  const heading =
    data.source === "order_history"
      ? "Frequently bought together"
      : "Pairs well with";

  return (
    <View style={styles.wrap} testID="fbt-section">
      <View style={styles.headerRow}>
        <ShoppingBag size={16} color={colors.primary} />
        <Text style={styles.heading}>{heading}</Text>
      </View>

      {/* Visual bundle: anchor + plus + items (image strip) */}
      <View style={styles.bundleStrip}>
        <Tile image={data.anchor.image} anchor />
        {data.items.map((it) => (
          <View key={it.id} style={styles.tileGroup}>
            <View style={styles.plusBubble}>
              <Plus size={12} color={colors.textMuted} />
            </View>
            <Tile
              image={it.image}
              dimmed={!selected.has(it.id)}
              onPress={() => router.push(`/product/${it.id}`)}
            />
          </View>
        ))}
      </View>

      {/* Checkbox list with anchor row + each item */}
      <View style={styles.checkList}>
        <View style={styles.checkRow}>
          <View style={[styles.checkbox, styles.checkboxOn, styles.checkboxLocked]}>
            <Check size={12} color="#fff" />
          </View>
          <Text style={styles.checkLabel} numberOfLines={1}>
            This item:{" "}
            <Text style={{ fontWeight: "700" }}>{data.anchor.name}</Text>
          </Text>
          <Text style={styles.checkPrice}>{fmt(data.anchor.price_nzd)}</Text>
        </View>
        {data.items.map((it) => {
          const isChecked = selected.has(it.id);
          return (
            <Pressable
              key={it.id}
              testID={`fbt-row-${it.id}`}
              onPress={() => toggle(it.id)}
              style={({ pressed }) => [
                styles.checkRow,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View
                style={[styles.checkbox, isChecked && styles.checkboxOn]}
              >
                {isChecked ? <Check size={12} color="#fff" /> : null}
              </View>
              <Text style={styles.checkLabel} numberOfLines={2}>
                {it.name}
              </Text>
              <Text style={styles.checkPrice}>{fmt(it.price_nzd)}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Total + CTA */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.totalLabel}>Total price</Text>
          <Text style={styles.totalValue} testID="fbt-total">
            {fmt(liveTotal)}
          </Text>
        </View>
        <Pressable
          testID="fbt-add-bundle"
          disabled={selected.size === 0 || adding}
          onPress={onAddBundle}
          style={[
            styles.ctaBtn,
            (selected.size === 0 || adding) && styles.ctaBtnDisabled,
          ]}
        >
          {adding ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.ctaText}>
              Add {selected.size} item{selected.size === 1 ? "" : "s"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function Tile({
  image,
  anchor,
  dimmed,
  onPress,
}: {
  image: string;
  anchor?: boolean;
  dimmed?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <View
      style={[
        styles.tile,
        anchor && styles.tileAnchor,
        dimmed && { opacity: 0.4 },
      ]}
    >
      <Image source={{ uri: image }} style={styles.tileImg} />
      {anchor ? (
        <View style={styles.anchorBadge}>
          <Text style={styles.anchorBadgeText}>This</Text>
        </View>
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress}>{content}</Pressable>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  loading: { padding: spacing.md, alignItems: "center" },
  wrap: { marginTop: spacing.xl, gap: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heading: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  bundleStrip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    gap: 0,
  },
  tileGroup: { flexDirection: "row", alignItems: "center" },
  tile: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    position: "relative",
  },
  tileAnchor: { borderColor: colors.primary, borderWidth: 2 },
  tileImg: { width: "100%", height: "100%" },
  anchorBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  anchorBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  plusBubble: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 6,
  },
  checkList: {
    gap: 4,
    paddingTop: spacing.xs,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxLocked: { opacity: 0.85 },
  checkLabel: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    lineHeight: 17,
  },
  checkPrice: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  ctaBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.text,
    minWidth: 140,
    alignItems: "center",
  },
  ctaBtnDisabled: { opacity: 0.4 },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
