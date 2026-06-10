import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductLite } from "@/src/components/ProductCard";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type CatGroup = { category: string; cover: string; count: number };

export default function Categories() {
  const router = useRouter();
  const [groups, setGroups] = useState<CatGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const prods = await api<ProductLite[]>("/products", { auth: false });
        const map = new Map<string, CatGroup>();
        for (const p of prods) {
          if (!map.has(p.category)) {
            map.set(p.category, { category: p.category, cover: p.image, count: 0 });
          }
          map.get(p.category)!.count += 1;
        }
        setGroups([...map.values()]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Categories</Text>
        <Text style={styles.subtitle}>Shop authentic India by category</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.category}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`category-row-${item.category.toLowerCase().replace(/\s+/g, "-")}`}
              onPress={() =>
                router.push({ pathname: "/category/[name]", params: { name: item.category } })
              }
              style={({ pressed }) => [styles.row, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              <Image source={{ uri: item.cover }} style={styles.cover} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.category}</Text>
                <Text style={styles.rowMeta}>{item.count} items · from India</Text>
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
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 14,
  },
  cover: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
