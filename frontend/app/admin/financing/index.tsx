import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  HandCoins,
  Landmark,
  RefreshCw,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminUnauthorized, adminApi } from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type App = {
  id: string;
  user_id: string;
  user_email: string;
  partner_id: string;
  partner_name: string;
  desired_advance_nzd: number;
  seller_tier: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const STATUS_TABS: { value: string | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "interest", label: "Interest" },
  { value: "submitted_to_partner", label: "With partner" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  interest: { bg: "#FEF3C7", fg: "#92400E", label: "Interest" },
  submitted_to_partner: { bg: "#DBEAFE", fg: "#1E3A8A", label: "With partner" },
  approved: { bg: "#D1FAE5", fg: "#065F46", label: "Approved" },
  rejected: { bg: "#FEE2E2", fg: "#991B1B", label: "Rejected" },
  withdrawn: { bg: "#E5E7EB", fg: "#374151", label: "Withdrawn" },
};

const PARTNERS = [
  { id: null, label: "All" },
  { id: "kredx", label: "KredX" },
  { id: "cashinvoice", label: "Cashinvoice" },
  { id: "flexiloans", label: "FlexiLoans" },
];

export default function AdminFinancingList() {
  const router = useRouter();
  const [items, setItems] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi<App[]>("/admin/financing", {
        query: {
          status: statusFilter || undefined,
          partner_id: partnerFilter || undefined,
        },
      });
      setItems(data || []);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        Alert.alert(
          "Admin login required",
          "Please unlock the admin dashboard.",
        );
      } else {
        Alert.alert("Failed to load", e?.message || "Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, partnerFilter, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="admin-financing-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={styles.titleRow}>
          <HandCoins size={18} color={colors.primary} />
          <Text style={styles.title}>Financing apps</Text>
        </View>
        <Pressable
          testID="admin-financing-refresh"
          onPress={load}
          style={styles.backBtn}
        >
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* Status tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
      >
        {STATUS_TABS.map((t) => (
          <Pressable
            key={t.label}
            testID={`fin-status-${t.value || "all"}`}
            onPress={() => setStatusFilter(t.value)}
            style={[styles.tab, statusFilter === t.value && styles.tabActive]}
          >
            <Text
              style={[
                styles.tabText,
                statusFilter === t.value && styles.tabTextActive,
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Partner chips */}
      <View style={styles.partnerRow}>
        {PARTNERS.map((p) => (
          <Pressable
            key={p.label}
            testID={`fin-partner-${p.id || "all"}`}
            onPress={() => setPartnerFilter(p.id)}
            style={[
              styles.partnerChip,
              partnerFilter === p.id && styles.partnerChipActive,
            ]}
          >
            <Text
              style={[
                styles.partnerText,
                partnerFilter === p.id && { color: "#fff" },
              ]}
            >
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Filter size={28} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No applications</Text>
          <Text style={styles.emptyBody}>Try clearing filters.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: spacing.xl,
            gap: spacing.md,
          }}
          renderItem={({ item }) => {
            const s = STATUS_STYLE[item.status] || {
              bg: colors.surface,
              fg: colors.text,
              label: item.status,
            };
            return (
              <Pressable
                testID={`fin-${item.id}`}
                onPress={() => router.push(`/admin/financing/${item.id}`)}
                style={({ pressed }) => [
                  styles.card,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
                    <Text style={[styles.statusText, { color: s.fg }]}>
                      {s.label}
                    </Text>
                  </View>
                  {item.seller_tier ? (
                    <View style={styles.tierBadge}>
                      <Text style={styles.tierText}>
                        {item.seller_tier.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <ChevronRight size={16} color={colors.textFaint} />
                </View>
                <View style={styles.partnerLine}>
                  <Landmark size={14} color={colors.primary} />
                  <Text style={styles.partnerName}>{item.partner_name}</Text>
                  <Text style={styles.amount}>
                    NZD {item.desired_advance_nzd.toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.email}>{item.user_email}</Text>
                <Text style={styles.meta}>
                  {new Date(item.created_at).toLocaleString()}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  tabRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 4,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    height: 36,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 12.5, fontWeight: "700", color: colors.textMuted },
  tabTextActive: { color: "#fff" },
  partnerRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexWrap: "wrap",
  },
  partnerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  partnerChipActive: { backgroundColor: colors.text, borderColor: colors.text },
  partnerText: { fontSize: 11.5, fontWeight: "800", color: colors.textMuted },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: 8,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  emptyBody: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "800" },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tierText: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
  partnerLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  partnerName: { fontSize: 15, fontWeight: "800", color: colors.text },
  amount: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.primary,
    marginLeft: "auto",
  },
  email: { fontSize: 12.5, color: colors.textMuted, fontWeight: "600" },
  meta: { fontSize: 11.5, color: colors.textFaint, fontWeight: "600" },
});
