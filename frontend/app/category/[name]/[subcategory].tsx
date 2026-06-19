/**
 * Dedicated subcategory product listing page — Amazon-style drill-down.
 *
 * Route: `/category/{name}/{subcategory}` — deep-linkable, owns its own
 * native back-stack entry. Renders a breadcrumb (Categories › Category ›
 * Subcategory), a sibling-chip switcher that lets buyers jump between
 * subcategories in the same parent category without going back to the
 * tile grid, a "Refine" filter button (active-count badge), and the
 * standard 2-column product grid.
 *
 * Reuses the existing SortFilterSheet/SizeGuideModal/ProductCard
 * components — this screen is intentionally a narrowed mirror of
 * `/category/[name].tsx` so future filter logic only needs to be
 * written in one place (SortFilterSheet).
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProductCard, ProductLite } from "@/src/components/ProductCard";
import SizeGuideModal from "@/src/components/SizeGuideModal";
import {
  activeFilterSummary,
  buildProductsQuery,
  DEFAULT_FILTERS,
  FilterState,
  SortFilterSheet,
} from "@/src/components/SortFilterSheet";
import { useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { fetchTaxonomy, TaxonomyNode } from "@/src/lib/nz";
import { colors, radius, spacing } from "@/src/lib/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const GUTTER = 12;
const CARD_W = (SCREEN_W - spacing.lg * 2 - GUTTER) / 2;

const APPAREL_CATEGORIES = [
  "Women's Clothing",
  "Men's Clothing",
  "Kids' Fashion",
  "Shoes",
  "Bags & Luggage",
  "Ethnic Fashion",
  "Jewelry & Accessories",
];

export default function SubcategoryPage() {
  const router = useRouter();
  const toast = useToast();
  const { name, subcategory } = useLocalSearchParams<{
    name: string;
    subcategory: string;
  }>();

  const categoryName = String(name || "");
  const subcategoryName = String(subcategory || "");

  const [items, setItems] = useState<ProductLite[]>([]);
  const [taxonomy, setTaxonomy] = useState<TaxonomyNode | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilter, setShowFilter] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const catParam = `category=${encodeURIComponent(categoryName)}`;
        const subParam = `&subcategory=${encodeURIComponent(subcategoryName)}`;
        const url = `/products?${catParam}${subParam}${buildProductsQuery(filters)}`;
        const [tax, list, brandList] = await Promise.all([
          fetchTaxonomy(),
          api<ProductLite[]>(url, { auth: false }),
          api<string[]>(`/brands?${catParam}`, { auth: false }).catch(() => []),
        ]);
        if (!alive) return;
        setTaxonomy(tax.find((t) => t.name === categoryName) || null);
        setItems(list);
        setBrands(brandList);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [categoryName, subcategoryName, filters]);

  const activeChips = useMemo(() => activeFilterSummary(filters), [filters]);
  const hasActiveFilters = activeChips.length > 0;

  const siblings = taxonomy?.subcategories ?? [];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{
          gap: GUTTER,
          paddingBottom: spacing.xxl,
          paddingTop: spacing.md,
        }}
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            width={CARD_W}
            onPress={() => router.push(`/product/${item.id}`)}
          />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <Pressable
                testID="subcat-back-btn"
                onPress={() => router.back()}
                style={styles.backBtn}
              >
                <ChevronLeft size={22} color={colors.text} />
              </Pressable>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.title} numberOfLines={1}>
                  {subcategoryName}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  in {categoryName}
                </Text>
              </View>
              <Pressable
                testID="subcat-filter-btn"
                onPress={() => setShowFilter(true)}
                style={[
                  styles.filterBtn,
                  hasActiveFilters && styles.filterBtnActive,
                ]}
              >
                <SlidersHorizontal
                  size={18}
                  color={hasActiveFilters ? "#fff" : colors.text}
                />
                {hasActiveFilters ? (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>
                      {activeChips.length}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            </View>

            {/* Breadcrumb */}
            <Pressable
              testID="subcat-breadcrumb"
              onPress={() => router.push("/(tabs)/categories")}
              style={styles.breadcrumb}
            >
              <Text style={styles.crumb}>Categories</Text>
              <ChevronRight size={12} color={colors.textMuted} />
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/category/[name]",
                    params: { name: categoryName },
                  })
                }
                hitSlop={6}
              >
                <Text style={styles.crumb}>{categoryName}</Text>
              </Pressable>
              <ChevronRight size={12} color={colors.textMuted} />
              <Text style={[styles.crumb, styles.crumbActive]} numberOfLines={1}>
                {subcategoryName}
              </Text>
            </Pressable>

            {/* Sibling chip switcher */}
            {siblings.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                {siblings.map((s) => {
                  const active = s === subcategoryName;
                  return (
                    <Pressable
                      key={s}
                      testID={`subcat-sibling-${s.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and")}`}
                      onPress={() => {
                        if (!active) {
                          router.replace({
                            pathname: "/category/[name]/[subcategory]",
                            params: {
                              name: categoryName,
                              subcategory: s,
                            },
                          });
                        }
                      }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.chipTextActive,
                        ]}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {/* Active filter strip */}
            {hasActiveFilters ? (
              <View testID="subcat-active-filters" style={styles.activeWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.activeChipsRow}
                >
                  {activeChips.map((c) => (
                    <View key={c} style={styles.activeChip}>
                      <Text style={styles.activeChipText}>{c}</Text>
                    </View>
                  ))}
                  <Pressable
                    testID="subcat-clear-filters"
                    onPress={() => setFilters(DEFAULT_FILTERS)}
                    style={styles.clearBtn}
                  >
                    <X size={12} color={colors.primary} />
                    <Text style={styles.clearText}>Clear all</Text>
                  </Pressable>
                  <Pressable
                    testID="subcat-save-search"
                    onPress={async () => {
                      try {
                        await api("/me/saved-searches", {
                          method: "POST",
                          body: {
                            name: `${categoryName} · ${subcategoryName}${activeChips[0] ? " · " + activeChips[0] : ""}`.slice(
                              0,
                              60
                            ),
                            category: categoryName,
                            subcategory: subcategoryName,
                            filters,
                            notify: false,
                          },
                        });
                        toast.show({
                          title: "Search saved",
                          body: "Find it in Account → Saved searches.",
                          kind: "success",
                        });
                      } catch (e) {
                        const msg =
                          e instanceof Error ? e.message : "Save failed";
                        toast.show({ title: msg, kind: "error" });
                      }
                    }}
                    style={styles.clearBtn}
                  >
                    <Text style={[styles.clearText, { color: "#7C3AED" }]}>
                      ⭐ Save search
                    </Text>
                  </Pressable>
                </ScrollView>
                <Text style={styles.resultCount}>
                  {loading
                    ? "Loading…"
                    : `${items.length} result${items.length === 1 ? "" : "s"}`}
                </Text>
              </View>
            ) : (
              !loading && (
                <Text style={styles.resultCount}>
                  {items.length} listing{items.length === 1 ? "" : "s"}
                </Text>
              )
            )}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              color={colors.primary}
              style={{ marginVertical: 40 }}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No listings here yet. Try a different subcategory or relax your
                filters.
              </Text>
              {hasActiveFilters ? (
                <Pressable
                  testID="subcat-reset-filters"
                  onPress={() => setFilters(DEFAULT_FILTERS)}
                  style={styles.emptyResetBtn}
                >
                  <Text style={styles.emptyResetText}>Reset filters</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
      />

      <SortFilterSheet
        visible={showFilter}
        initial={filters}
        brands={brands}
        showSizeColor={APPAREL_CATEGORIES.includes(categoryName)}
        onOpenSizeGuide={() => {
          setShowFilter(false);
          setShowSizeGuide(true);
        }}
        onClose={() => setShowFilter(false)}
        onApply={(next) => setFilters(next)}
      />

      <SizeGuideModal
        visible={showSizeGuide}
        category={categoryName}
        onClose={() => setShowSizeGuide(false)}
      />
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
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
  filterBtnActive: { backgroundColor: colors.text, borderColor: colors.text },
  filterBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  filterBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexWrap: "wrap",
  },
  crumb: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  crumbActive: { color: colors.text, fontWeight: "800" },
  chipsRow: {
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  activeWrap: { marginTop: spacing.xs },
  activeChipsRow: {
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    alignItems: "center",
  },
  activeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  activeChipText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.primary,
  },
  clearText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  resultCount: {
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "600",
  },
  empty: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: "center",
    fontSize: 13,
  },
  emptyResetBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.text,
  },
  emptyResetText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
