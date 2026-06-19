import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import { useRouter } from "expo-router";
import { Zap } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Sale = {
  id: string;
  product_id: string;
  product_name: string;
  product_image: string;
  seller_name?: string | null;
  sale_price_nzd: number;
  original_price_nzd: number;
  discount_pct: number;
  ends_at: string;
  is_deal_of_the_day: boolean;
  units_sold: number;
  units_max: number;
};

function useCountdown(endsAt: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(endsAt).getTime() - now);
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Countdown({ endsAt }: { endsAt: string }) {
  const t = useCountdown(endsAt);
  return <Text style={styles.timer}>{t}</Text>;
}

export default function FlashSalesCarousel() {
  const router = useRouter();
  const [sales, setSales] = useState<Sale[]>([]);
  const tick = useRef<NodeJS.Timeout | null>(null);

  const load = async () => {
    try {
      const d = await api<Sale[]>("/flash-sales/active?limit=10");
      setSales(d || []);
    } catch {
      setSales([]);
    }
  };

  useEffect(() => {
    load();
    tick.current = setInterval(load, 60_000); // refresh every minute
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, []);

  if (sales.length === 0) {
    // Still expose the deals destination so buyers can browse coupons +
    // category-wide discounts even when no flash sales are live.
    return (
      <Pressable
        testID="deals-promo-card"
        onPress={() => router.push("/deals")}
        style={styles.dealsPromoCard}
      >
        <Zap size={18} color="#F97316" fill="#F97316" />
        <View style={{ flex: 1 }}>
          <Text style={styles.dealsPromoTitle}>Today&apos;s Deals</Text>
          <Text style={styles.dealsPromoSub}>
            Browse coupons & 10%+ off items
          </Text>
        </View>
        <Text style={styles.dealsPromoCta}>See deals →</Text>
      </Pressable>
    );
  }

  const dod = sales.find((s) => s.is_deal_of_the_day);
  const rest = sales.filter((s) => s.id !== dod?.id);

  return (
    <View style={styles.wrap} testID="flash-sales-carousel">
      <View style={styles.headerRow}>
        <Zap size={16} color="#F97316" fill="#F97316" />
        <Text style={styles.heading}>Flash sales</Text>
        <Pressable
          testID="flash-sales-see-all"
          onPress={() => router.push("/deals")}
          hitSlop={8}
          style={{ marginLeft: "auto" }}
        >
          <Text style={styles.seeAll}>See all →</Text>
        </Pressable>
      </View>

      {dod ? (
        <Pressable
          testID="deal-of-the-day"
          onPress={() => router.push(`/product/${dod.product_id}`)}
          style={({ pressed }) => [styles.dodCard, pressed && { opacity: 0.95 }]}
        >
          <View style={styles.dodBadge}>
            <Text style={styles.dodBadgeText}>⭐ DEAL OF THE DAY</Text>
          </View>
          <View style={styles.dodInner}>
            <Image source={{ uri: dod.product_image }} style={styles.dodImage} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dodName} numberOfLines={2}>
                {dod.product_name}
              </Text>
              <Text style={styles.dodSeller}>{dod.seller_name || ""}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.dodSale}>{formatNZD(dod.sale_price_nzd)}</Text>
                <Text style={styles.dodOriginal}>{formatNZD(dod.original_price_nzd)}</Text>
                <View style={styles.discountChip}>
                  <Text style={styles.discountText}>-{dod.discount_pct}%</Text>
                </View>
              </View>
              <View style={styles.dodFooter}>
                <Text style={styles.endsLabel}>Ends in </Text>
                <Countdown endsAt={dod.ends_at} />
              </View>
            </View>
          </View>
        </Pressable>
      ) : null}

      {rest.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scroller}
        >
          {rest.map((s) => (
            <Pressable
              key={s.id}
              testID={`flash-${s.id}`}
              onPress={() => router.push(`/product/${s.product_id}`)}
              style={styles.card}
            >
              <View style={styles.cardImageWrap}>
                <Image source={{ uri: s.product_image }} style={styles.cardImage} />
                <View style={styles.cardBadge}>
                  <Text style={styles.cardBadgeText}>-{s.discount_pct}%</Text>
                </View>
              </View>
              <Text numberOfLines={2} style={styles.cardName}>
                {s.product_name}
              </Text>
              <View style={styles.cardPriceRow}>
                <Text style={styles.cardSale}>{formatNZD(s.sale_price_nzd)}</Text>
                <Text style={styles.cardOriginal}>{formatNZD(s.original_price_nzd)}</Text>
              </View>
              <Countdown endsAt={s.ends_at} />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg },
  heading: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  seeAll: { fontSize: 12, fontWeight: "800", color: colors.primary },
  dealsPromoCard: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  dealsPromoTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  dealsPromoSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  dealsPromoCta: { color: "#F97316", fontWeight: "800", fontSize: 12 },
  dodCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#FFF7ED",
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: "#F97316",
    overflow: "hidden",
  },
  dodBadge: { backgroundColor: "#F97316", paddingHorizontal: 10, paddingVertical: 5 },
  dodBadgeText: { color: "#fff", fontWeight: "800", fontSize: 10, letterSpacing: 1 },
  dodInner: { flexDirection: "row", padding: spacing.md, gap: spacing.md, alignItems: "center" },
  dodImage: { width: 88, height: 88, borderRadius: radius.md },
  dodName: { fontWeight: "800", color: colors.text, fontSize: 14, lineHeight: 18 },
  dodSeller: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 6, flexWrap: "wrap" },
  dodSale: { fontSize: 20, fontWeight: "800", color: "#F97316" },
  dodOriginal: { fontSize: 12, textDecorationLine: "line-through", color: colors.textMuted },
  discountChip: { backgroundColor: "#F97316", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  discountText: { color: "#fff", fontWeight: "800", fontSize: 10 },
  dodFooter: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  endsLabel: { color: colors.textMuted, fontSize: 11 },
  timer: { color: "#DC2626", fontWeight: "800", fontSize: 12, letterSpacing: 0.5 },
  scroller: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingTop: spacing.sm },
  card: {
    width: 140,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardImageWrap: { position: "relative" },
  cardImage: { width: "100%", aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface },
  cardBadge: { position: "absolute", top: 4, left: 4, backgroundColor: "#F97316", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  cardBadgeText: { color: "#fff", fontWeight: "800", fontSize: 10 },
  cardName: { color: colors.text, fontWeight: "700", fontSize: 11, marginTop: 6, minHeight: 28 },
  cardPriceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 4 },
  cardSale: { fontWeight: "800", color: "#F97316", fontSize: 13 },
  cardOriginal: { fontSize: 10, textDecorationLine: "line-through", color: colors.textMuted },
});
