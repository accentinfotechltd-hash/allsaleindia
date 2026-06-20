/**
 * Help Center — top-level landing screen.
 *
 * Single entry-point for buyer support. Surfaces:
 *   • Search-driven FAQ (POSTs to existing /api/site/faq)
 *   • Quick links: Contact support, My tickets, Prohibited checker, Legal hub
 *   • Top 6 FAQ snippets so the screen feels alive at first load
 *
 * Backend endpoints used here are all pre-existing:
 *   GET /api/site/faq                  → FAQ catalog
 *   GET /api/site/faq/search?q=…       → server-side search
 *   POST /api/support/tickets          → covered in /help/contact
 *   GET  /api/support/tickets          → covered in /help/my-tickets
 */
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Inbox,
  MessageCircle,
  PackageX,
  ScrollText,
  Search,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

type FaqItem = {
  slug: string;
  category: string;
  question: string;
  answer: string;
};
type FaqCategory = { slug: string; label: string };
type FaqPage = { categories: FaqCategory[]; items: FaqItem[]; total: number };

const DEBOUNCE_MS = 240;

const QUICK_LINKS = [
  {
    key: "contact",
    title: "Contact support",
    subtitle: "Talk to a human · usually replies in 1 day",
    Icon: MessageCircle,
    tint: "#1d4ed8",
    href: "/help/contact",
  },
  {
    key: "tickets",
    title: "My tickets",
    subtitle: "Track an open conversation",
    Icon: Inbox,
    tint: "#16a34a",
    href: "/help/my-tickets",
  },
  {
    key: "prohibited",
    title: "Can I import this?",
    subtitle: "Check before you buy — NZ biosecurity & customs",
    Icon: PackageX,
    tint: "#b91c1c",
    href: "/help/prohibited-checker",
  },
  {
    key: "legal",
    title: "Legal & policies",
    subtitle: "Terms · Privacy · Shipping · Returns",
    Icon: ScrollText,
    tint: "#7c3aed",
    href: "/legal",
  },
] as const;

export default function HelpHub() {
  const router = useRouter();
  const [page, setPage] = useState<FaqPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FaqItem[] | null>(null);

  // Initial catalog load
  useEffect(() => {
    (async () => {
      try {
        const p = await api<FaqPage>("/site/faq");
        setPage(p);
      } catch {
        // silent — the page still works for quick links + contact form
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Server-side FAQ search
  useEffect(() => {
    if (debounced.length < 2) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    api<{ results: FaqItem[] }>(`/site/faq/search?q=${encodeURIComponent(debounced)}`)
      .then((d) => {
        if (!cancelled) setSearchResults(d.results || []);
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const goToFaq = useCallback(
    () => router.push("/help/faq"),
    [router]
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="help-hub-back"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Help Center</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero search */}
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroSub}>
            Search 19 FAQs, browse policies, or message our team.
          </Text>
          <View style={styles.searchBar}>
            <Search size={16} color={colors.textMuted} />
            <TextInput
              testID="help-search-input"
              value={q}
              onChangeText={setQ}
              placeholder="Try “return policy” or “tracking”"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Search results overlay (shown while typing) */}
        {searchResults !== null ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              {searching
                ? "Searching…"
                : `${searchResults.length} result${
                    searchResults.length === 1 ? "" : "s"
                  }`}
            </Text>
            {searchResults.length === 0 && !searching ? (
              <Pressable
                onPress={() => router.push("/help/contact")}
                style={styles.emptySearchCard}
                testID="help-no-results-contact"
              >
                <Text style={styles.emptyTitle}>No match yet.</Text>
                <Text style={styles.emptySub}>
                  Want to ask our team directly?
                </Text>
                <View style={styles.contactBtn}>
                  <Text style={styles.contactBtnText}>Contact support</Text>
                </View>
              </Pressable>
            ) : null}
            {searchResults.map((it) => (
              <Pressable
                key={it.slug}
                testID={`help-search-result-${it.slug}`}
                style={styles.faqRow}
                onPress={goToFaq}
              >
                <Text style={styles.faqQ}>{it.question}</Text>
                <Text style={styles.faqA} numberOfLines={2}>
                  {it.answer}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            {/* Quick links */}
            <View style={styles.linksRow}>
              {QUICK_LINKS.map(({ key, title, subtitle, Icon, tint, href }) => (
                <Pressable
                  key={key}
                  testID={`help-quick-${key}`}
                  onPress={() => router.push(href as any)}
                  style={({ pressed }) => [
                    styles.quickCard,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.quickIcon, { backgroundColor: `${tint}1A` }]}>
                    <Icon size={18} color={tint} />
                  </View>
                  <Text style={styles.quickTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.quickSub} numberOfLines={2}>
                    {subtitle}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Featured FAQs preview */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>Popular questions</Text>
                <Pressable onPress={goToFaq} testID="help-see-all-faqs">
                  <Text style={styles.linkText}>See all →</Text>
                </Pressable>
              </View>
              {loading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : (
                (page?.items || []).slice(0, 6).map((it) => (
                  <Pressable
                    key={it.slug}
                    testID={`help-popular-${it.slug}`}
                    style={styles.faqRow}
                    onPress={goToFaq}
                  >
                    <HelpCircle
                      size={14}
                      color={colors.primary}
                      style={{ marginTop: 2 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.faqQ}>{it.question}</Text>
                      <Text style={styles.faqA} numberOfLines={2}>
                        {it.answer}
                      </Text>
                    </View>
                    <ChevronRight size={14} color={colors.textMuted} />
                  </Pressable>
                ))
              )}
            </View>
          </>
        )}

        <View style={{ height: 32 }} />
        <Text style={styles.footer}>
          Allsale Support · support@allsale.co.nz
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "800",
    color: colors.text,
    fontSize: 16,
  },
  content: { padding: spacing.lg, gap: 16 },

  heroCard: {
    padding: spacing.lg,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    gap: 8,
  },
  heroTitle: { fontSize: 22, fontWeight: "800", color: colors.text },
  heroSub: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 4,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14 },

  linksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickCard: {
    flexBasis: "48%",
    flexGrow: 1,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  quickTitle: { fontWeight: "800", color: colors.text, fontSize: 13 },
  quickSub: { color: colors.textMuted, fontSize: 11, lineHeight: 14 },

  section: { gap: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    fontWeight: "800",
    color: colors.text,
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  linkText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  center: { padding: 24, alignItems: "center" },

  faqRow: {
    flexDirection: "row",
    gap: 10,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "flex-start",
  },
  faqQ: { color: colors.text, fontWeight: "700", fontSize: 13 },
  faqA: { color: colors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 16 },

  emptySearchCard: {
    padding: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
    alignItems: "center",
  },
  emptyTitle: { color: colors.text, fontWeight: "800", fontSize: 15 },
  emptySub: { color: colors.textMuted, fontSize: 12 },
  contactBtn: {
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  contactBtnText: { color: "#fff", fontWeight: "800" },

  footer: {
    textAlign: "center",
    color: colors.textFaint,
    fontSize: 11,
  },
});
