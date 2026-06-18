import { useRouter } from "expo-router";
import { ChevronLeft, Sparkles } from "lucide-react-native";
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

import { useToast } from "@/src/components/UiOverlayProvider";
import {
  AmbassadorMe,
  getMe,
  listReferredSellers,
  ReferredSellerRow,
} from "@/src/lib/ambassadors";
import { colors, radius, spacing } from "@/src/lib/theme";

/**
 * Deep-linkable referred-sellers view (`/ambassadors/dashboard/sellers`).
 * Only meaningful for India ambassadors (program B2B / BOTH). For pure B2C
 * ambassadors we redirect them back to /ambassadors/dashboard.
 */
export default function AmbassadorSellers() {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<AmbassadorMe | null>(null);
  const [rows, setRows] = useState<ReferredSellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await getMe();
      setMe(m);
      if (m.program === "B2C") {
        // Pure B2C ambassadors don't have a B2B funnel — bounce them home.
        router.replace("/ambassadors/dashboard");
        return;
      }
      const r = await listReferredSellers();
      setRows(r);
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("not enrolled")) {
        router.replace("/ambassadors");
        return;
      }
      toast.show({ title: "Couldn't load sellers", body: msg, kind: "error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const totalInr = rows.reduce((s, r) => s + r.earnings_to_date_inr, 0);
  const paidCount = rows.filter((r) => r.bounty_paid).length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="amb-sellers-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Referred sellers</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
      >
        {loading || !me ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <>
            {me.code_b2b && (
              <View style={styles.codeStrip}>
                <Text style={styles.codeStripLabel}>Your B2B code</Text>
                <Text style={styles.codeStripValue}>{me.code_b2b}</Text>
                <Text style={styles.codeStripHint}>Share with Indian businesses to recruit them as Allsale sellers.</Text>
              </View>
            )}

            <View style={styles.summary}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{rows.length}</Text>
                <Text style={styles.summaryLabel}>Sellers</Text>
              </View>
              <View style={styles.summarySep} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>{paidCount}</Text>
                <Text style={styles.summaryLabel}>Bounty paid</Text>
              </View>
              <View style={styles.summarySep} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryValue}>₹{Math.round(totalInr).toLocaleString("en-IN")}</Text>
                <Text style={styles.summaryLabel}>Earned</Text>
              </View>
            </View>

            {rows.length === 0 ? (
              <View style={styles.empty}>
                <Sparkles size={28} color={colors.textFaint} />
                <Text style={styles.emptyText}>
                  No referred sellers yet. Share <Text style={styles.bold}>{me.code_b2b}</Text> with Indian founders — they get 3 months free Pro, you earn ₹5,000 once they ship 5 orders.
                </Text>
              </View>
            ) : (
              rows.map((s) => (
                <View key={s.seller_id} style={styles.row} testID={`amb-seller-${s.seller_id}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sellerName}>{s.seller_name}</Text>
                    <Text style={styles.sellerMeta}>
                      Joined {new Date(s.onboarded_at).toLocaleDateString()} · {s.orders_to_date} orders
                    </Text>
                    <Text style={styles.sellerMeta}>
                      {s.months_in_hot_phase_remaining > 0
                        ? `${s.months_in_hot_phase_remaining}mo hot-phase remaining`
                        : "On tail rate"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.amountInr}>
                      ₹{Math.round(s.earnings_to_date_inr).toLocaleString("en-IN")}
                    </Text>
                    <Text style={[
                      styles.bountyTag,
                      s.bounty_paid && { color: colors.success },
                    ]}>
                      {s.bounty_paid ? "✓ bounty paid" : "bounty pending"}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl * 2 },
  center: { padding: spacing.xxl, alignItems: "center" },
  codeStrip: { backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FED7AA", borderRadius: radius.md, padding: spacing.md, alignItems: "center", gap: 4 },
  codeStripLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  codeStripValue: { fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: 3 },
  codeStripHint: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
  summary: { flexDirection: "row", backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  summaryCol: { flex: 1, alignItems: "center" },
  summaryValue: { fontWeight: "800", color: colors.text, fontSize: 17 },
  summaryLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  summarySep: { width: 1, backgroundColor: colors.border },
  empty: { padding: spacing.xxl, alignItems: "center", gap: 10 },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  bold: { color: colors.text, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  sellerName: { fontWeight: "800", color: colors.text, fontSize: 14 },
  sellerMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  amountInr: { fontWeight: "800", color: colors.text, fontSize: 14 },
  bountyTag: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontWeight: "700" },
});
