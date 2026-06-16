import { useRouter } from "expo-router";
import { Clock, Star } from "lucide-react-native";
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

import WishlistButton from "@/src/components/WishlistButton";
import { useAuth } from "@/src/contexts/AuthContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { api } from "@/src/lib/api";
import { getAnonSessionId } from "@/src/lib/session";
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

/**
 * Recently-viewed horizontal rail.
 *
 * • Auth users: attributed via JWT → `GET /api/recommendations/recently-viewed`
 * • Anonymous : passes our stable `session_id` so the list still persists
 *
 * Props:
 *   excludeId  — hide a specific product (e.g. on PDP we don't want the
 *                product the user is currently looking at to appear)
 *   limit      — how many items to fetch (default 12)
 *   onCleared  — fired after the "Clear" button succeeds
 */
export default function RecentlyViewedRail({
  excludeId,
  limit = 12,
  onCleared,
}: {
  excludeId?: string;
  limit?: number;
  onCleared?: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { formatPrice, info } = useRegion();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Auth users → backend reads user_id from JWT.
      // Anonymous → we must pass session_id explicitly.
      const sessionId = user ? null : await getAnonSessionId();
      const query = sessionId
        ? `?limit=${limit}&session_id=${encodeURIComponent(sessionId)}`
        : `?limit=${limit}`;
      const d = await api<Product[]>(
        `/recommendations/recently-viewed${query}`,
        // The endpoint is auth-optional — calling with auth attached works,
        // but we must allow calls when there's no token (anon flow).
        { auth: !!user }
      );
      const filtered = excludeId ? (d || []).filter((p) => p.id !== excludeId) : d || [];
      setItems(filtered);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [excludeId, limit, user]);

  useEffect(() => {
    load();
  }, [load]);

  const clearAll = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const sessionId = user ? null : await getAnonSessionId();
      const query = sessionId
        ? `?session_id=${encodeURIComponent(sessionId)}`
        : "";
      await api(`/recommendations/recently-viewed${query}`, {
        method: "DELETE",
        auth: !!user,
      });
      setItems([]);
      onCleared?.();
    } catch {
      // silent — keep the UI as is
    } finally {
      setClearing(false);
    }
  }, [clearing, user, onCleared]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap} testID="recently-viewed-rail">
      <View style={styles.headerRow}>
        <Clock size={16} color={colors.primary} />
        <Text style={styles.heading}>Recently viewed</Text>
        <View style={{ flex: 1 }} />
        <Pressable
          testID="recently-viewed-clear"
          onPress={clearAll}
          disabled={clearing}
          hitSlop={8}
        >
          <Text style={[styles.clearText, clearing && { opacity: 0.4 }]}>
            {clearing ? "Clearing…" : "Clear"}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {items.map((p) => {
          const isLocal = info.currency === "NZD";
          return (
            <Pressable
              key={p.id}
              testID={`recent-${p.id}`}
              onPress={() => router.push(`/product/${p.id}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.imgWrap}>
                <Image source={{ uri: p.image }} style={styles.img} />
                <WishlistButton productId={p.id} size={14} />
              </View>
              <Text style={styles.name} numberOfLines={2}>
                {p.name}
              </Text>
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
  clearText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  scroller: { gap: spacing.sm, paddingTop: spacing.sm, paddingRight: spacing.lg },
  card: { width: 140, gap: 4 },
  imgWrap: { position: "relative" },
  img: { width: "100%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  name: { color: colors.text, fontWeight: "700", fontSize: 12, marginTop: 6, minHeight: 32, lineHeight: 16 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  price: { fontWeight: "800", color: colors.text, fontSize: 14, marginTop: 2 },
});
