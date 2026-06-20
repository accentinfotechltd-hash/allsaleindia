/**
 * "Ships well" badge — surfaces a seller's delivery quality on the PDP.
 *
 * Pulls `/sellers/{seller_id}/delivery-score`. Renders only when the
 * seller has ≥5 delivery ratings averaging ≥4.0 stars (`ships_well:true`
 * from the API). Auto-hides otherwise so we never display "0 ratings"
 * noise — the badge has to be earned.
 */
import { Truck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api } from "@/src/lib/api";
import { colors } from "@/src/lib/theme";

type Score = {
  seller_id: string;
  avg_stars: number | null;
  ratings_count: number;
  ships_well: boolean;
};

export default function ShipsWellBadge({ sellerId }: { sellerId?: string }) {
  const [score, setScore] = useState<Score | null>(null);

  useEffect(() => {
    if (!sellerId) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await api<Score>(
          `/sellers/${sellerId}/delivery-score`,
          { auth: false }
        );
        if (!cancelled) setScore(d);
      } catch {
        if (!cancelled) setScore(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sellerId]);

  if (!score || !score.ships_well || !score.avg_stars) return null;

  return (
    <View style={styles.badge} testID="ships-well-badge">
      <Truck size={11} color="#059669" />
      <Text style={styles.label}>
        Ships well · {score.avg_stars.toFixed(1)}★
      </Text>
      <Text style={styles.count}>({score.ratings_count})</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    alignSelf: "flex-start",
  },
  label: { color: "#065F46", fontWeight: "800", fontSize: 10.5 },
  count: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
});
