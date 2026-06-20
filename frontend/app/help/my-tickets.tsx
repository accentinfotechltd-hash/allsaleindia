/**
 * Buyer's Tickets — `GET /api/support/tickets`.
 *
 * Lightweight read-only list. Tapping a row navigates to the seller-style
 * ticket detail screen, which is already wired against the same backend.
 */
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
import React, { useCallback, useState } from "react";
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
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "awaiting_reply" | "resolved" | "closed";
  sla_breached?: boolean;
  reply_count: number;
  csat_rating?: number | null;
  updated_at: string;
};

const STATUS_COLORS: Record<
  Ticket["status"],
  { bg: string; fg: string; label: string }
> = {
  open: { bg: "#FEF3C7", fg: "#92400E", label: "Open" },
  in_progress: { bg: "#DBEAFE", fg: "#1E3A8A", label: "In progress" },
  awaiting_reply: { bg: "#FFE4D9", fg: "#9A3412", label: "Reply waiting" },
  resolved: { bg: "#D1FAE5", fg: "#065F46", label: "Resolved" },
  closed: { bg: "#E5E7EB", fg: "#374151", label: "Closed" },
};
const PRIORITY_COLORS: Record<Ticket["priority"], string> = {
  low: "#6B7280",
  medium: "#0EA5E9",
  high: "#F59E0B",
  urgent: "#EF4444",
};

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

export default function MyTicketsScreen() {
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
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="my-tickets-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>My tickets</Text>
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
            Have a question about an order, return, or payment? Drop us a
            message and we&apos;ll reply within 1 business day.
          </Text>
          <Pressable
            testID="my-tickets-empty-cta"
            onPress={() => router.push("/help/contact")}
            style={[styles.fabBtn, { marginTop: 16, paddingHorizontal: 24 }]}
          >
            <Plus size={18} color="#fff" />
            <Text style={styles.fabText}>Contact support</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.list}
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
          renderItem={({ item }) => {
            const s = STATUS_COLORS[item.status];
            return (
              <Pressable
                testID={`ticket-${item.id}`}
                onPress={() => router.push(`/help/ticket/${item.id}`)}
                style={({ pressed }) => [
                  styles.card,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={styles.cardTop}>
                  <View
                    style={[styles.statusBadge, { backgroundColor: s.bg }]}
                  >
                    <Text style={[styles.statusText, { color: s.fg }]}>
                      {s.label}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.priorityDot,
                      { backgroundColor: PRIORITY_COLORS[item.priority] },
                    ]}
                  />
                  <Text style={styles.priorityLabel}>
                    {item.priority.toUpperCase()}
                  </Text>
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
                      <Text style={styles.metaText}>
                        {item.reply_count} replies
                      </Text>
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
            );
          }}
        />
      )}

      {items.length > 0 ? (
        <SafeAreaView edges={["bottom"]} style={styles.fab}>
          <Pressable
            testID="my-tickets-new"
            onPress={() => router.push("/help/contact")}
            style={({ pressed }) => [
              styles.fabBtn,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            <Plus size={18} color="#fff" />
            <Text style={styles.fabText}>New ticket</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
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

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    gap: 8,
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  emptyBody: {
    fontSize: 13.5,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },

  list: { padding: spacing.lg, paddingBottom: 140, gap: spacing.md },
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: "800" },
  priorityDot: { width: 6, height: 6, borderRadius: 999 },
  priorityLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  breachPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.error,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  breachText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.4,
  },
  subject: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 20,
  },
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
    height: 52,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
