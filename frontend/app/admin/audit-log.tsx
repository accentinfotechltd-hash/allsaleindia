import { useRouter } from "expo-router";
import { ChevronLeft, ClipboardList, RefreshCw, User } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { adminApi, AdminForbidden, AdminUnauthorized } from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type AuditEntry = {
  id: string;
  admin_id: string;
  admin_email?: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  at: string;
};

const ACTION_COLOURS: Record<string, string> = {
  login: "#0ea5e9",
  logout: "#64748b",
  "seller.approve": "#16a34a",
  "seller.reject": "#dc2626",
  "seller.suspend": "#dc2626",
  "review.delete": "#dc2626",
  "review.hide": "#f97316",
  "review.reject": "#f97316",
  "review.flag": "#facc15",
  "review.approve": "#16a34a",
  "sub_admin.invite": "#8b5cf6",
  "sub_admin.remove": "#dc2626",
  "sub_admin.role_change": "#8b5cf6",
  "order.refund": "#f97316",
  "order.cancel": "#dc2626",
  "financing.approve": "#16a34a",
  "financing.reject": "#dc2626",
  "email.broadcast": "#0ea5e9",
};

const FILTERS = ["all", "seller", "review", "sub_admin", "order", "financing", "login"];

export default function AdminAuditLog() {
  const router = useRouter();
  const { show } = useToast();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await adminApi<AuditEntry[]>("/admin/activity-log?limit=200");
      setItems(Array.isArray(d) ? d : []);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) { router.replace("/admin"); return; }
      if (e instanceof AdminForbidden) { router.replace("/admin"); return; }
      show({ title: e?.message || "Failed to load audit log", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [router, show]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter === "all"
    ? items
    : items.filter(i => i.action.startsWith(filter + ".") || i.action === filter);

  const fmtTime = (s: string) => {
    try {
      const d = new Date(s);
      return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } catch { return s; }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="audit-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Audit log</Text>
          <Text style={styles.headerSub}>{filtered.length} of {items.length} entries</Text>
        </View>
        <Pressable testID="audit-refresh" onPress={load} style={styles.iconBtn} hitSlop={8}>
          <RefreshCw size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f}
            testID={`audit-filter-${f}`}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f && styles.chipActive]}
          >
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <ClipboardList size={28} color={colors.textFaint} />
          <Text style={styles.emptyText}>No activity matches this filter</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, gap: 8 }}
          renderItem={({ item }) => {
            const colour = ACTION_COLOURS[item.action] || "#64748b";
            const metaStr = item.meta && Object.keys(item.meta).length > 0
              ? Object.entries(item.meta).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(" · ")
              : "";
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.dot, { backgroundColor: colour }]} />
                  <Text style={[styles.action, { color: colour }]}>{item.action}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={styles.time}>{fmtTime(item.at)}</Text>
                </View>
                <View style={styles.metaRow}>
                  <User size={11} color={colors.textMuted} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {item.admin_email || item.admin_id}
                  </Text>
                </View>
                {item.target ? (
                  <Text style={styles.target} numberOfLines={1}>target: {item.target}</Text>
                ) : null}
                {metaStr ? (
                  <Text style={styles.meta} numberOfLines={2}>{metaStr}</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  headerSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  filterRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    padding: spacing.md, backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.text, textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 48, gap: 8 },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  card: {
    backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: 4,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  action: { fontSize: 13, fontWeight: "800" },
  time: { fontSize: 11, color: colors.textFaint, fontWeight: "600" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  metaText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  target: { fontSize: 11, color: colors.text, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textFaint, marginTop: 2, fontFamily: "monospace" },
});
