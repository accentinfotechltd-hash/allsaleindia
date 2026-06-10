import { useRouter } from "expo-router";
import { Store } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing } from "@/src/lib/theme";

/** Compact pitch row pointing buyers/visitors to the seller signup flow. */
export function SellOnAllsaleBanner({
  variant = "compact",
  testID = "sell-on-allsale-banner",
}: {
  variant?: "compact" | "card";
  testID?: string;
}) {
  const router = useRouter();
  if (variant === "compact") {
    return (
      <Pressable
        testID={testID}
        onPress={() => router.push("/seller/welcome")}
        style={({ pressed }) => [styles.compact, pressed && { opacity: 0.85 }]}
      >
        <Store size={14} color={colors.primary} />
        <Text style={styles.compactText}>
          Own a business in India? <Text style={styles.compactLink}>Sell on Allsale</Text>
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={() => router.push("/seller/welcome")}
      style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.98 }] }]}
    >
      <View style={styles.cardIcon}>
        <Store size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>Sell on Allsale</Text>
        <Text style={styles.cardSubtitle}>List your products to NZ shoppers. India-registered businesses only.</Text>
      </View>
      <Text style={styles.cardArrow}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  compactText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  compactLink: { color: colors.primary, fontWeight: "800" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  cardSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  cardArrow: { color: colors.primary, fontSize: 18, fontWeight: "800" },
});
