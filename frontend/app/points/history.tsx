import { useRouter } from "expo-router";
import { ChevronLeft, Sparkles } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Entry = {
  id: string;
  delta: number;
  reason: string;
  title: string;
  created_at: string;
};
type Page = {
  balance: {
    balance: number;
    monetary_value_nzd: number;
    expiring_soon: number;
    earn_rate_per_nzd: number;
    redeem_rate_per_nzd: number;
    welcome_bonus: number;
  };
  items: Entry[];
};

const REASON_KEY: Record<string, string> = {
  signup_bonus: "buyer_points.reason_signup",
  order_earn: "buyer_points.reason_order_earn",
  review_earn: "buyer_points.reason_review",
  order_redeem: "buyer_points.reason_order_redeem",
  manual: "buyer_points.reason_manual",
  expired: "buyer_points.reason_expired",
};

export default function PointsHistoryScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api<Page>("/points/history?limit=100");
      setPage(p);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="points-history-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("buyer_points.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !page ? null : (
        <FlatList
          ListHeaderComponent={
            <View style={styles.summary}>
              <View style={styles.heroCard}>
                <View style={styles.heroIcon}>
                  <Sparkles size={20} color="#fff" />
                </View>
                <View>
                  <Text style={styles.heroBalance}>
                    {page.balance.balance.toLocaleString()}{t("buyer_points.pts_suffix")}
                  </Text>
                  <Text style={styles.heroValue}>
                    {t("buyer_points.nzd_estimate", { amount: page.balance.monetary_value_nzd.toFixed(2) })}
                  </Text>
                </View>
              </View>
              {page.balance.expiring_soon > 0 ? (
                <View style={styles.expBanner}>
                  <Text style={styles.expText}>
                    {t("buyer_points.expiring_soon", { n: page.balance.expiring_soon })}
                  </Text>
                </View>
              ) : null}
              <View style={styles.ratesCard}>
                <Text style={styles.rateRow}>
                  {t("buyer_points.rate_earn_a")}<Text style={styles.bold}>{page.balance.earn_rate_per_nzd}</Text>{t("buyer_points.rate_earn_b")}
                </Text>
                <Text style={styles.rateRow}>
                  {t("buyer_points.rate_redeem_a")}<Text style={styles.bold}>{t("buyer_points.rate_redeem_b", { rate: page.balance.redeem_rate_per_nzd })}</Text>
                </Text>
                <Text style={styles.rateRow}>{t("buyer_points.rate_review")}</Text>
                <Text style={styles.rateRow}>{t("buyer_points.rate_welcome", { n: page.balance.welcome_bonus })}</Text>
                <Text style={styles.rateRow}>{t("buyer_points.rate_cap")}</Text>
              </View>
              <Text style={styles.histTitle}>{t("buyer_points.history_section")}</Text>
            </View>
          }
          data={page.items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {t("buyer_points.empty_text")}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row} testID={`points-entry-${item.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowReason}>
                  {REASON_KEY[item.reason] ? t(REASON_KEY[item.reason]) : item.reason}
                </Text>
                <Text style={styles.rowDate}>
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </View>
              <Text
                style={[
                  styles.delta,
                  item.delta > 0 ? styles.credit : styles.debit,
                ]}
              >
                {item.delta > 0 ? "+" : ""}
                {item.delta.toLocaleString()}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  summary: { padding: spacing.lg, gap: spacing.md },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#7C3AED",
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  heroIcon: { width: 44, height: 44, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  heroBalance: { color: "#fff", fontWeight: "800", fontSize: 24, letterSpacing: -0.6 },
  heroValue: { color: "rgba(255,255,255,0.85)", fontWeight: "700", fontSize: 12, marginTop: 2 },
  expBanner: { backgroundColor: "#FEF3C7", padding: spacing.sm, borderRadius: radius.md },
  expText: { color: "#A16207", fontWeight: "700", fontSize: 12, textAlign: "center" },
  ratesCard: { backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 8 },
  rateRow: { color: colors.text, fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: "800", color: "#7C3AED" },
  histTitle: { fontWeight: "800", color: colors.text, fontSize: 16, marginTop: spacing.sm },
  list: { paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, gap: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowReason: { fontWeight: "700", color: colors.text, fontSize: 13 },
  rowDate: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  delta: { fontWeight: "800", fontSize: 14 },
  credit: { color: colors.success },
  debit: { color: colors.error },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.textMuted, textAlign: "center" },
});
