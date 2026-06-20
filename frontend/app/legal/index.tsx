/**
 * Legal & Policies hub — one screen listing every policy, fetched from
 * `GET /api/policies`. Single navigable entry point for App Store
 * reviewers and curious buyers alike.
 *
 * Each tile pushes to `/legal/[slug]` for full content. Tile icons + a
 * brand-warm card layout mean the hub feels native to Allsale rather
 * than a wall of text.
 */
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  CreditCard,
  FileText,
  Lock,
  PackageX,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  Store,
  Truck,
  XCircle,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type PolicyMeta = {
  slug: string;
  title: string;
  effective: string;
  last_updated: string;
  description: string;
};

// Static icon + colour mapping per slug. Pure presentation — backend
// stays free of UI concerns.
const ICONS: Record<string, { Icon: any; tint: string }> = {
  terms: { Icon: ScrollText, tint: "#1d4ed8" },
  privacy: { Icon: Lock, tint: "#16a34a" },
  return: { Icon: RefreshCcw, tint: "#f97316" },
  payment: { Icon: CreditCard, tint: "#a21caf" },
  cancellation: { Icon: XCircle, tint: "#dc2626" },
  shipping: { Icon: Truck, tint: "#0891b2" },
  seller: { Icon: Store, tint: "#7c3aed" },
  prohibited: { Icon: PackageX, tint: "#b91c1c" },
  cookies: { Icon: Cookie, tint: "#a16207" },
};

export default function LegalHub() {
  const router = useRouter();
  const { t } = useTranslation();
  const [policies, setPolicies] = useState<PolicyMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<PolicyMeta[]>("/policies");
      setPolicies(data);
    } catch (e: any) {
      setError(e?.message || t("legal_hub.couldnt_load"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="legal-hub-back"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("legal_hub.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <ShieldCheck size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{t("legal_hub.hero_title")}</Text>
            <Text style={styles.heroSub}>{t("legal_hub.hero_sub")}</Text>
          </View>
        </View>

        {policies === null && !error ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={load} style={styles.retryBtn} testID="legal-hub-retry">
              <Text style={styles.retryText}>{t("legal_hub.try_again")}</Text>
            </Pressable>
          </View>
        ) : null}

        {policies?.map((p) => {
          const { Icon, tint } = ICONS[p.slug] || {
            Icon: FileText,
            tint: colors.primary,
          };
          return (
            <Pressable
              key={p.slug}
              testID={`legal-tile-${p.slug}`}
              onPress={() => router.push(`/legal/${p.slug}`)}
              style={({ pressed }) => [
                styles.tile,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={[styles.tileIcon, { backgroundColor: `${tint}1A` }]}>
                <Icon size={18} color={tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tileTitle}>{p.title}</Text>
                <Text style={styles.tileSub} numberOfLines={2}>
                  {p.description}
                </Text>
                <Text style={styles.tileMeta}>{t("legal_hub.updated_prefix", { date: p.last_updated })}</Text>
              </View>
              <ChevronRight size={18} color={colors.textMuted} />
            </Pressable>
          );
        })}

        <View style={{ height: 24 }} />
        <Text style={styles.footer}>{t("legal_hub.footer_line")}</Text>
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

  content: { padding: spacing.lg, gap: 10 },

  heroCard: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    alignItems: "center",
    marginBottom: 6,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontWeight: "800", color: colors.text, fontSize: 15 },
  heroSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  loadingBox: { padding: 24, alignItems: "center" },
  errorBox: {
    padding: 14,
    backgroundColor: "#FEF2F2",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    gap: 8,
    alignItems: "center",
  },
  errorText: { color: colors.error, fontSize: 13, textAlign: "center" },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  retryText: { color: "#fff", fontWeight: "700" },

  tile: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tileTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  tileSub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  tileMeta: { color: colors.textFaint, fontSize: 10, marginTop: 4 },

  footer: {
    textAlign: "center",
    color: colors.textFaint,
    fontSize: 11,
    marginTop: 8,
  },
});
