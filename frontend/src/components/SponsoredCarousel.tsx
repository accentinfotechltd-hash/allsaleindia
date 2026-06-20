/**
 * SponsoredCarousel — horizontal product list of paid placements.
 *
 * - Fetches `/api/sponsored/slots?placement=&category=&limit=` once on mount.
 * - Fires impression beacons (best-effort, fire-and-forget) one second after
 *   render so quick scroll-pasts don't inflate counts.
 * - Fires click beacons on tap before navigating to the PDP.
 * - Renders nothing when there are no slots (clean home page).
 *
 * Designed to be drop-in usable from any screen — pass a placement and
 * optionally a category filter for category pages.
 */
import { useRouter } from "expo-router";
import { Info } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Placement = "home" | "category" | "search" | "pdp";

type SlotItem = {
  campaign_id: string;
  placement: Placement;
  product: {
    id: string;
    name: string;
    image: string;
    price_nzd: number;
    category?: string;
    rating?: number;
    reviews_count?: number;
    seller_name?: string | null;
  };
};

export default function SponsoredCarousel({
  placement,
  category,
  title = "Sponsored",
  limit = 4,
}: {
  placement: Placement;
  category?: string;
  title?: string;
  limit?: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<SlotItem[] | null>(null);
  const beaconedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const url = `/sponsored/slots?placement=${placement}&limit=${limit}` +
      (category ? `&category=${encodeURIComponent(category)}` : "");
    api<{ items: SlotItem[] }>(url)
      .then((d) => {
        if (cancelled) return;
        setItems(d.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [placement, category, limit]);

  // Impression beacons (one per campaign, after 1s settle)
  useEffect(() => {
    if (!items || items.length === 0) return;
    const timer = setTimeout(() => {
      for (const it of items) {
        if (beaconedRef.current.has(it.campaign_id)) continue;
        beaconedRef.current.add(it.campaign_id);
        api("/sponsored/track/impression", {
          method: "POST",
          body: {
            campaign_id: it.campaign_id,
            product_id: it.product.id,
            placement: it.placement,
          },
        }).catch(() => {
          // Best-effort — ignore tracking failures
        });
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [items]);

  const onTap = useCallback(
    (it: SlotItem) => {
      // Click beacon — fire-and-forget so navigation feels instant
      api("/sponsored/track/click", {
        method: "POST",
        body: {
          campaign_id: it.campaign_id,
          product_id: it.product.id,
          placement: it.placement,
        },
      }).catch(() => {});
      router.push(`/product/${it.product.id}`);
    },
    [router]
  );

  if (!items || items.length === 0) {
    return null; // Render nothing if no paid slots — keeps the surface clean
  }

  return (
    <View style={styles.wrap} testID={`sponsored-carousel-${placement}`}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.helpDot}>
          <Info size={11} color={colors.textMuted} />
          <Text style={styles.helpText}>Paid placements by sellers</Text>
        </View>
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={items}
        keyExtractor={(it) => it.campaign_id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            testID={`sponsored-card-${item.product.id}`}
            onPress={() => onTap(item)}
            style={({ pressed }) => [
              styles.card,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={styles.imageWrap}>
              <Image
                source={{ uri: item.product.image }}
                style={styles.image}
              />
              <View style={styles.adBadge}>
                <Text style={styles.adBadgeText}>Sponsored</Text>
              </View>
            </View>
            <Text style={styles.cardName} numberOfLines={2}>
              {item.product.name}
            </Text>
            <Text style={styles.cardPrice}>
              ${item.product.price_nzd.toFixed(2)}
            </Text>
            {item.product.seller_name ? (
              <Text style={styles.cardSeller} numberOfLines={1}>
                {item.product.seller_name}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginBottom: 8,
  },
  title: { fontWeight: "800", color: colors.text, fontSize: 15 },
  helpDot: { flexDirection: "row", alignItems: "center", gap: 4 },
  helpText: { color: colors.textMuted, fontSize: 10 },

  listContent: { paddingHorizontal: spacing.md, gap: 10 },
  card: {
    width: 150,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    gap: 3,
  },
  imageWrap: { position: "relative" },
  image: {
    width: "100%",
    height: 110,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  adBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  adBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  cardName: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    marginTop: 4,
    lineHeight: 15,
  },
  cardPrice: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
  },
  cardSeller: {
    fontSize: 10,
    color: colors.textMuted,
  },
});
