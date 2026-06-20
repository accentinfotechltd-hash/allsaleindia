import { useRouter } from "expo-router";
import { Sparkles } from "lucide-react-native";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/src/lib/theme";

/**
 * Floating action button that opens the AI Shopping Assistant.
 * Place at the bottom-right of any screen. The component already
 * accounts for its own safe-area offset (bottom: 96) so callers don't
 * need to compensate for the bottom tab bar.
 */
export default function AssistantFab({
  testID,
  offsetBottom = 96,
  initialQuestion,
}: {
  testID?: string;
  offsetBottom?: number;
  initialQuestion?: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      testID={testID || "assistant-fab"}
      onPress={() => {
        if (initialQuestion) {
          router.push({
            pathname: "/assistant",
            params: { q: initialQuestion },
          });
        } else {
          router.push("/assistant");
        }
      }}
      style={({ pressed }) => [
        styles.fab,
        { bottom: offsetBottom },
        pressed && { opacity: 0.85 },
      ]}
      hitSlop={6}
      accessibilityLabel="Open shopping assistant"
    >
      <View style={styles.inner}>
        <Sparkles size={20} color="#fff" />
        <Text style={styles.label}>Ask</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    ...(Platform.OS === "web" ? { boxShadow: "0 6px 16px rgba(0,0,0,0.18)" } : {}),
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
