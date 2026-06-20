import { useRouter } from "expo-router";
import { Bell, Globe2, MessageCircle, Package, Search, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
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
import BuyItAgainRail from "@/src/components/BuyItAgainRail";
import { EmptyState } from "@/src/components/EmptyState";
import FlashSalesCarousel from "@/src/components/FlashSalesCarousel";
import { ProductGridSkeleton } from "@/src/components/SkeletonRows";
import RecentlyViewedRail from "@/src/components/RecentlyViewedRail";
import AmbassadorWelcomeBanner from "@/src/components/AmbassadorWelcomeBanner";
import AssistantFab from "@/src/components/AssistantFab";
import SponsoredCarousel from "@/src/components/SponsoredCarousel";
import { WelcomeCouponBanner } from "@/src/components/WelcomeCouponBanner";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTranslation } from "@/src/i18n";
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

function ChatBellButton() {
  const router = useRouter();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let timer: any = null;
    const tick = async () => {
      try {
        const d = await api<{ total: number }>("/chat/unread-count");
        if (!stopped) setUnread(d?.total || 0);
      } catch {
        /* silent */
      }
      if (!stopped) timer = setTimeout(tick, 30000);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [user]);

  if (!user) return null;
  return (
    <Pressable
      testID="home-chat-bell-btn"
      onPress={() => router.push("/chat")}
      style={styles.iconBtn}
    >
      <MessageCircle size={20} color={colors.text} />
      {unread > 0 ? (
        <View style={styles.iconBadge} testID="home-chat-bell-badge">
          <Text style={styles.iconBadgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
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
            {/* Top bar — branded header card */}
            <View style={styles.topBar}>
              <View style={styles.brandCard}>
                <Image
                  source={require("@/assets/images/allsale-logo.png")}
                  style={styles.brandLogo}
                  resizeMode="contain"
                />
                <View style={styles.brandAccent} />
                <View style={styles.regionRow}>
                  <Globe2 size={12} color={colors.primary} />
                  <Text style={styles.region}>{t("home.shipping_to_nz")}</Text>
                </View>
              </View>
              <View style={styles.headerActions}>
                <ChatBellButton />
                <Pressable
                  testID="home-notifications-btn"
                  style={styles.iconBtn}
                  onPress={() => router.push("/notifications")}
                >
                  <Bell size={20} color={colors.text} />
                </Pressable>
              </View>
            </View>

            <Text style={styles.hello} testID="home-greeting">
              Namaste, {user?.full_name?.split(" ")[0] || "friend"} 🙏
            </Text>

            {/* Ambassador welcome banner — auto-hides when no ref captured */}
            <AmbassadorWelcomeBanner />

            {/* First-purchase welcome coupon (activation lever) — auto-hides
                when ineligible or already redeemed/dismissed. */}
            <WelcomeCouponBanner />

            {/* Search — tap-to-open full search screen */}
            <Pressable
              testID="home-search-open"
              onPress={() => router.push("/search")}
              style={styles.searchWrap}
            >
              <Search size={18} color={colors.textMuted} />
              <Text style={[styles.searchInput, { color: colors.textFaint }]}>
                {search || "Search sarees, brass, spices…"}
              </Text>
            </Pressable>

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

            {/* Quick destinations — Today's Deals + Best Sellers */}
            <View style={styles.quickDest}>
              <Pressable
                testID="home-quick-deals"
                onPress={() => router.push("/deals")}
                style={[styles.quickCard, styles.quickCardDeals]}
              >
                <Text style={styles.quickEmoji}>🔥</Text>
                <View>
                  <Text style={styles.quickTitle}>{t("home.deals_title")}</Text>
                  <Text style={styles.quickSub}>{t("home.deals_sub")}</Text>
                </View>
              </Pressable>
              <Pressable
                testID="home-quick-bestsellers"
                onPress={() => router.push("/best-sellers")}
                style={[styles.quickCard, styles.quickCardBest]}
              >
                <Text style={styles.quickEmoji}>🏆</Text>
                <View>
                  <Text style={styles.quickTitle}>{t("home.best_sellers_title")}</Text>
                  <Text style={styles.quickSub}>{t("home.best_sellers_sub")}</Text>
                </View>
              </Pressable>
            </View>

            {/* Flash sales / Deal of the Day */}
            <FlashSalesCarousel />

            {/* Sponsored placements — paid listings boosted by sellers */}
            <SponsoredCarousel placement="home" />

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
            <View style={{ paddingHorizontal: spacing.lg }}>
              <RecentlyViewedRail limit={10} />
            </View>
            <BuyItAgainRail limit={12} />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ProductGridSkeleton count={6} />
          ) : (
            <EmptyState
              icon={Package}
              title={t("home.no_match")}
              subtitle={t("home.no_match_body")}
              flex={false}
            />
          )
        }
      />
      <AssistantFab />
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
    gap: spacing.md,
  },
  brandCard: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F0F0F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  brand: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  brandLogo: { width: 168, height: 48 },
  brandAccent: {
    position: "absolute",
    right: -28,
    top: -28,
    width: 0,
    height: 0,
  },
  regionRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  region: { fontSize: 11.5, color: colors.textMuted, fontWeight: "500" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  iconBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  iconBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
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
  quickDest: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: 10,
  },
  quickCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  quickCardDeals: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  quickCardBest: { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" },
  quickEmoji: { fontSize: 24 },
  quickTitle: { fontWeight: "800", color: colors.text, fontSize: 13 },
  quickSub: { fontSize: 10, color: colors.textMuted, fontWeight: "700", marginTop: 1 },
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
