import { useRouter } from "expo-router";
import { Scale, ScaleIcon, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useToast } from "@/src/components/UiOverlayProvider";
import {
  COMPARE_MAX,
  isInCompare,
  subscribeCompare,
  toggleCompare,
} from "@/src/lib/compare";
import { colors, radius, spacing } from "@/src/lib/theme";

/**
 * Per-product "Add to compare" toggle pill. Mount on the product detail page.
 *
 *  • Subscribes to the compare store so the icon flips between Scale/X.
 *  • Caps at 4 items — shows a "max reached" toast beyond that.
 *  • Tapping the pill while ALREADY in compare removes it.
 *  • A secondary "Compare (N) →" appears when count > 1, routing to /compare.
 */
export default function CompareToggleButton({ productId }: { productId: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [inCompare, setInCompare] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    isInCompare(productId).then((v) => mounted && setInCompare(v));
    const unsub = subscribeCompare((ids) => {
      if (!mounted) return;
      setInCompare(ids.includes(productId));
      setCount(ids.length);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [productId]);

  const onPress = async () => {
    const res = await toggleCompare(productId);
    if (res.cappedAt) {
      show({
        title: `Compare list full (max ${res.cappedAt})`,
        body: "Remove one to add another, or open compare.",
        kind: "error",
      });
      return;
    }
    setInCompare(res.added);
    show({
      title: res.added ? "Added to compare" : "Removed from compare",
      body:
        res.added && res.ids.length > 1
          ? `${res.ids.length} items ready to compare`
          : undefined,
      kind: "success",
    });
  };

  return (
    <>
      <Pressable
        testID="compare-toggle-btn"
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          inCompare && styles.pillActive,
          pressed && { opacity: 0.85 },
        ]}
      >
        {inCompare ? (
          <X size={13} color="#fff" />
        ) : (
          <Scale size={13} color={colors.primary} />
        )}
        <Text
          style={[styles.pillText, inCompare && { color: "#fff" }]}
          numberOfLines={1}
        >
          {inCompare ? "In compare ✓" : "Add to compare"}
        </Text>
      </Pressable>

      {count > 1 ? (
        <Pressable
          testID="compare-open-btn"
          onPress={() => router.push("/compare")}
          style={styles.openPill}
        >
          <ScaleIcon size={12} color="#7C3AED" />
          <Text style={styles.openPillText}>Compare ({count}) →</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F5F3FF",
    borderWidth: 1,
    borderColor: "#DDD6FE",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 6,
    alignSelf: "flex-start",
  },
  pillActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#7C3AED",
  },
  pillText: {
    color: "#7C3AED",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.2,
  },
  openPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#F5F3FF",
    marginTop: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  openPillText: { color: "#7C3AED", fontWeight: "800", fontSize: 11 },
});
