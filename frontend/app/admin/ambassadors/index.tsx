import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, RefreshCw, Sparkles } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { adminApi, AdminForbidden, AdminUnauthorized } from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type Row = {
  id: string;
  name: string;
  email: string;
  code: string;
  code_b2b: string | null;
  country: string;
  payout_currency: string;
  program: "B2C" | "B2B" | "BOTH";
  status: "active" | "dormant" | "suspended" | "forfeited";
  tier_key: string;
  unpaid_balance: number;
  lifetime_commission: number;
  lifetime_orders: number;
  referred_sellers_count: number;
  joined_at: string;
};

const STATUS_FILTERS: (Row["status"] | "all")[] = [
  "all",
  "active",
  "dormant",
  "suspended",
];

const PROGRAM_FILTERS: ("all" | "B2C" | "B2B" | "BOTH")[] = [
  "all",
  "B2C",
  "B2B",
  "BOTH",
];

export default function AdminAmbassadorsList() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<typeof STATUS_FILTERS[number]>("all");
  const [programFilter, setProgramFilter] = useState<typeof PROGRAM_FILTERS[number]>("all");
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (programFilter !== "all") qs.set("program", programFilter);
      if (unpaidOnly) qs.set("has_unpaid_above", "0.01");
      qs.set("limit", "200");
      const data = await adminApi<Row[]>(`/admin/ambassadors?${qs.toString()}`);
      setRows(data);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized || e instanceof AdminForbidden) {
        toast.show({ title: "Admin access required", kind: "error" });
        router.replace("/admin");
        return;
      }
      toast.show({ title: "Couldn't load", body: e?.message, kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, programFilter, unpaidOnly, toast, router]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      (r.code_b2b || "").toLowerCase().includes(q)
    );
  });

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Ambassadors</Text>
        <Pressable onPress={onRefresh} style={styles.backBtn} testID="admin-amb-refresh">
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Search */}
        <TextInput
          testID="admin-amb-search"
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, email, code…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
        />

        {/* Status filter */}
        <Text style={styles.filterLabel}>STATUS</Text>
        <View style={styles.chipRow}>
          {STATUS_FILTERS.map((s) => (
            <Pressable
              key={s}
              testID={`admin-amb-status-${s}`}
              onPress={() => setStatusFilter(s)}
              style={[styles.chip, statusFilter === s && styles.chipActive]}
            >
              <Text style={[styles.chipText, statusFilter === s && styles.chipTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </View>

        {/* Program filter */}
        <Text style={styles.filterLabel}>PROGRAM</Text>
        <View style={styles.chipRow}>
          {PROGRAM_FILTERS.map((p) => (
            <Pressable
              key={p}
              testID={`admin-amb-program-${p}`}
              onPress={() => setProgramFilter(p)}
              style={[styles.chip, programFilter === p && styles.chipActive]}
            >
              <Text style={[styles.chipText, programFilter === p && styles.chipTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          testID="admin-amb-unpaid-toggle"
          onPress={() => setUnpaidOnly((v) => !v)}
          style={[styles.toggle, unpaidOnly && styles.toggleActive]}
        >
          <Text style={[styles.toggleText, unpaidOnly && styles.toggleTextActive]}>
            {unpaidOnly ? "✓ " : ""}Has unpaid balance only
          </Text>
        </Pressable>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Sparkles size={28} color={colors.textFaint} />
            <Text style={styles.emptyText}>No ambassadors match your filters.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.countLine}>{filtered.length} ambassadors</Text>
            {filtered.map((r) => (
              <Pressable
                key={r.id}
                testID={`admin-amb-row-${r.id}`}
                onPress={() => router.push(`/admin/ambassadors/${r.id}`)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{r.name || r.email}</Text>
                    {r.status !== "active" && (
                      <View style={[styles.statusChip, statusChipColor(r.status)]}>
                        <Text style={styles.statusChipText}>{r.status}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {r.code}{r.code_b2b ? ` · ${r.code_b2b}` : ""} · {r.country} · {r.program}
                  </Text>
                  <Text style={styles.rowStats}>
                    {r.lifetime_orders} orders · lifetime {r.payout_currency}{" "}
                    {r.lifetime_commission.toFixed(2)}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", marginRight: 4 }}>
                  <Text style={styles.unpaid}>
                    {r.payout_currency} {r.unpaid_balance.toFixed(2)}
                  </Text>
                  <Text style={styles.unpaidLabel}>unpaid</Text>
                </View>
                <ChevronRight size={18} color={colors.textFaint} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusChipColor(s: Row["status"]) {
  if (s === "suspended") return { backgroundColor: "#FEE2E2" };
  if (s === "forfeited") return { backgroundColor: "#FEE2E2" };
  if (s === "dormant") return { backgroundColor: colors.surfaceMuted };
  return { backgroundColor: colors.successSoft };
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
  search: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.text,
  },
  filterLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: spacing.xs,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12, color: colors.text, fontWeight: "600", textTransform: "capitalize" },
  chipTextActive: { color: colors.primary, fontWeight: "800" },
  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  toggleActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  toggleText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  toggleTextActive: { color: colors.primary, fontWeight: "800" },
  countLine: { color: colors.textMuted, fontSize: 11, marginTop: spacing.md, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowName: { fontWeight: "800", color: colors.text, fontSize: 14 },
  rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rowStats: { color: colors.textFaint, fontSize: 10, marginTop: 1 },
  unpaid: { color: colors.success, fontWeight: "800", fontSize: 14 },
  unpaidLabel: { color: colors.textFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  statusChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  statusChipText: { fontSize: 9, color: colors.text, fontWeight: "800", textTransform: "uppercase" },
  empty: { alignItems: "center", padding: spacing.xxl, gap: 12 },
  emptyText: { color: colors.textMuted, fontSize: 13 },
});
