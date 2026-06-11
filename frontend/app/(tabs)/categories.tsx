import { useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, ShieldCheck } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fetchTaxonomy, TaxonomyNode, TRUST_POINTS } from "@/src/lib/nz";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Categories() {
  const router = useRouter();
  const [nodes, setNodes] = useState<TaxonomyNode[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const t = await fetchTaxonomy();
      setNodes(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Categories</Text>
        <Text style={styles.subtitle}>India → New Zealand · 7-12 days courier</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={nodes}
          keyExtractor={(g) => g.key}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListHeaderComponent={
            <View style={styles.trustStrip} testID="categories-trust-strip">
              <ShieldCheck size={16} color={colors.success} />
              <Text style={styles.trustText}>{TRUST_POINTS.join(" · ")}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`category-row-${item.key}`}
              onPress={() => router.push({ pathname: "/category/[name]", params: { name: item.name } })}
              style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowBlurb} numberOfLines={2}>{item.blurb}</Text>
                <Text style={styles.rowMeta}>
                  {item.subcategories.length} subcategories · {item.subcategories.slice(0, 3).join(", ")}
                  {item.subcategories.length > 3 ? "…" : ""}
                </Text>
              </View>
              <ChevronRight size={20} color={colors.textMuted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  title: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  trustStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  trustText: { color: colors.success, fontSize: 12, fontWeight: "700", flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 10,
  },
  rowTitle: { fontSize: 17, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  rowBlurb: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  rowMeta: { fontSize: 11, color: colors.textFaint, marginTop: 6, fontWeight: "600" },
});
