/**
 * SortFilterSheet — bottom-sheet for shop catalog sort & filter controls.
 *
 * Self-contained presentational component that emits a `FilterState` to the
 * caller. Parent owns the active filters and the data fetch.
 */
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, radius, spacing } from "@/src/lib/theme";

export type SortKey = "relevance" | "price_asc" | "price_desc" | "newest" | "top_rated";

export type FilterState = {
  sort: SortKey;
  minPrice: string;
  maxPrice: string;
  brand: string | null; // null = any brand
  inStockOnly: boolean;
  sizes: string[];
  colors: string[];
  /** Amazon-style "4★ & up" filter. 0 = no rating constraint. */
  minRating: number;
  /** "25% off & up" — only items in an active flash sale at >= this %. */
  minDiscountPct: number;
};

export const DEFAULT_FILTERS: FilterState = {
  sort: "relevance",
  minPrice: "",
  maxPrice: "",
  brand: null,
  inStockOnly: false,
  sizes: [],
  colors: [],
  minRating: 0,
  minDiscountPct: 0,
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "relevance", label: "Relevance" },
  { key: "price_asc", label: "Price · Low to High" },
  { key: "price_desc", label: "Price · High to Low" },
  { key: "newest", label: "Newest first" },
  { key: "top_rated", label: "Top rated" },
];

const PRICE_PRESETS: { label: string; min: string; max: string }[] = [
  { label: "Under $25", min: "", max: "25" },
  { label: "$25 – $50", min: "25", max: "50" },
  { label: "$50 – $100", min: "50", max: "100" },
  { label: "$100 – $250", min: "100", max: "250" },
  { label: "Over $250", min: "250", max: "" },
];

// Amazon-style "Customer review" presets — each is "stars & up".
const RATING_PRESETS: { label: string; value: number }[] = [
  { label: "★ 4 & up", value: 4 },
  { label: "★ 3 & up", value: 3 },
  { label: "★ 2 & up", value: 2 },
  { label: "★ 1 & up", value: 1 },
];

// Active flash-sale discount presets.
const DISCOUNT_PRESETS: { label: string; value: number }[] = [
  { label: "10% off+", value: 10 },
  { label: "25% off+", value: 25 },
  { label: "50% off+", value: 50 },
  { label: "70% off+", value: 70 },
];

// Common apparel sizes & colors. We don't yet pull the catalog facets
// dynamically — these cover ~90% of buyer queries and are intentionally
// short to keep the sheet glanceable on phones.
const SIZE_OPTIONS = ["XS", "S", "M", "L", "XL", "XXL", "Free Size"];
const SHOE_SIZE_OPTIONS = ["6", "7", "8", "9", "10", "11"];
const COLOR_OPTIONS: { name: string; hex: string }[] = [
  { name: "Black", hex: "#0A0A0A" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Grey", hex: "#9CA3AF" },
  { name: "Navy", hex: "#1E3A8A" },
  { name: "Red", hex: "#DC2626" },
  { name: "Maroon", hex: "#7F1D1D" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Green", hex: "#16A34A" },
  { name: "Yellow", hex: "#FACC15" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Gold", hex: "#D4AF37" },
  { name: "Silver", hex: "#C0C0C0" },
];

type Props = {
  visible: boolean;
  initial: FilterState;
  brands: string[];
  /** When true, the sizes & colors sections are shown (catalogue is apparel/lifestyle). */
  showSizeColor?: boolean;
  /** When provided, a small "Size guide" link appears next to the Sizes section. */
  onOpenSizeGuide?: () => void;
  onClose: () => void;
  onApply: (next: FilterState) => void;
};

export function SortFilterSheet({
  visible,
  initial,
  brands,
  showSizeColor = true,
  onOpenSizeGuide,
  onClose,
  onApply,
}: Props) {
  const [state, setState] = useState<FilterState>(initial);

  // Re-seed when reopened with a different starting state.
  useEffect(() => {
    if (visible) setState(initial);
  }, [visible, initial]);

  const reset = () => setState(DEFAULT_FILTERS);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="sortfilter-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Sort & Filter</Text>
            <Pressable testID="sortfilter-close" hitSlop={10} onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            style={{ maxHeight: 480 }}
            contentContainerStyle={{ paddingBottom: spacing.md }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Sort */}
            <Text style={styles.section}>Sort by</Text>
            <View style={styles.chipsWrap}>
              {SORT_OPTIONS.map((opt) => {
                const active = state.sort === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    testID={`sort-chip-${opt.key}`}
                    onPress={() => setState((s) => ({ ...s, sort: opt.key }))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Price presets */}
            <Text style={styles.section}>Price</Text>
            <View style={styles.chipsWrap}>
              {PRICE_PRESETS.map((p) => {
                const active = state.minPrice === p.min && state.maxPrice === p.max;
                return (
                  <Pressable
                    key={p.label}
                    testID={`price-preset-${p.label}`}
                    onPress={() =>
                      setState((s) => ({ ...s, minPrice: p.min, maxPrice: p.max }))
                    }
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Custom price range */}
            <View style={styles.priceRow}>
              <View style={styles.priceField}>
                <Text style={styles.priceLabel}>Min NZD</Text>
                <TextInput
                  testID="price-min-input"
                  keyboardType="numeric"
                  value={state.minPrice}
                  onChangeText={(t) => setState((s) => ({ ...s, minPrice: t.replace(/[^0-9.]/g, "") }))}
                  placeholder="0"
                  placeholderTextColor={colors.textFaint}
                  style={styles.priceInput}
                />
              </View>
              <View style={styles.priceField}>
                <Text style={styles.priceLabel}>Max NZD</Text>
                <TextInput
                  testID="price-max-input"
                  keyboardType="numeric"
                  value={state.maxPrice}
                  onChangeText={(t) => setState((s) => ({ ...s, maxPrice: t.replace(/[^0-9.]/g, "") }))}
                  placeholder="Any"
                  placeholderTextColor={colors.textFaint}
                  style={styles.priceInput}
                />
              </View>
            </View>

            {/* Availability */}
            <Text style={styles.section}>Availability</Text>
            <Pressable
              testID="instock-toggle"
              onPress={() => setState((s) => ({ ...s, inStockOnly: !s.inStockOnly }))}
              style={styles.toggleRow}
            >
              <View style={[styles.checkbox, state.inStockOnly && styles.checkboxOn]}>
                {state.inStockOnly ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={styles.toggleText}>Only show items in stock</Text>
            </Pressable>

            {/* Customer review (Amazon-style "4★ & up") */}
            <Text style={styles.section}>Customer review</Text>
            <View style={styles.chipsWrap}>
              <Pressable
                testID="rating-chip-any"
                onPress={() => setState((s) => ({ ...s, minRating: 0 }))}
                style={[styles.chip, state.minRating === 0 && styles.chipActive]}
              >
                <Text style={[styles.chipText, state.minRating === 0 && styles.chipTextActive]}>
                  Any
                </Text>
              </Pressable>
              {RATING_PRESETS.map((p) => {
                const active = state.minRating === p.value;
                return (
                  <Pressable
                    key={p.value}
                    testID={`rating-chip-${p.value}`}
                    onPress={() => setState((s) => ({ ...s, minRating: p.value }))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Discount (active flash sales) */}
            <Text style={styles.section}>Deals & discount</Text>
            <View style={styles.chipsWrap}>
              <Pressable
                testID="discount-chip-any"
                onPress={() => setState((s) => ({ ...s, minDiscountPct: 0 }))}
                style={[styles.chip, state.minDiscountPct === 0 && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, state.minDiscountPct === 0 && styles.chipTextActive]}
                >
                  Any
                </Text>
              </Pressable>
              {DISCOUNT_PRESETS.map((p) => {
                const active = state.minDiscountPct === p.value;
                return (
                  <Pressable
                    key={p.value}
                    testID={`discount-chip-${p.value}`}
                    onPress={() => setState((s) => ({ ...s, minDiscountPct: p.value }))}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Sizes & colors — only meaningful for apparel/lifestyle catalogs */}
            {showSizeColor ? (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.section}>Sizes</Text>
                  {onOpenSizeGuide ? (
                    <Pressable
                      testID="size-guide-link"
                      onPress={onOpenSizeGuide}
                      hitSlop={8}
                      style={styles.sizeGuideLink}
                    >
                      <Text style={styles.sizeGuideLinkText}>Size guide</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.chipsWrap}>
                  {[...SIZE_OPTIONS, ...SHOE_SIZE_OPTIONS].map((sz) => {
                    const active = state.sizes.includes(sz);
                    return (
                      <Pressable
                        key={sz}
                        testID={`size-chip-${sz}`}
                        onPress={() =>
                          setState((s) => ({
                            ...s,
                            sizes: active
                              ? s.sizes.filter((x) => x !== sz)
                              : [...s.sizes, sz],
                          }))
                        }
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{sz}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.section}>Colors</Text>
                <View style={styles.chipsWrap}>
                  {COLOR_OPTIONS.map((c) => {
                    const active = state.colors.includes(c.name);
                    return (
                      <Pressable
                        key={c.name}
                        testID={`color-chip-${c.name}`}
                        onPress={() =>
                          setState((s) => ({
                            ...s,
                            colors: active
                              ? s.colors.filter((x) => x !== c.name)
                              : [...s.colors, c.name],
                          }))
                        }
                        style={[styles.colorChip, active && styles.colorChipActive]}
                      >
                        <View style={[styles.colorSwatch, { backgroundColor: c.hex }]} />
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* Brand */}
            {brands.length > 0 ? (
              <>
                <Text style={styles.section}>Brand</Text>
                <View style={styles.chipsWrap}>
                  <Pressable
                    testID="brand-chip-any"
                    onPress={() => setState((s) => ({ ...s, brand: null }))}
                    style={[styles.chip, state.brand === null && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, state.brand === null && styles.chipTextActive]}>
                      Any
                    </Text>
                  </Pressable>
                  {brands.slice(0, 40).map((b) => {
                    const active = state.brand === b;
                    return (
                      <Pressable
                        key={b}
                        testID={`brand-chip-${b}`}
                        onPress={() => setState((s) => ({ ...s, brand: b }))}
                        style={[styles.chip, active && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                          {b}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable testID="sortfilter-reset" onPress={reset} style={styles.resetBtn}>
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
            <Pressable
              testID="sortfilter-apply"
              onPress={() => {
                onApply(state);
                onClose();
              }}
              style={styles.applyBtn}
            >
              <Text style={styles.applyText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function buildProductsQuery(filters: FilterState): string {
  const params: string[] = [];
  if (filters.sort && filters.sort !== "relevance") params.push(`sort=${filters.sort}`);
  if (filters.minPrice) params.push(`min_price=${encodeURIComponent(filters.minPrice)}`);
  if (filters.maxPrice) params.push(`max_price=${encodeURIComponent(filters.maxPrice)}`);
  if (filters.brand) params.push(`brand=${encodeURIComponent(filters.brand)}`);
  if (filters.inStockOnly) params.push(`in_stock=true`);
  if (filters.minRating > 0) params.push(`min_rating=${filters.minRating}`);
  if (filters.minDiscountPct > 0)
    params.push(`min_discount_pct=${filters.minDiscountPct}`);
  filters.sizes.forEach((s) => params.push(`sizes=${encodeURIComponent(s)}`));
  filters.colors.forEach((c) => params.push(`colors=${encodeURIComponent(c)}`));
  return params.length ? `&${params.join("&")}` : "";
}

export function activeFilterSummary(filters: FilterState): string[] {
  const out: string[] = [];
  if (filters.sort !== "relevance") {
    const opt = SORT_OPTIONS.find((o) => o.key === filters.sort);
    if (opt) out.push(opt.label);
  }
  if (filters.minPrice || filters.maxPrice) {
    out.push(`$${filters.minPrice || "0"} – $${filters.maxPrice || "∞"}`);
  }
  if (filters.brand) out.push(filters.brand);
  if (filters.inStockOnly) out.push("In stock");
  if (filters.minRating > 0) out.push(`★ ${filters.minRating}+`);
  if (filters.minDiscountPct > 0) out.push(`${filters.minDiscountPct}% off+`);
  if (filters.sizes.length) out.push(`Size ${filters.sizes.join("/")}`);
  if (filters.colors.length) out.push(`${filters.colors.length} colour${filters.colors.length > 1 ? "s" : ""}`);
  return out;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  closeBtn: { padding: 4, borderRadius: 999 },
  section: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  colorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colorChipActive: { backgroundColor: colors.text, borderColor: colors.text },
  colorSwatch: {
    width: 16,
    height: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.15)",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  sizeGuideLink: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginRight: -8,
  },
  sizeGuideLinkText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: colors.primary,
    textDecorationLine: "underline",
  },
  priceRow: { flexDirection: "row", gap: 10, marginTop: spacing.sm },
  priceField: { flex: 1 },
  priceLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 6, fontWeight: "700" },
  priceInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.text, borderColor: colors.text },
  checkmark: { color: "#fff", fontWeight: "800", fontSize: 14 },
  toggleText: { fontSize: 14, color: colors.text, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 12, marginTop: spacing.md },
  resetBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  resetText: { color: colors.text, fontWeight: "700" },
  applyBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.text,
    alignItems: "center",
  },
  applyText: { color: "#fff", fontWeight: "800", letterSpacing: 0.3 },
});
