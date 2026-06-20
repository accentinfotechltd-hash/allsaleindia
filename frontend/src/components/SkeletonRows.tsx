/**
 * Pre-built skeleton list/grid layouts for the four main list screens.
 *
 * Each block matches the rough geometry of its real row/card so the layout
 * doesn't jump when data arrives — minimising CLS-like reflow on mobile.
 */
import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";

import { Skeleton } from "@/src/components/Skeleton";
import { colors, radius, spacing } from "@/src/lib/theme";

// ---------------------------------------------------------------------------
// OrderRowSkeleton — matches /orders list row
// ---------------------------------------------------------------------------
export function OrderRowSkeleton() {
  return (
    <View style={skelStyles.orderRow}>
      <View style={skelStyles.orderHead}>
        <Skeleton width={80} height={14} radius={4} />
        <Skeleton width={64} height={20} radius={10} />
      </View>
      <View style={skelStyles.orderBody}>
        <Skeleton width={56} height={56} radius={8} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="80%" height={13} radius={4} />
          <Skeleton width="50%" height={12} radius={4} />
        </View>
      </View>
      <Skeleton width="100%" height={1} radius={0} style={{ marginVertical: spacing.sm }} />
      <View style={skelStyles.orderFoot}>
        <Skeleton width={90} height={12} radius={4} />
        <Skeleton width={60} height={12} radius={4} />
      </View>
    </View>
  );
}

export function OrderListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <OrderRowSkeleton key={i} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ProductCardSkeleton — used by home grid + wishlist 2-col grid
// ---------------------------------------------------------------------------
export function ProductCardSkeleton({ width = "48%" as ViewStyle["width"] }: { width?: ViewStyle["width"] }) {
  return (
    <View style={[skelStyles.productCard, { width }]}>
      <Skeleton width="100%" height={140} radius={radius.md} />
      <View style={{ gap: 6, marginTop: spacing.sm }}>
        <Skeleton width="90%" height={12} radius={4} />
        <Skeleton width="60%" height={12} radius={4} />
        <Skeleton width="40%" height={14} radius={4} style={{ marginTop: 4 }} />
      </View>
    </View>
  );
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={skelStyles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// WishlistRowSkeleton — matches the 1-col list layout
// ---------------------------------------------------------------------------
export function WishlistRowSkeleton() {
  return (
    <View style={skelStyles.wishRow}>
      <Skeleton width={88} height={88} radius={10} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="85%" height={13} radius={4} />
        <Skeleton width="55%" height={12} radius={4} />
        <Skeleton width="35%" height={14} radius={4} style={{ marginTop: 4 }} />
      </View>
      <Skeleton width={28} height={28} radius={14} />
    </View>
  );
}

export function WishlistListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <WishlistRowSkeleton key={i} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SearchSuggestionsSkeleton — chip rows + product rows for the live-suggest panel
// ---------------------------------------------------------------------------
export function SearchSuggestionsSkeleton() {
  return (
    <View style={{ paddingTop: spacing.md, gap: spacing.lg }}>
      <View style={{ gap: 8 }}>
        <Skeleton width={120} height={13} radius={4} />
        <View style={skelStyles.chipRow}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width={70 + (i % 3) * 12} height={28} radius={14} />
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <Skeleton width={90} height={13} radius={4} />
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} style={skelStyles.searchProductRow}>
            <Skeleton width={48} height={48} radius={6} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="80%" height={12} radius={4} />
              <Skeleton width="45%" height={11} radius={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const skelStyles = StyleSheet.create({
  orderRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  orderHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderBody: { flexDirection: "row", gap: 12, alignItems: "center", marginTop: spacing.sm },
  orderFoot: { flexDirection: "row", justifyContent: "space-between" },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    justifyContent: "space-between",
  },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },

  wishRow: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  searchProductRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
});
