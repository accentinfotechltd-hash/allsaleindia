import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronUp, ShieldCheck, SlidersHorizontal, Truck, X } from "lucide-react-native";
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
import SubcategoryTileGrid from "@/src/components/SubcategoryTileGrid";
import { api } from "@/src/lib/api";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { fetchTaxonomy, NZ_FAQS, TRUST_POINTS, TaxonomyNode } from "@/src/lib/nz";
import { colors, radius, spacing } from "@/src/lib/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const GUTTER = 12;
const CARD_W = (SCREEN_W - spacing.lg * 2 - GUTTER) / 2;

export default function CategoryDetail() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const toast = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<ProductLite[]>([]);
  const [taxonomy, setTaxonomy] = useState<TaxonomyNode | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [subcat, setSubcat] = useState<string>("All");
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilter, setShowFilter] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);

  // Fetch products + taxonomy + brands. Re-runs when filters change.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const catParam = `category=${encodeURIComponent(name as string)}`;
        const subParam =
          subcat && subcat !== "All" ? `&subcategory=${encodeURIComponent(subcat)}` : "";
        const productsUrl = `/products?${catParam}${subParam}${buildProductsQuery(filters)}`;
        const [tax, list, brandList] = await Promise.all([
          fetchTaxonomy(),
          api<ProductLite[]>(productsUrl, { auth: false }),
          api<string[]>(`/brands?${catParam}`, { auth: false }).catch(() => []),
        ]);
        if (!alive) return;
        setTaxonomy(tax.find((t) => t.name === name) || null);
        setItems(list);
        setBrands(brandList);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [name, subcat, filters]);

  const filtered = items;
  const activeChips = useMemo(() => activeFilterSummary(filters), [filters]);
  const hasActiveFilters = activeChips.length > 0;

  const chips = ["All", ...(taxonomy?.subcategories ?? [])];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GUTTER, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: GUTTER, paddingBottom: spacing.xxl, paddingTop: spacing.md }}
        renderItem={({ item }) => (
          <ProductCard product={item} width={CARD_W} onPress={() => router.push(`/product/${item.id}`)} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <Pressable testID="category-back-btn" onPress={() => router.back()} style={styles.backBtn}>
                <ChevronLeft size={22} color={colors.text} />
              </Pressable>
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.title}>{name}</Text>
                <Text style={styles.subtitle}>From India → to NZ</Text>
              </View>
              <Pressable
                testID="category-filter-btn"
                onPress={() => setShowFilter(true)}
                style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]}
              >
                <SlidersHorizontal size={18} color={hasActiveFilters ? "#fff" : colors.text} />
                {hasActiveFilters ? (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{activeChips.length}</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>

            {/* Hero */}
            <View style={styles.hero}>
              <Text style={styles.heroEyebrow}>INDIA → NEW ZEALAND</Text>
              <Text style={styles.heroTitle}>
                {taxonomy?.name || name}
              </Text>
              <Text style={styles.heroSub}>Courier from India to NZ in 7-12 days</Text>
              {taxonomy?.blurb ? <Text style={styles.heroBlurb}>{taxonomy.blurb}</Text> : null}
            </View>

            {/* Trust */}
            <View style={styles.trustGrid}>
              {TRUST_POINTS.map((p, i) => (
                <View key={i} style={styles.trustCell}>
                  <ShieldCheck size={14} color={colors.success} />
                  <Text style={styles.trustText}>{p}</Text>
                </View>
              ))}
            </View>

            {/* Prohibited callout */}
            <Pressable
              testID="category-prohibited-link"
              onPress={() => router.push("/help/prohibited-checker")}
              style={styles.prohibited}
            >
              <AlertTriangle size={16} color="#92400E" />
              <Text style={styles.prohibitedText}>
                We can&apos;t ship: fresh food, dairy, meat, seeds, homemade items. <Text style={styles.prohibitedLink}>Check yours →</Text>
              </Text>
            </Pressable>

            {/* Amazon-style subcategory tile grid — shown only on the
                "All" view, hides as soon as the buyer taps a chip
                to scope down. Tiles open the dedicated subcategory
                route for deep-linking & breadcrumb navigation. */}
            {subcat === "All" ? (
              <SubcategoryTileGrid category={String(name)} />
            ) : null}

            {/* Subcategory chips — tapping navigates to the dedicated
                subcategory route (Amazon-style breadcrumb + deep link). */}
            {chips.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {chips.map((c) => {
                  const active = c === subcat;
                  return (
                    <Pressable
                      key={c}
                      testID={`subcat-chip-${c.toLowerCase().replace(/\s+/g, "-").replace(/&/g, "and")}`}
                      onPress={() => {
                        if (c === "All") {
                          setSubcat("All");
                        } else {
                          router.push({
                            pathname: "/category/[name]/[subcategory]",
                            params: { name: String(name), subcategory: c },
                          });
                        }
                      }}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={styles.shippingRow}>
              <Truck size={14} color={colors.primary} />
              <Text style={styles.shippingText}>Auckland 7-10 days · Wellington 8-11 · Christchurch 9-12</Text>
            </View>

            {/* Active filters strip */}
            {hasActiveFilters ? (
              <View testID="active-filter-strip" style={styles.activeFiltersWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeChipsRow}>
                  {activeChips.map((c) => (
                    <View key={c} style={styles.activeChip}>
                      <Text style={styles.activeChipText}>{c}</Text>
                    </View>
                  ))}
                  <Pressable
                    testID="active-filters-clear"
                    onPress={() => setFilters(DEFAULT_FILTERS)}
                    style={styles.clearAllBtn}
                  >
                    <X size={12} color={colors.primary} />
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </Pressable>
                  <Pressable
                    testID="save-search-btn"
                    onPress={async () => {
                      try {
                        await api("/me/saved-searches", {
                          method: "POST",
                          body: {
                            name: `${name}${subcat ? " · " + subcat : ""}${activeChips.length ? " · " + activeChips[0] : ""}`.slice(0, 60),
                            category: name,
                            subcategory: subcat || null,
                            filters,
                            notify: false,
                          },
                        });
                        toast.show({ title: t("toasts.search_saved"), body: t("toasts.search_saved_body"), kind: "success" });
                      } catch (e: any) {
                        toast.show({ title: e?.message || t("toasts.save_failed"), kind: "error" });
                      }
                    }}
                    style={styles.clearAllBtn}
                  >
                    <Text style={[styles.clearAllText, { color: "#7C3AED" }]}>
                      ⭐ Save search
                    </Text>
                  </Pressable>
                </ScrollView>
                <Text style={styles.resultCount}>
                  {loading ? "Loading…" : `${filtered.length} result${filtered.length === 1 ? "" : "s"}`}
                </Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No listings here yet. Verified sellers will appear here soon.</Text>
            </View>
          )
        }
        ListFooterComponent={
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.xl }}>
            <Text style={styles.faqTitle}>NZ shipping FAQ</Text>
            {NZ_FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Pressable
                  key={i}
                  testID={`faq-row-${i}`}
                  onPress={() => setOpenFaq(open ? null : i)}
                  style={styles.faqRow}
                >
                  <View style={styles.faqQuestionRow}>
                    <Text style={styles.faqQuestion}>{f.q}</Text>
                    {open ? <ChevronUp size={16} color={colors.text} /> : <ChevronDown size={16} color={colors.text} />}
                  </View>
                  {open ? <Text style={styles.faqAnswer}>{f.a}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        }
      />

      <SortFilterSheet
        visible={showFilter}
        initial={filters}
        brands={brands}
        showSizeColor={[
          "Women's Clothing",
          "Men's Clothing",
          "Kids' Fashion",
          "Shoes",
          "Bags & Luggage",
          "Ethnic Fashion",
          "Jewelry & Accessories",
        ].includes(String(name))}
        onOpenSizeGuide={() => {
          setShowFilter(false);
          setShowSizeGuide(true);
        }}
        onClose={() => setShowFilter(false)}
        onApply={(next) => setFilters(next)}
      />

      <SizeGuideModal
        visible={showSizeGuide}
        category={String(name || "")}
        onClose={() => setShowSizeGuide(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  hero: { marginHorizontal: spacing.lg, padding: spacing.lg, backgroundColor: colors.text, borderRadius: radius.lg },
  heroEyebrow: { color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  heroTitle: { color: "#fff", fontSize: 24, fontWeight: "800", letterSpacing: -0.6, marginTop: 6 },
  heroSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600", marginTop: 4 },
  heroBlurb: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 10, lineHeight: 18 },
  trustGrid: { flexDirection: "row", marginHorizontal: spacing.lg, marginTop: spacing.md, gap: 8 },
  trustCell: { flex: 1, padding: 8, borderRadius: radius.sm, backgroundColor: colors.successSoft, gap: 4, alignItems: "flex-start" },
  trustText: { color: colors.success, fontSize: 11, fontWeight: "700", lineHeight: 14 },
  prohibited: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: "#FEF3C7",
    borderRadius: radius.md,
  },
  prohibitedText: { fontSize: 12, color: "#78350F", flex: 1, lineHeight: 17 },
  prohibitedLink: { color: "#92400E", fontWeight: "800" },
  chipsRow: { gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  shippingRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  shippingText: { color: colors.textMuted, fontSize: 11 },
  empty: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.textMuted, textAlign: "center", fontSize: 13 },
  faqTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: spacing.sm, letterSpacing: -0.3 },
  faqRow: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8, backgroundColor: "#fff" },
  faqQuestionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  faqQuestion: { fontSize: 13, fontWeight: "700", color: colors.text, flex: 1 },
  faqAnswer: { fontSize: 12, color: colors.textMuted, marginTop: 8, lineHeight: 18 },
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
  activeFiltersWrap: { marginTop: spacing.xs },
  activeChipsRow: { gap: 8, paddingHorizontal: spacing.lg, paddingVertical: 6, alignItems: "center" },
  activeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  activeChipText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  clearAllBtn: {
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
  clearAllText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  resultCount: {
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "600",
  },
});
