import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  Inbox,
  Plus,
  Star,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Ticket = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  sla_breached: boolean;
  last_reply_at: string | null;
  last_reply_by: string | null;
  reply_count: number;
  csat_rating: number | null;
  created_at: string;
  updated_at: string;
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: "#FEF3C7", fg: "#92400E", label: "Open" },
  in_progress: { bg: "#DBEAFE", fg: "#1E3A8A", label: "In progress" },
  awaiting_reply: { bg: "#FFE4D9", fg: "#9A3412", label: "Reply waiting" },
  resolved: { bg: "#D1FAE5", fg: "#065F46", label: "Resolved" },
  closed: { bg: "#E5E7EB", fg: "#374151", label: "Closed" },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#6B7280",
  medium: "#0EA5E9",
  high: "#F59E0B",
  urgent: "#EF4444",
};

export default function SupportListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Ticket[]>("/support/tickets");
      setItems(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="support-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Support tickets</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <HelpCircle size={32} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No tickets yet</Text>
          <Text style={styles.emptyBody}>
            Need help with payments, orders, KYC or anything else? Raise a ticket and our support team will reply.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.md }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`ticket-${item.id}`}
              onPress={() => router.push(`/seller/support/${item.id}`)}
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: STATUS_COLORS[item.status]?.bg || colors.surface },
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
                <ChevronRight size={16} color={colors.textFaint} />
              </View>
              <Text style={styles.subject} numberOfLines={2}>
                {item.subject}
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
              </View>
            </Pressable>
          )}
        />
      )}

      <SafeAreaView edges={["bottom"]} style={styles.fab}>
        <Pressable
          testID="raise-ticket-cta"
          onPress={() => router.push("/seller/support/new")}
          style={({ pressed }) => [styles.fabBtn, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Plus size={18} color="#fff" />
          <Text style={styles.fabText}>Raise a ticket</Text>
        </Pressable>
      </SafeAreaView>
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
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: 8 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  emptyBody: { fontSize: 13.5, color: colors.textMuted, textAlign: "center", lineHeight: 19 },
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "800" },
  priorityDot: { width: 6, height: 6, borderRadius: 999 },
  priorityLabel: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
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
  subject: { fontSize: 15, fontWeight: "700", color: colors.text, lineHeight: 20 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  metaText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  metaSep: { color: colors.textFaint, marginHorizontal: 2 },
  rated: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 6 },
  ratedText: { fontSize: 12, fontWeight: "700", color: "#92400E" },
  fab: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  fabBtn: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
