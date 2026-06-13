import { useRouter } from "expo-router";
import { ChevronLeft, MessageCircle } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Conv = { id: string; buyer_id: string; seller_id: string; seller_name?: string; buyer_name?: string; product_name?: string; product_image?: string; last_message_preview?: string; last_message_at?: string; unread_count: number };

export default function ChatListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => { try { const d = await api<Conv[]>("/chat/conversations"); setItems(d || []); } finally { setLoading(false); setRefreshing(false); } }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></Pressable>
        <Text style={styles.title}>Messages</Text>
        <View style={{ width: 40 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : items.length === 0 ? (
        <View style={styles.empty}><MessageCircle size={36} color={colors.textFaint} /><Text style={styles.emptyTitle}>No messages yet</Text><Text style={styles.emptySub}>Tap "Chat with seller" on any product to start.</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => {
            const partner = user?.id === item.buyer_id ? item.seller_name : item.buyer_name;
            return (
              <Pressable testID={`chat-conv-${item.id}`} onPress={() => router.push(`/chat/${item.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}>
                {item.product_image ? <Image source={{ uri: item.product_image }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" }]}><MessageCircle size={20} color={colors.textMuted} /></View>}
                <View style={{ flex: 1 }}>
                  <View style={styles.topRow}>
                    <Text style={styles.partner} numberOfLines={1}>{partner || "Conversation"}</Text>
                    {item.last_message_at ? <Text style={styles.date}>{new Date(item.last_message_at).toLocaleDateString()}</Text> : null}
                  </View>
                  {item.product_name ? <Text style={styles.product} numberOfLines={1}>about {item.product_name}</Text> : null}
                  <Text style={styles.preview} numberOfLines={1}>{item.last_message_preview || "Tap to open"}</Text>
                </View>
                {item.unread_count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{item.unread_count}</Text></View> : null}
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
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: spacing.xl },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  emptySub: { color: colors.textMuted, textAlign: "center" },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  thumb: { width: 48, height: 48, borderRadius: radius.md },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  partner: { fontWeight: "800", color: colors.text, fontSize: 14, flex: 1 },
  date: { color: colors.textMuted, fontSize: 11 },
  product: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  preview: { color: colors.text, fontSize: 13, marginTop: 2 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 11 },
});
