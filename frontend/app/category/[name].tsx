import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductCard, ProductLite } from "@/src/components/ProductCard";
import { api } from "@/src/lib/api";
import { colors, spacing } from "@/src/lib/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const GUTTER = 12;
const CARD_W = (SCREEN_W - spacing.lg * 2 - GUTTER) / 2;

export default function CategoryDetail() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const [items, setItems] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await api<ProductLite[]>(
          `/products?category=${encodeURIComponent(name as string)}`,
          { auth: false },
        );
        setItems(list);
      } finally {
        setLoading(false);
      }
    })();
  }, [name]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="category-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.subtitle}>From India · to NZ</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: spacing.lg }}
          contentContainerStyle={{ gap: GUTTER, paddingBottom: spacing.xxl, paddingTop: spacing.md }}
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              width={CARD_W}
              onPress={() => router.push(`/product/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
