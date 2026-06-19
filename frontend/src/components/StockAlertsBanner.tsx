/**
 * Compact "Stock alerts" banner that lives on the seller dashboard.
 * Polls the low-stock endpoint and renders a red banner with a count
 * + CTA to `/seller/analytics` when there are any out / critical / low
 * stock items. Renders nothing when stock is healthy.
 */
import { useRouter } from "expo-router";
import { AlertCircle, ChevronRight, PackageX } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Summary = {
  total_alerts: number;
  out_of_stock: number;
  critical: number;
  low: number;
};

export default function StockAlertsBanner() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api<{ summary: Summary }>(
          "/seller/analytics/low-stock?threshold=10&window_days=30"
        );
        if (!cancelled) setSummary(d.summary);
      } catch {
        if (!cancelled) setSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary || summary.total_alerts === 0) return null;

  const isUrgent = summary.out_of_stock > 0 || summary.critical > 0;
  const Icon = summary.out_of_stock > 0 ? PackageX : AlertCircle;

  // Build a readable line: prioritise "out" > "critical" > "low"
  const segments: string[] = [];
  if (summary.out_of_stock > 0)
    segments.push(`${summary.out_of_stock} out of stock`);
  if (summary.critical > 0) segments.push(`${summary.critical} critical`);
  if (summary.low > 0) segments.push(`${summary.low} low`);
  const subtitle = segments.join(" · ");

  return (
    <Pressable
      testID="seller-stock-alerts-banner"
      onPress={() => router.push("/seller/analytics")}
      style={[
        styles.banner,
        isUrgent ? styles.bannerUrgent : styles.bannerWarn,
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          isUrgent ? styles.iconWrapUrgent : styles.iconWrapWarn,
        ]}
      >
        <Icon size={18} color={isUrgent ? "#B91C1C" : "#A16207"} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          {summary.total_alerts} listing
          {summary.total_alerts === 1 ? "" : "s"} need
          {summary.total_alerts === 1 ? "s" : ""} attention
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  bannerUrgent: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  bannerWarn: {
    backgroundColor: "#FEFCE8",
    borderColor: "#FDE68A",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapUrgent: { backgroundColor: "#FEE2E2" },
  iconWrapWarn: { backgroundColor: "#FEF3C7" },
  title: { fontWeight: "800", color: colors.text, fontSize: 13 },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
