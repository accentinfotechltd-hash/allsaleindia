/**
 * "Ships well" badge — surfaces a seller's delivery quality on the PDP.
 *
 * Pulls `/sellers/{seller_id}/delivery-score`. Three render states:
 *   • ships_well=true             → green earned badge (≥5 ratings, ≥4.0★)
 *   • 1-4 ratings AND avg ≥ 4.0  → orange "Earning..." progress badge
 *   • everything else            → hidden (no zero-rating noise)
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

  if (!score || !score.avg_stars || score.ratings_count === 0) return null;

  // EARNED — full green badge
  if (score.ships_well) {
    return (
      <View
        style={[styles.badge, styles.badgeEarned]}
        testID="ships-well-badge"
      >
        <Truck size={11} color="#059669" />
        <Text style={[styles.label, { color: "#065F46" }]}>
          Ships well · {score.avg_stars.toFixed(1)}★
        </Text>
        <Text style={styles.count}>({score.ratings_count})</Text>
      </View>
    );
  }

  // EARNING — show progress badge only when on track (avg ≥ 4.0)
  if (score.avg_stars >= 4.0) {
    return (
      <View
        style={[styles.badge, styles.badgeProgress]}
        testID="ships-well-progress"
      >
        <Truck size={11} color="#A16207" />
        <Text style={[styles.label, { color: "#854D0E" }]}>
          Earning Ships well · {score.ratings_count}/5
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  badgeEarned: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  badgeProgress: { backgroundColor: "#FEFCE8", borderColor: "#FDE68A" },
  label: { fontWeight: "800", fontSize: 10.5 },
  count: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
});

