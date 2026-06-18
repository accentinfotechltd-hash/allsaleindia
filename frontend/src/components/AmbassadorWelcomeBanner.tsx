/**
 * Welcome banner shown on the home screen when an ambassador ref is stored.
 * Mirrors the web team's <AmbassadorWelcomeBanner>: dismissable per-code so
 * the same shopper doesn't see Sarah's banner forever, but a NEW ambassador
 * code will re-trigger.
 */
import { useFocusEffect } from "expo-router";
import { Sparkles, X } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  dismissBanner,
  getStoredRef,
  isBannerDismissed,
  StoredRef,
} from "@/src/lib/ref";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function AmbassadorWelcomeBanner() {
  const [ref, setRef] = useState<StoredRef | null>(null);
  const [visible, setVisible] = useState(false);

  const load = useCallback(async () => {
    const stored = await getStoredRef();
    if (!stored) {
      setRef(null);
      setVisible(false);
      return;
    }
    const dismissed = await isBannerDismissed(stored.code);
    setRef(stored);
    setVisible(!dismissed);
  }, []);

  // Refresh whenever the home screen regains focus — handles the case where
  // a deeplink captured a new code while the app was in the background.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onDismiss = async () => {
    if (!ref) return;
    setVisible(false);
    await dismissBanner(ref.code);
  };

  if (!ref || !visible) return null;

  const handle = ref.primary_platform === "instagram"
    ? `@${ref.name.split(" ")[0].toLowerCase()}`
    : ref.name.split(" ")[0];

  return (
    <View testID="amb-welcome-banner" style={styles.bar}>
      <View style={styles.iconWrap}>
        <Sparkles size={14} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={styles.text}>
          Shopping with{" "}
          <Text style={styles.handle}>{handle}</Text>
          {" · "}5% off applied with{" "}
          <Text style={styles.code}>{ref.code}</Text>
        </Text>
      </View>
      <Pressable
        testID="amb-welcome-dismiss"
        onPress={onDismiss}
        hitSlop={12}
        style={styles.dismissBtn}
      >
        <X size={14} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    // Subtle gradient-fake via a slightly darker tint isn't needed — flat
    // brand orange reads well on mobile.
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#fff", fontSize: 12, lineHeight: 17, fontWeight: "500" },
  handle: { fontWeight: "800" },
  code: { fontWeight: "800", letterSpacing: 1 },
  dismissBtn: { padding: 4 },
});
