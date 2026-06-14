import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Inbox,
  LifeBuoy,
  RefreshCw,
  Star,
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

type Ticket = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  user_role: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  assignee_name: string | null;
  sla_breached: boolean;
  reply_count: number;
  csat_rating: number | null;
  last_reply_at: string | null;
  last_reply_by: string | null;
  updated_at: string;
  created_at: string;
};

const STATUS_TABS: { value: string | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_reply", label: "Awaiting reply" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: "#FEF3C7", fg: "#92400E", label: "Open" },
  in_progress: { bg: "#DBEAFE", fg: "#1E3A8A", label: "In progress" },
  awaiting_reply: { bg: "#FFE4D9", fg: "#9A3412", label: "Awaiting" },
  resolved: { bg: "#D1FAE5", fg: "#065F46", label: "Resolved" },
  closed: { bg: "#E5E7EB", fg: "#374151", label: "Closed" },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#6B7280",
  medium: "#0EA5E9",
  high: "#F59E0B",
  urgent: "#EF4444",
};

export default function AdminTicketsListScreen() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [breachedOnly, setBreachedOnly] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi<Ticket[]>("/admin/tickets", {
        query: {
          status: statusFilter || undefined,
          priority: priorityFilter || undefined,
          breached_only: breachedOnly || undefined,
        },
      });
      setTickets(data || []);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        Alert.alert(
          "Admin login required",
          "Please unlock the admin dashboard first.",
          [
            { text: "Go", onPress: () => router.replace("/admin") },
          ],
        );
      } else {
        Alert.alert("Failed to load", e?.message || "Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, breachedOnly, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="admin-tickets-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={styles.titleRow}>
          <LifeBuoy size={18} color={colors.primary} />
          <Text style={styles.title}>Support tickets</Text>
        </View>
        <Pressable testID="admin-tickets-refresh" onPress={load} style={styles.backBtn}>
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
            testID={`status-tab-${t.value || "all"}`}
            onPress={() => setStatusFilter(t.value)}
            style={[styles.tab, statusFilter === t.value && styles.tabActive]}
          >
            <Text
              style={[styles.tabText, statusFilter === t.value && styles.tabTextActive]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Secondary filters */}
      <View style={styles.subFilters}>
        <Pressable
          testID="filter-breached"
          onPress={() => setBreachedOnly((b) => !b)}
          style={[styles.filterChip, breachedOnly && styles.filterChipActive]}
        >
          <AlertCircle size={12} color={breachedOnly ? "#fff" : colors.error} />
          <Text style={[styles.filterChipText, breachedOnly && { color: "#fff" }]}>
            SLA breached
          </Text>
        </Pressable>
        {["urgent", "high", "medium", "low"].map((p) => (
          <Pressable
            key={p}
            testID={`filter-pri-${p}`}
            onPress={() => setPriorityFilter((cur) => (cur === p ? null : p))}
            style={[styles.filterChip, priorityFilter === p && styles.filterChipActive]}
          >
            <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[p] }]} />
            <Text
              style={[
                styles.filterChipText,
                priorityFilter === p && { color: "#fff" },
              ]}
            >
              {p.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Filter size={28} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No tickets match</Text>
          <Text style={styles.emptyBody}>
            Try clearing filters or check back later.
          </Text>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: spacing.xl,
            gap: spacing.md,
          }}
          renderItem={({ item }) => (
            <Pressable
              testID={`admin-ticket-${item.id}`}
              onPress={() => router.push(`/admin/tickets/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        STATUS_COLORS[item.status]?.bg || colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: STATUS_COLORS[item.status]?.fg || colors.text },
                    ]}
                  >
                    {STATUS_COLORS[item.status]?.label || item.status}
                  </Text>
                </View>
                <View
                  style={[
                    styles.priorityDot,
                    { backgroundColor: PRIORITY_COLORS[item.priority] || colors.textMuted },
                  ]}
                />
                <Text style={styles.priorityLabel}>{item.priority.toUpperCase()}</Text>
                {item.sla_breached ? (
                  <View style={styles.breachPill}>
                    <AlertCircle size={11} color="#fff" />
                    <Text style={styles.breachText}>SLA</Text>
                  </View>
                ) : null}
                <View style={{ flex: 1 }} />
                {item.last_reply_by === "seller" && item.status !== "closed" ? (
                  <View style={styles.newReplyDot} />
                ) : null}
                <ChevronRight size={16} color={colors.textFaint} />
              </View>
              <Text style={styles.subject} numberOfLines={2}>
                {item.subject}
              </Text>
              <Text style={styles.userLine} numberOfLines={1}>
                {item.user_name || item.user_email} · {item.user_email}
              </Text>
              <View style={styles.cardMeta}>
                <Inbox size={12} color={colors.textMuted} />
                <Text style={styles.metaText}>{item.category}</Text>
                <Text style={styles.metaSep}>·</Text>
                <Clock size={12} color={colors.textMuted} />
                <Text style={styles.metaText}>{relTime(item.updated_at)}</Text>
                {item.reply_count > 0 ? (
                  <>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.metaText}>{item.reply_count} replies</Text>
                  </>
                ) : null}
                {item.csat_rating ? (
                  <View style={styles.rated}>
                    <Star size={11} color="#F59E0B" fill="#F59E0B" />
                    <Text style={styles.ratedText}>{item.csat_rating}</Text>
                  </View>
                ) : null}
                {item.assignee_name ? (
                  <>
                    <Text style={styles.metaSep}>·</Text>
                    <Text style={styles.metaText}>→ {item.assignee_name}</Text>
                  </>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
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
  subFilters: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexWrap: "wrap",
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  filterChipActive: { backgroundColor: colors.text, borderColor: colors.text },
  filterChipText: { fontSize: 10.5, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.3 },
  priorityDot: { width: 8, height: 8, borderRadius: 999 },
  priorityLabel: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
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
    gap: 6,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "800" },
  breachPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.error,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  breachText: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.4 },
  newReplyDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.primary },
  subject: { fontSize: 15, fontWeight: "700", color: colors.text, lineHeight: 19 },
  userLine: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  metaText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  metaSep: { color: colors.textFaint, marginHorizontal: 2 },
  rated: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 4 },
  ratedText: { fontSize: 12, fontWeight: "700", color: "#92400E" },
});
