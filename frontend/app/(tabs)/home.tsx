import { useRouter } from "expo-router";
import { Bell, Globe2, Search, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductCard, ProductLite } from "@/src/components/ProductCard";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const GUTTER = 12;
const CARD_W = (SCREEN_W - spacing.lg * 2 - GUTTER) / 2;

const HERO_BANNERS = [
  {
    id: "b1",
    tag: "FESTIVE EDIT",
    title: "Sarees from\nVaranasi",
    image:
      "https://images.unsplash.com/photo-1503160865267-af4660ce7bf2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwxfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85",
  },
  {
    id: "b2",
    tag: "NEW IN",
    title: "Brass for\nyour home",
    image:
      "https://images.unsplash.com/photo-1650383044645-5d32141ad1a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBoYW5kaWNyYWZ0cyUyMGJyYXNzfGVufDB8fHx8MTc4MTEzMjI2OXww&ixlib=rb-4.1.0&q=85",
  },
];

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [prods, cats] = await Promise.all([
        api<ProductLite[]>("/products", { auth: false }),
        api<string[]>("/categories", { auth: false }),
      ]);
      setProducts(prods);
      setCategories(cats);
    } catch {
      // ignored — keep stale data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const filtered = useMemo(() => {
    let list = products;
    if (activeCat !== "All") list = list.filter((p) => p.category === activeCat);
    if (search.trim())
      list = list.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
    return list;
  }, [products, activeCat, search]);

  const chips = ["All", ...categories];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            width={CARD_W}
            onPress={() => router.push(`/product/${item.id}`)}
          />
        )}
        numColumns={2}
        columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: GUTTER, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View>
            {/* Top bar */}
            <View style={styles.topBar}>
              <View style={{ flex: 1 }}>
                <Image
                  source={require("@/assets/images/allsale-logo.png")}
                  style={styles.brandLogo}
                  resizeMode="contain"
                />
                <View style={styles.regionRow}>
                  <Globe2 size={11} color={colors.textMuted} />
                  <Text style={styles.region}>Shipping to New Zealand</Text>
                </View>
              </View>
              <Pressable
                testID="home-notifications-btn"
                style={styles.iconBtn}
                onPress={() => {}}
              >
                <Bell size={20} color={colors.text} />
              </Pressable>
            </View>

            <Text style={styles.hello} testID="home-greeting">
              Namaste, {user?.full_name?.split(" ")[0] || "friend"} 👋
            </Text>

            {/* Search */}
            <View style={styles.searchWrap}>
              <Search size={18} color={colors.textMuted} />
              <TextInput
                testID="home-search-input"
                placeholder="Search sarees, brass, spices…"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            {/* Hero banners */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bannerRow}
            >
              {HERO_BANNERS.map((b) => (
                <Pressable
                  key={b.id}
                  testID={`home-banner-${b.id}`}
                  onPress={() => router.push("/(tabs)/categories")}
                  style={styles.banner}
                >
                  <Image source={{ uri: b.image }} style={styles.bannerImg} />
                  <View style={styles.bannerOverlay}>
                    <Text style={styles.bannerTag}>{b.tag}</Text>
                    <Text style={styles.bannerTitle}>{b.title}</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>

            {/* Category chips (sticky chrome) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {chips.map((c) => {
                const active = c === activeCat;
                return (
                  <Pressable
                    key={c}
                    testID={`home-chip-${c.toLowerCase().replace(/\s+/g, "-")}`}
                    onPress={() => setActiveCat(c)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Sparkles size={16} color={colors.primary} />
                <Text style={styles.sectionTitle}>
                  {activeCat === "All" ? "Trending in NZ" : activeCat}
                </Text>
              </View>
              <Text style={styles.sectionCount}>{filtered.length} items</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No products match your search.</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  brand: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  brandLogo: { width: 132, height: 40, marginBottom: 2 },
  regionRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  region: { fontSize: 11, color: colors.textMuted, fontWeight: "500" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  hello: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    letterSpacing: -0.8,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },
  bannerRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: 12,
  },
  banner: {
    width: 240,
    height: 140,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.black,
  },
  bannerImg: { width: "100%", height: "100%", opacity: 0.7 },
  bannerOverlay: { position: "absolute", left: 16, bottom: 14 },
  bannerTag: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  bannerTitle: { color: "#fff", fontSize: 20, fontWeight: "800", letterSpacing: -0.6, marginTop: 4, lineHeight: 22 },
  chipsRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: 8,
  },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  sectionCount: { fontSize: 12, color: colors.textMuted },
  empty: { paddingVertical: spacing.xxl, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 14 },
});
