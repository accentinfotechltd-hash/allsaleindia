/**
 * ShippingSelector — 3-tier courier picker for checkout.
 * Fetches /api/shipping/quote and renders selectable cards.
 */
import { Check, Package, Truck, Zap } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export type ShippingOption = {
  tier: string;
  label: string;
  description: string;
  tracking: boolean;
  insurance: boolean;
  recommended: boolean;
  courier_id: number;
  courier_name: string;
  sla: string;
  rate_inr: number;
  rate_in_currency: number;
  rate_in_currency_before_discount: number;
  free: boolean;
};

type Quote = {
  country: string;
  weight_kg: number;
  free_shipping_eligible: boolean;
  free_shipping_threshold: number;
  options: ShippingOption[];
};

type Props = {
  country: string;
  currency: string;
  weightKg: number;
  subtotal: number;
  onSelect: (option: ShippingOption | null) => void;
  selectedTier?: string | null;
};

const TIER_ICON: Record<string, React.ReactNode> = {
  economy: <Package size={20} color={colors.primary} />,
  standard: <Truck size={20} color={colors.primary} />,
  express: <Zap size={20} color={colors.primary} />,
  heavy: <Truck size={20} color={colors.primary} />,
};

export default function ShippingSelector({
  country,
  currency,
  weightKg,
  subtotal,
  onSelect,
  selectedTier,
}: Props) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr("");
    api<Quote>(
      `/shipping/quote?country=${encodeURIComponent(country)}&weight_kg=${weightKg}&currency=${encodeURIComponent(currency)}&subtotal=${subtotal}`,
      { auth: false },
    )
      .then((q) => {
        if (cancel) return;
        setQuote(q);
        // Auto-select the recommended tier by default
        const def =
          q.options.find((o) => o.recommended) ||
          q.options.find((o) => o.tier === "standard") ||
          q.options[0];
        if (def) onSelect(def);
      })
      .catch((e: any) => {
        if (cancel) return;
        setErr(e?.message || "Couldn't load shipping options");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, currency, weightKg, subtotal]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>Loading shipping options…</Text>
      </View>
    );
  }
  if (err) return <Text style={styles.error}>{err}</Text>;
  if (!quote || quote.options.length === 0) {
    return <Text style={styles.error}>No shipping options available for this destination/weight.</Text>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Truck size={16} color={colors.primary} />
        <Text style={styles.title}>Choose shipping</Text>
        {quote.free_shipping_eligible && (
          <View style={styles.freeBadge}>
            <Text style={styles.freeBadgeText}>FREE standard unlocked!</Text>
          </View>
        )}
      </View>

      {quote.options.map((opt) => {
        const selected = selectedTier === opt.tier;
        return (
          <Pressable
            key={opt.tier}
            testID={`ship-tier-${opt.tier}`}
            onPress={() => onSelect(opt)}
            style={[styles.card, selected && styles.cardSelected]}
          >
            <View style={styles.iconCol}>{TIER_ICON[opt.tier] || TIER_ICON.standard}</View>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>{opt.label}</Text>
                {opt.recommended && (
                  <View style={styles.recBadge}>
                    <Text style={styles.recBadgeText}>RECOMMENDED</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardSub}>{opt.description}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>📅 {opt.sla}</Text>
                {opt.tracking && <Text style={styles.meta}>📦 Tracked</Text>}
                {opt.insurance && <Text style={styles.meta}>🛡️ Insured</Text>}
              </View>
            </View>
            <View style={styles.priceCol}>
              {opt.free ? (
                <>
                  <Text style={styles.struck}>
                    {currency} {opt.rate_in_currency_before_discount.toFixed(2)}
                  </Text>
                  <Text style={styles.freePrice}>FREE</Text>
                </>
              ) : (
                <Text style={styles.price}>
                  {currency} {opt.rate_in_currency.toFixed(2)}
                </Text>
              )}
              {selected && (
                <View style={styles.check}>
                  <Check size={14} color="#fff" />
                </View>
              )}
            </View>
          </Pressable>
        );
      })}

      {!quote.free_shipping_eligible && (
        <Text style={styles.hintText}>
          💡 Add {currency} {(quote.free_shipping_threshold - subtotal).toFixed(2)} more to unlock free Standard shipping
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, marginTop: spacing.md },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 4,
  },
  title: { fontSize: 14, fontWeight: "700", color: colors.text, flex: 1 },
  freeBadge: {
    backgroundColor: "#dcfce7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  freeBadgeText: { fontSize: 10, fontWeight: "700", color: "#166534" },
  card: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "flex-start",
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 2, backgroundColor: "#faf5ff" },
  iconCol: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ede9fe",
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  recBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recBadgeText: { color: "#fff", fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  cardSub: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  metaRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  meta: { fontSize: 11, color: colors.textMuted },
  priceCol: { alignItems: "flex-end", gap: 4, minWidth: 90 },
  price: { fontSize: 15, fontWeight: "700", color: colors.text },
  freePrice: { fontSize: 15, fontWeight: "800", color: "#10b981" },
  struck: { fontSize: 11, color: colors.textFaint, textDecorationLine: "line-through" },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  loading: { padding: spacing.lg, alignItems: "center", gap: 6 },
  loadingText: { color: colors.textMuted, fontSize: 13 },
  error: { color: "#dc2626", fontSize: 13, padding: spacing.md, textAlign: "center" },
  hintText: {
    fontSize: 12,
    color: "#7c3aed",
    backgroundColor: "#faf5ff",
    padding: 10,
    borderRadius: radius.md,
    marginTop: 4,
    fontWeight: "600",
  },
});
