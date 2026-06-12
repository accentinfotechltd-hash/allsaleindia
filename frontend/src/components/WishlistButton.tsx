import React from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Heart } from "lucide-react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/contexts/AuthContext";
import { useWishlist } from "@/src/contexts/WishlistContext";
import { colors } from "@/src/lib/theme";

/** Floating heart button — sits on top of product images (cards, detail). */
export default function WishlistButton({
  productId,
  size = 18,
  variant = "floating",
}: {
  productId: string;
  size?: number;
  variant?: "floating" | "inline";
}) {
  const { user } = useAuth();
  const router = useRouter();
  const { has, toggle } = useWishlist();
  const active = has(productId);

  const onPress = async (e?: any) => {
    e?.stopPropagation?.();
    if (!user) {
      Alert.alert("Sign in to save", "Create an account to start your wishlist.", [
        { text: "Not now", style: "cancel" },
        { text: "Sign in", onPress: () => router.push("/(auth)/login") },
      ]);
      return;
    }
    try {
      await toggle(productId);
    } catch (e: any) {
      Alert.alert("Couldn't update wishlist", e?.message || "Try again.");
    }
  };

  if (variant === "inline") {
    return (
      <Pressable
        testID={`wishlist-toggle-${productId}`}
        onPress={onPress}
        hitSlop={8}
        style={styles.inline}
      >
        <Heart
          size={size}
          color={active ? "#EF4444" : colors.textMuted}
          fill={active ? "#EF4444" : "transparent"}
          strokeWidth={2}
        />
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.floatWrap}>
      <Pressable
        testID={`wishlist-toggle-${productId}`}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => [
          styles.float,
          pressed && { transform: [{ scale: 0.92 }] },
        ]}
      >
        <Heart
          size={size}
          color={active ? "#EF4444" : "#FFFFFF"}
          fill={active ? "#EF4444" : "rgba(0,0,0,0.25)"}
          strokeWidth={2.2}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  floatWrap: {
    position: "absolute",
    top: 8,
    right: 8,
    zIndex: 4,
  },
  float: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "rgba(15,23,42,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  inline: { padding: 6 },
});
