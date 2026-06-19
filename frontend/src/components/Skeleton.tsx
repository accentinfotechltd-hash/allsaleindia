/**
 * Generic shimmering skeleton placeholder.
 *
 * Uses ``react-native-reanimated`` for a 60fps opacity pulse (0.4 → 1 → 0.4)
 * with no JS-thread cost. Layout primitive — pass ``width``, ``height``, and
 * (optionally) ``radius``. For circle placeholders pass equal width/height
 * + ``radius={width / 2}``.
 *
 * Typical use:
 *   <Skeleton width="100%" height={56} radius={12} />
 *   <Skeleton width={40} height={40} radius={20} />   // circle avatar
 */
import React, { useEffect } from "react";
import { StyleSheet, View, ViewStyle, DimensionValue } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";

import { colors } from "@/src/lib/theme";

export type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: ViewStyle;
};

export function Skeleton({
  width = "100%",
  height = 14,
  radius = 6,
  style,
}: SkeletonProps) {
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,    // infinite
      true,  // reverse → 0.4 → 1 → 0.4
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.base,
        { width, height, borderRadius: radius },
        animatedStyle,
        style,
      ]}
    />
  );
}

/**
 * Container that puts vertical gap between skeleton rows. Useful for list
 * placeholders without writing a wrapper in every screen.
 */
export function SkeletonGroup({
  gap = 12,
  children,
  style,
}: {
  gap?: number;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceMuted,
  },
});

export default Skeleton;
