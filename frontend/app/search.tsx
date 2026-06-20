import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, Clock, Flame, Search as SearchIcon, X } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import CategoryTileGrid from "@/src/components/CategoryTileGrid";
import { EmptyState } from "@/src/components/EmptyState";
import { SearchSuggestionsSkeleton } from "@/src/components/SkeletonRows";
import { useTranslation } from "@/src/i18n";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type SuggestProduct = { id: string; name: string; image?: string; price_nzd: number; seller_name?: string };
type Suggest = { products: SuggestProduct[]; brands: string[]; categories: string[] };
type Trending = { terms: string[] };

const HISTORY_KEY = "allsale_search_history_v1";
const MAX_HISTORY = 8;
const DEBOUNCE_MS = 240;

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [suggest, setSuggest] = useState<Suggest>({ products: [], brands: [], categories: [] });
  const [trending, setTrending] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput | null>(null);

  // Debounce input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Load history + trending on mount/focus
  const loadStaticContent = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      setHistory(raw ? JSON.parse(raw) : []);
    } catch { /* silent */ }
    try {
      const t = await api<Trending>("/search/trending");
      setTrending(t.terms || []);
    } catch { /* silent */ }
  }, []);
  useFocusEffect(useCallback(() => {
    loadStaticContent();
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [loadStaticContent]));

  // Fetch suggest when debounced changes
  useEffect(() => {
    if (!debounced) {
      setSuggest({ products: [], brands: [], categories: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const d = await api<Suggest>(`/search/suggest?q=${encodeURIComponent(debounced)}`);
        if (!cancelled) setSuggest(d);
      } catch {
        if (!cancelled) setSuggest({ products: [], brands: [], categories: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debounced]);

  const persistHistory = useCallback(async (term: string) => {
    const cleaned = term.trim();
    if (!cleaned) return;
    const next = [cleaned, ...history.filter((h) => h.toLowerCase() !== cleaned.toLowerCase())].slice(0, MAX_HISTORY);
    setHistory(next);
    try { await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* silent */ }
  }, [history]);

  const submit = useCallback(
    async (term?: string) => {
      const final = (term ?? q).trim();
      if (!final) return;
      await persistHistory(final);
      router.push(`/(tabs)/categories?q=${encodeURIComponent(final)}`);
    },
    [q, router, persistHistory],
  );

  const removeHistoryItem = useCallback(async (term: string) => {
    const next = history.filter((h) => h !== term);
    setHistory(next);
    try { await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* silent */ }
  }, [history]);

  const clearHistory = useCallback(async () => {
    setHistory([]);
    try { await AsyncStorage.removeItem(HISTORY_KEY); } catch { /* silent */ }
  }, []);

  const showResults = debounced.length > 0;
  const hasResults = suggest.products.length + suggest.brands.length + suggest.categories.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <View style={styles.inputWrap}>
            <SearchIcon size={16} color={colors.textMuted} />
            <TextInput
              ref={inputRef}
              value={q}
              onChangeText={setQ}
              placeholder="Search products, brands, categories"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              returnKeyType="search"
              onSubmitEditing={() => submit()}
              autoCorrect={false}
              autoCapitalize="none"
              testID="search-input"
            />
            {q ? (
              <Pressable onPress={() => setQ("")} hitSlop={8} testID="search-clear">
                <X size={14} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <FlatList
          data={showResults ? suggest.products : []}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.body}
          ListHeaderComponent={
            <View>
              {/* Section 1: Live suggest */}
              {showResults ? (
                loading && !hasResults ? (
                  <SearchSuggestionsSkeleton />
                ) : !hasResults ? (
                  <EmptyState
                    icon={SearchIcon}
                    title="No matches"
                    subtitle="Try a different spelling, a broader keyword, or browse our categories below."
                    flex={false}
                  />
                ) : (
                  <View>
                    {suggest.categories.length > 0 ? (
                      <Section title="Categories">
                        <View style={styles.chipRow}>
                          {suggest.categories.map((c) => (
                            <Pressable key={c} onPress={() => submit(c)} style={styles.chip} testID={`search-cat-${c}`}>
                              <Text style={styles.chipText}>{c}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </Section>
                    ) : null}
                    {suggest.brands.length > 0 ? (
                      <Section title="Brands">
                        <View style={styles.chipRow}>
                          {suggest.brands.map((b) => (
                            <Pressable key={b} onPress={() => submit(b)} style={styles.chip} testID={`search-brand-${b}`}>
                              <Text style={styles.chipText}>{b}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </Section>
                    ) : null}
                    {suggest.products.length > 0 ? <SectionTitle>Products</SectionTitle> : null}
                  </View>
                )
              ) : (
                <View>
                  {/* Section 2: Recent searches */}
                  {history.length > 0 ? (
                    <Section
                      title="Recent searches"
                      right={
                        <Pressable onPress={clearHistory} hitSlop={6} testID="search-history-clear">
                          <Text style={styles.linkText}>{t("search_screen.clear_all")}</Text>
                        </Pressable>
                      }
                    >
                      <View style={styles.chipRow}>
                        {history.map((h) => (
                          <View key={h} style={styles.histChip}>
                            <Pressable onPress={() => { setQ(h); submit(h); }} testID={`search-history-${h}`}>
                              <View style={styles.histChipInner}>
                                <Clock size={11} color={colors.textMuted} />
                                <Text style={styles.histChipText}>{h}</Text>
                              </View>
                            </Pressable>
                            <Pressable onPress={() => removeHistoryItem(h)} hitSlop={6}>
                              <X size={11} color={colors.textMuted} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </Section>
                  ) : null}

                  {/* Section 3: Trending */}
                  {trending.length > 0 ? (
                    <Section
                      title="Trending"
                      right={<Flame size={14} color={colors.accent} />}
                    >
                      <View style={styles.chipRow}>
                        {trending.map((t) => (
                          <Pressable key={t} onPress={() => { setQ(t); submit(t); }} style={[styles.chip, styles.chipHot]} testID={`search-trending-${t}`}>
                            <Text style={[styles.chipText, { color: colors.accent }]}>{t}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </Section>
                  ) : null}

                  {history.length === 0 && trending.length === 0 ? (
                    <EmptyState
                      icon={SearchIcon}
                      title="Find anything from India"
                      subtitle="Try &ldquo;kurta&rdquo;, &ldquo;spices&rdquo;, &ldquo;handicrafts&rdquo;… or pick a category below."
                      flex={false}
                    />
                  ) : null}

                  {/* Amazon-style "Browse all categories" mosaic — shown
                      whenever no search query is active, regardless of
                      whether the user has history/trending above. Gives
                      buyers a visual entry point into the catalog. */}
                  <CategoryTileGrid />
                </View>
              )}
            </View>
          }
          renderItem={({ item: p }) => (
            <Pressable
              onPress={() => router.push(`/product/${p.id}`)}
              style={({ pressed }) => [styles.prodRow, pressed && { opacity: 0.85 }]}
              testID={`search-product-${p.id}`}
            >
              {p.image ? (
                <Image source={{ uri: p.image }} style={styles.prodImage} />
              ) : (
                <View style={[styles.prodImage, styles.prodImageFallback]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.prodName} numberOfLines={2}>{p.name}</Text>
                {p.seller_name ? <Text style={styles.prodSeller} numberOfLines={1}>{p.seller_name}</Text> : null}
                <Text style={styles.prodPrice}>{formatNZD(p.price_nzd)}</Text>
              </View>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: 6 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontSize: 14, color: colors.text },

  body: { padding: spacing.md, paddingBottom: spacing.xl },
  center: { paddingVertical: spacing.xl, alignItems: "center" },
  empty: { paddingVertical: spacing.xl, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginTop: spacing.sm },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center" },

  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.text, letterSpacing: 0.4, textTransform: "uppercase" },
  linkText: { color: colors.primary, fontSize: 12, fontWeight: "700" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipHot: { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.text },

  histChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  histChipInner: { flexDirection: "row", alignItems: "center", gap: 4 },
  histChipText: { fontSize: 12, fontWeight: "700", color: colors.text },

  prodRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prodImage: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface },
  prodImageFallback: { borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  prodName: { fontSize: 13, fontWeight: "700", color: colors.text },
  prodSeller: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  prodPrice: { fontSize: 13, fontWeight: "800", color: colors.primary, marginTop: 3 },
});
