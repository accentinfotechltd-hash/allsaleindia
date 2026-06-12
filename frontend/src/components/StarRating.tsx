import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Star } from "lucide-react-native";

type Props = {
  value: number; // 0..5 (can be fractional for display)
  onChange?: (v: number) => void; // if provided, becomes interactive
  size?: number;
  color?: string;
  emptyColor?: string;
  testID?: string;
};

/** Compact, reusable star rating row. Tap to set value when `onChange` is set. */
export default function StarRating({
  value,
  onChange,
  size = 18,
  color = "#F59E0B",
  emptyColor = "#E5E7EB",
  testID,
}: Props) {
  const stars = [1, 2, 3, 4, 5];
  const editable = !!onChange;

  return (
    <View style={styles.row} testID={testID}>
      {stars.map((n) => {
        const filled = value >= n - 0.25;
        const half = !filled && value >= n - 0.75;
        const StarIcon = (
          <Star
            size={size}
            color={filled || half ? color : emptyColor}
            fill={filled ? color : "transparent"}
            strokeWidth={1.6}
          />
        );
        if (!editable) {
          return (
            <View key={n} style={styles.starWrap}>
              {StarIcon}
            </View>
          );
        }
        return (
          <Pressable
            key={n}
            hitSlop={6}
            onPress={() => onChange!(n)}
            testID={`star-rating-${n}`}
            style={styles.starWrap}
          >
            {StarIcon}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 2 },
  starWrap: { padding: 1 },
});
