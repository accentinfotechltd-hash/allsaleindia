import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, MessageCircle, Send } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Msg = { id: string; sender_id: string; sender_role: string; sender_name?: string; body: string; created_at: string };
type Conv = { id: string; buyer_id: string; seller_id: string; seller_name?: string; buyer_name?: string; product_name?: string; product_image?: string; last_message_preview?: string; last_message_at?: string; unread_count: number };
type Thread = { conversation: Conv; messages: Msg[] };

export default function ChatThreadScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const poll = useRef<NodeJS.Timeout | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const t = await api<Thread>(`/chat/conversations/${id}`);
      setThread(t);
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); poll.current = setInterval(load, 5000); return () => { if (poll.current) clearInterval(poll.current); }; }, [load]);
  useEffect(() => { if (thread && listRef.current) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100); }, [thread?.messages.length]);

  const onSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api(`/chat/conversations/${id}/messages`, { method: "POST", body: { body } });
      setText("");
      await load();
    } finally { setSending(false); }
  };

  if (loading || !thread) return <SafeAreaView style={styles.container}><View style={styles.center}><ActivityIndicator color={colors.primary} /></View></SafeAreaView>;
  const conv = thread.conversation;
  const partnerName = user?.id === conv.buyer_id ? conv.seller_name : conv.buyer_name;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="chat-back" onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={22} color={colors.text} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{partnerName || "Chat"}</Text>
          {conv.product_name ? <Text style={styles.subtitle} numberOfLines={1}>about {conv.product_name}</Text> : null}
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}>
        <FlatList
          ref={listRef}
          data={thread.messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.id;
            return (
              <View style={[styles.bubbleWrap, mine ? styles.right : styles.left]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{item.body}</Text>
                </View>
                <Text style={styles.time}>{new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
              </View>
            );
          }}
          ListEmptyComponent={<View style={styles.empty}><MessageCircle size={32} color={colors.textFaint} /><Text style={styles.emptyText}>Say hi 👋</Text></View>}
        />
        <View style={styles.inputBar}>
          <TextInput testID="chat-input" value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor={colors.textFaint} style={styles.input} multiline maxLength={2000} />
          <Pressable testID="chat-send" onPress={onSend} disabled={sending || !text.trim()} style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]}>{sending ? <ActivityIndicator color="#fff" /> : <Send size={18} color="#fff" />}</Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "800", color: colors.text, fontSize: 15 },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: 6, flexGrow: 1 },
  bubbleWrap: { maxWidth: "78%", marginBottom: 4 },
  right: { alignSelf: "flex-end", alignItems: "flex-end" },
  left: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 19 },
  time: { color: colors.textFaint, fontSize: 10, marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { color: colors.textMuted },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#fff" },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 14, maxHeight: 100 },
  send: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
