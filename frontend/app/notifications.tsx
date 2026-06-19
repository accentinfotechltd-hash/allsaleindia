import { useFocusEffect, useRouter } from "expo-router";
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  PackageX,
  PackageCheck,
  Receipt,
  Truck,
} from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Notification = {
  id: string;
  role: string;
  type: string;
  title: string;
  body: string;
  order_id?: string;
  read: boolean;
  created_at: string;
};

function iconFor(type: string) {
  switch (type) {
    case "order_placed":
      return <Receipt size={18} color={colors.primary} />;
    case "new_order":
      return <PackageCheck size={18} color={colors.primary} />;
    case "order_cancelled":
      return <PackageX size={18} color={colors.error} />;
    case "order_shipped":
    case "out_for_delivery":
    case "order_out_for_delivery":
    case "shipment_milestone_arrived_in_destination":
    case "shipment_milestone_customs_cleared":
      return <Truck size={18} color={colors.accent} />;
    case "order_delivered":
    case "proof_of_delivery_uploaded":
    case "order_received_by_buyer":
      return <CheckCircle2 size={18} color={colors.success} />;
    case "return_requested":
    case "return_approved":
    case "return_rejected":
    case "return_received":
      return <PackageX size={18} color={colors.accent} />;
    default:
      return <Bell size={18} color={colors.textMuted} />;
  }
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch {
    return "";
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api<Notification[]>("/notifications");
      setItems(res || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const markAllRead = useCallback(async () => {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // ignore
    }
  }, []);

  const onItemPress = useCallback(
    async (n: Notification) => {
      if (!n.read) {
        try {
          await api(`/notifications/${n.id}/read`, { method: "POST" });
        } catch {
          // ignore
        }
        setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)));
      }
      if (n.order_id) router.push(`/order/${n.order_id}`);
    },
    [router]
  );

  const unread = items.filter((n) => !n.read).length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="notif-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <Pressable
          testID="notif-mark-all-btn"
          onPress={markAllRead}
          disabled={unread === 0}
          style={{ width: 80, alignItems: "flex-end" }}
        >
          <Text
            style={[styles.markRead, unread === 0 && { color: colors.textFaint }]}
          >
            Mark read
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Bell size={36} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
          <Text style={styles.emptySub}>
            Order updates, cancellations and delivery alerts will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`notif-item-${item.id}`}
              onPress={() => onItemPress(item)}
              style={({ pressed }) => [
                styles.card,
                !item.read && styles.cardUnread,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.icon}>{iconFor(item.type)}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.cardBody} numberOfLines={2}>
                  {item.body}
                </Text>
                <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
              {!item.read ? <View style={styles.dot} /> : null}
            </Pressable>
          )}
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
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  markRead: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 8 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center", maxWidth: 280 },
  card: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUnread: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  cardBody: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  cardTime: { fontSize: 11, color: colors.textFaint, marginTop: 4, fontWeight: "600" },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignSelf: "center",
  },
});
