import { useFocusEffect, useRouter } from "expo-router";
import { ChevronDown, ChevronLeft, ChevronUp, Search as SearchIcon, X } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type FaqItem = { slug: string; category: string; question: string; answer: string };
type FaqCategory = { slug: string; label: string; icon?: string };
type FaqPage = { categories: FaqCategory[]; items: FaqItem[]; total: number };
type FaqSearch = { query: string; results: FaqItem[]; total: number };

const DEBOUNCE_MS = 240;

export default function FaqScreen() {
  const router = useRouter();
  const [page, setPage] = useState<FaqPage | null>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searchResults, setSearchResults] = useState<FaqItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);

  // Load full FAQ catalog on mount
  useEffect(() => {
    (async () => {
      try {
        const p = await api<FaqPage>("/site/faq");
        setPage(p);
      } catch {
        /* silent */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Server-side search
  useEffect(() => {
    if (!debounced) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      try {
        const r = await api<FaqSearch>(`/site/faq/search?q=${encodeURIComponent(debounced)}`);
        if (!cancelled) setSearchResults(r.results || []);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debounced]);

  useFocusEffect(useCallback(() => {
    // No-op; data is loaded once and stable
  }, []));

  const itemsToShow = useMemo(() => {
    if (debounced) return searchResults;
    if (!page) return [];
    if (activeCat) return page.items.filter((i) => i.category === activeCat);
    return page.items;
  }, [page, activeCat, debounced, searchResults]);

  const grouped = useMemo(() => {
    if (debounced || !page) return null;
    const map = new Map<string, FaqItem[]>();
    for (const it of itemsToShow) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return Array.from(map.entries());
  }, [page, itemsToShow, debounced]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

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
          <Text style={styles.title}>Help & FAQ</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchWrap}>
          <SearchIcon size={14} color={colors.textMuted} />
          <TextInput
            ref={inputRef}
            value={q}
            onChangeText={setQ}
            placeholder="Search the help centre"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            testID="faq-search-input"
          />
          {q ? (
            <Pressable onPress={() => setQ("")} hitSlop={8} testID="faq-search-clear">
              <X size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Category chips — hidden while searching */}
        {!debounced && page?.categories ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <Pressable
              onPress={() => setActiveCat(null)}
              style={[styles.chip, !activeCat && styles.chipActive]}
              testID="faq-cat-all"
            >
              <Text style={[styles.chipText, !activeCat && styles.chipTextActive]}>All</Text>
            </Pressable>
            {page.categories.map((c) => (
              <Pressable
                key={c.slug}
                onPress={() => setActiveCat(activeCat === c.slug ? null : c.slug)}
                style={[styles.chip, activeCat === c.slug && styles.chipActive]}
                testID={`faq-cat-${c.slug}`}
              >
                <Text style={[styles.chipText, activeCat === c.slug && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {debounced ? (
            searching ? (
              <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
            ) : searchResults.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No matches for "{debounced}"</Text>
                <Text style={styles.emptySub}>Try a different keyword or browse by category.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.resultsHeader}>
                  {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
                </Text>
                {searchResults.map((it) => (
                  <FaqRow
                    key={it.slug}
                    item={it}
                    open={openSlug === it.slug}
                    onToggle={() => setOpenSlug(openSlug === it.slug ? null : it.slug)}
                  />
                ))}
              </>
            )
          ) : (
            grouped?.map(([catSlug, items]) => {
              const cat = page!.categories.find((c) => c.slug === catSlug);
              return (
                <View key={catSlug} style={{ marginBottom: spacing.lg }}>
                  <Text style={styles.sectionTitle}>{cat?.label || catSlug}</Text>
                  {items.map((it) => (
                    <FaqRow
                      key={it.slug}
                      item={it}
                      open={openSlug === it.slug}
                      onToggle={() => setOpenSlug(openSlug === it.slug ? null : it.slug)}
                    />
                  ))}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FaqRow({ item, open, onToggle }: { item: FaqItem; open: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={styles.row} testID={`faq-row-${item.slug}`}>
      <View style={styles.rowHead}>
        <Text style={styles.question} numberOfLines={open ? undefined : 2}>{item.question}</Text>
        {open ? <ChevronUp size={16} color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textMuted} />}
      </View>
      {open ? <Text style={styles.answer}>{item.answer}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: colors.text },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },

  chipsRow: { gap: 8, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  chipTextActive: { color: colors.primary },

  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.text, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: spacing.sm },
  resultsHeader: { fontSize: 12, color: colors.textMuted, fontWeight: "700", marginBottom: spacing.sm },

  row: {
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  question: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.text },
  answer: { marginTop: 8, fontSize: 13, color: colors.textMuted, lineHeight: 19 },

  center: { paddingVertical: spacing.xl, alignItems: "center" },
  empty: { paddingVertical: spacing.xl, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
});
