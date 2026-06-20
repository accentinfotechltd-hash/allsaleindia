/**
 * Shared empty-state component for list/grid screens.
 *
 * Visual language across orders / wishlist / search / home:
 *   - Soft circular icon badge (primary-tinted background)
 *   - Bold title
 *   - Muted subtitle (≤ 2 lines of helpful guidance)
 *   - Optional primary CTA + optional secondary CTA
 *
 * Use through screens via:
 *   <EmptyState
 *     icon={Package}
 *     title="No orders yet"
 *     subtitle="When you place an order, it'll show up here."
 *     cta={{ label: "Start shopping", onPress: () => router.push("/(tabs)/home") }}
 *   />
 */
import React, { ComponentType } from "react";
import { Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { LucideProps } from "lucide-react-native";

import { colors, radius, spacing } from "@/src/lib/theme";

type LucideIcon = ComponentType<LucideProps>;

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
  testID?: string;
  /** Style the button as a secondary/ghost button. */
  secondary?: boolean;
};

export type EmptyStateProps = {
  icon?: LucideIcon;
  /** Render-prop alternative when the visual is more than a single icon. */
  visual?: React.ReactNode;
  title: string;
  subtitle?: string;
  cta?: EmptyStateAction;
  secondaryCta?: EmptyStateAction;
  style?: ViewStyle;
  testID?: string;
  /** If true, pads vertically more so the state takes the screen mid-height. */
  flex?: boolean;
};

export function EmptyState({
  icon: Icon,
  visual,
  title,
  subtitle,
  cta,
  secondaryCta,
  style,
  testID,
  flex = true,
}: EmptyStateProps) {
  return (
    <View
      style={[styles.root, flex && styles.rootFlex, style]}
      testID={testID || "empty-state"}
    >
      {visual ? (
        <View style={styles.visualWrap}>{visual}</View>
      ) : Icon ? (
        <View style={styles.iconWrap}>
          <Icon size={28} color={colors.primary} strokeWidth={1.8} />
        </View>
      ) : null}

      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      {cta ? (
        <Pressable
          testID={cta.testID}
          onPress={cta.onPress}
          style={({ pressed }) => [
            cta.secondary ? styles.ctaSecondary : styles.cta,
            pressed && { opacity: 0.9 },
          ]}
        >
          <Text style={cta.secondary ? styles.ctaSecondaryText : styles.ctaText}>
            {cta.label}
          </Text>
        </Pressable>
      ) : null}
      {secondaryCta ? (
        <Pressable
          testID={secondaryCta.testID}
          onPress={secondaryCta.onPress}
          style={({ pressed }) => [styles.ctaSecondary, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaSecondaryText}>{secondaryCta.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: 10,
  },
  rootFlex: { flex: 1 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  visualWrap: { marginBottom: 6 },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 320,
  },
  cta: {
    marginTop: spacing.md,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    minHeight: 44,
    minWidth: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  ctaSecondary: {
    marginTop: spacing.sm,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    minWidth: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaSecondaryText: { color: colors.text, fontWeight: "700", fontSize: 14 },
});

export default EmptyState;
