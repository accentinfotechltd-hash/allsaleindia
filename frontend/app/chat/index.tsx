import { useFocusEffect, useRouter } from "expo-router";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  MessageCircle,
  Pin,
  PinOff,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Conv = {
  id: string;
  buyer_id: string;
  seller_id: string;
  seller_name?: string;
  buyer_name?: string;
  product_id?: string;
  product_name?: string;
  product_image?: string;
  last_message_preview?: string;
  last_message_at?: string;
  unread_count: number;
  pinned: boolean;
  archived: boolean;
};

export default function ChatListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const [items, setItems] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"inbox" | "archive">("inbox");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const replyRef = useRef<TextInput | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tab === "archive") params.append("archived", "true");
      if (query.trim()) params.append("q", query.trim());
      const d = await api<Conv[]>(
        `/chat/conversations${params.toString() ? `?${params}` : ""}`,
      );
      setItems(d || []);
    } catch (e: any) {
      toast.show({ title: t("toasts.couldnt_load_msgs"), body: e?.message || "", kind: "error" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, query, toast]);

  // Refetch when search/tab change, debounced for search
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      load();
    }, query ? 280 : 0);
    return () => clearTimeout(t);
  }, [tab, query, load]);

  // Reload on screen focus (after pin/archive/delete from elsewhere)
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const togglePin = useCallback(
    async (c: Conv) => {
      setBusyId(c.id);
      try {
        await api(`/chat/conversations/${c.id}/${c.pinned ? "unpin" : "pin"}`, { method: "POST" });
        setItems((prev) => {
          const next = prev.map((x) => (x.id === c.id ? { ...x, pinned: !c.pinned } : x));
          // Re-sort pinned-first
          return [...next].sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return (b.last_message_at || "").localeCompare(a.last_message_at || "");
          });
        });
      } catch (e: any) {
        toast.show({ title: t("toasts.couldnt_update"), body: e?.message || "", kind: "error" });
      } finally {
        setBusyId(null);
      }
    },
    [toast],
  );

  const toggleArchive = useCallback(
    async (c: Conv) => {
      setBusyId(c.id);
      try {
        await api(`/chat/conversations/${c.id}/${c.archived ? "unarchive" : "archive"}`, {
          method: "POST",
        });
        // Drop the row from current view (will reappear on the other tab)
        setItems((prev) => prev.filter((x) => x.id !== c.id));
        toast.show({
          title: c.archived ? "Restored to inbox" : "Archived",
          kind: "success",
        });
      } catch (e: any) {
        toast.show({ title: t("toasts.couldnt_update"), body: e?.message || "", kind: "error" });
      } finally {
        setBusyId(null);
      }
    },
    [toast],
  );

  const confirmDelete = useCallback(
    (c: Conv) => {
      Alert.alert(
        "Delete conversation?",
        "This removes the thread from your inbox. The other side still sees it.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setBusyId(c.id);
              try {
                await api(`/chat/conversations/${c.id}`, { method: "DELETE" });
                setItems((prev) => prev.filter((x) => x.id !== c.id));
                toast.show({ title: t("toasts.conv_deleted"), kind: "success" });
              } catch (e: any) {
                toast.show({ title: t("toasts.couldnt_delete"), body: e?.message || "", kind: "error" });
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [toast],
  );

  const sendInlineReply = useCallback(async (c: Conv) => {
    const body = replyText.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await api<{ body: string; created_at: string }>(
        `/chat/conversations/${c.id}/messages`,
        { method: "POST", body: { body } },
      );
      setItems((prev) =>
        prev.map((x) =>
          x.id === c.id
            ? {
                ...x,
                last_message_preview: msg.body,
                last_message_at: msg.created_at,
                unread_count: 0,
              }
            : x,
        ),
      );
      setReplyText("");
      setReplyOpenId(null);
      Keyboard.dismiss();
      toast.show({ title: t("toasts.sent_label"), kind: "success" });
    } catch (e: any) {
      toast.show({ title: t("toasts.couldnt_send"), body: e?.message || "", kind: "error" });
    } finally {
      setSending(false);
    }
  }, [replyText, sending, toast]);

  const renderItem = useCallback(
    ({ item }: { item: Conv }) => {
      const partner = user?.id === item.buyer_id ? item.seller_name : item.buyer_name;
      const isReplying = replyOpenId === item.id;
      return (
        <View style={styles.rowWrap}>
          <Pressable
            testID={`chat-conv-${item.id}`}
            onPress={() => router.push(`/chat/${item.id}`)}
            onLongPress={() => setReplyOpenId(isReplying ? null : item.id)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
          >
            {item.product_image ? (
              <Image source={{ uri: item.product_image }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbFallback]}>
                <MessageCircle size={20} color={colors.textMuted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <View style={styles.topRow}>
                {item.pinned ? <Pin size={11} color={colors.primary} fill={colors.primarySoft} /> : null}
                <Text style={styles.partner} numberOfLines={1}>
                  {partner || "Conversation"}
                </Text>
                {item.last_message_at ? (
                  <Text style={styles.date}>{relativeDate(item.last_message_at)}</Text>
                ) : null}
              </View>
              {item.product_name ? (
                <Text style={styles.product} numberOfLines={1}>
                  about {item.product_name}
                </Text>
              ) : null}
              <Text style={styles.preview} numberOfLines={1}>
                {item.last_message_preview || "Tap to open"}
              </Text>
            </View>
            {item.unread_count > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unread_count > 99 ? "99+" : item.unread_count}
                </Text>
              </View>
            ) : null}
          </Pressable>

          {isReplying ? (
            <View style={styles.composerWrap}>
              <TextInput
                ref={replyRef}
                placeholder="Quick reply…"
                placeholderTextColor={colors.textMuted}
                value={replyText}
                onChangeText={setReplyText}
                style={styles.composerInput}
                multiline
                autoFocus
                maxLength={2000}
              />
              <Pressable
                onPress={() => setReplyOpenId(null)}
                style={styles.composerCancel}
                hitSlop={8}
                testID={`chat-inline-cancel-${item.id}`}
              >
                <X size={16} color={colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => sendInlineReply(item)}
                disabled={!replyText.trim() || sending}
                style={[
                  styles.composerSend,
                  (!replyText.trim() || sending) && { opacity: 0.5 },
                ]}
                testID={`chat-inline-send-${item.id}`}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Send size={14} color="#fff" />
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.actionsRow}>
              <ActionPill
                onPress={() => togglePin(item)}
                busy={busyId === item.id}
                icon={item.pinned ? <PinOff size={13} color={colors.text} /> : <Pin size={13} color={colors.text} />}
                label={item.pinned ? "Unpin" : "Pin"}
                testID={`chat-pin-${item.id}`}
              />
              <ActionPill
                onPress={() => toggleArchive(item)}
                busy={busyId === item.id}
                icon={item.archived ? <ArchiveRestore size={13} color={colors.text} /> : <Archive size={13} color={colors.text} />}
                label={item.archived ? "Restore" : "Archive"}
                testID={`chat-archive-${item.id}`}
              />
              <ActionPill
                onPress={() => setReplyOpenId(item.id)}
                busy={false}
                icon={<Send size={13} color={colors.text} />}
                label="Reply"
                testID={`chat-reply-${item.id}`}
              />
              <ActionPill
                onPress={() => confirmDelete(item)}
                busy={busyId === item.id}
                icon={<Trash2 size={13} color={colors.error} />}
                label="Delete"
                danger
                testID={`chat-delete-${item.id}`}
              />
            </View>
          )}
        </View>
      );
    },
    [user, replyOpenId, replyText, sending, busyId, togglePin, toggleArchive, confirmDelete, sendInlineReply, router],
  );

  const emptyTitle = useMemo(() => {
    if (query) return "No matches";
    return tab === "archive" ? "No archived chats" : "No messages yet";
  }, [tab, query]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Messages</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Search size={14} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by seller or product"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            testID="chat-search-input"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} testID="chat-search-clear">
              <X size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <Pressable
            onPress={() => setTab("inbox")}
            style={[styles.tab, tab === "inbox" && styles.tabActive]}
            testID="chat-tab-inbox"
          >
            <Text style={[styles.tabText, tab === "inbox" && styles.tabTextActive]}>Inbox</Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("archive")}
            style={[styles.tab, tab === "archive" && styles.tabActive]}
            testID="chat-tab-archive"
          >
            <Text style={[styles.tabText, tab === "archive" && styles.tabTextActive]}>Archive</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <MessageCircle size={36} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            {!query && tab === "inbox" ? (
              <Text style={styles.emptySub}>
                Tap "Chat with seller" on any product to start a conversation.
              </Text>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
              />
            }
            renderItem={renderItem}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActionPill({
  onPress,
  icon,
  label,
  busy,
  danger,
  testID,
}: {
  onPress: () => void;
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      testID={testID}
      style={({ pressed }) => [
        styles.pill,
        danger && styles.pillDanger,
        pressed && { opacity: 0.85 },
        busy && { opacity: 0.5 },
      ]}
    >
      {icon}
      <Text style={[styles.pillText, danger && { color: colors.error }]}>{label}</Text>
    </Pressable>
  );
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: colors.text },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },

  tabs: { flexDirection: "row", marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  tabText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  tabTextActive: { color: colors.primary },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  rowWrap: { backgroundColor: "#fff", borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, alignItems: "center" },
  thumb: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.surface },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  partner: { flex: 1, fontSize: 14, fontWeight: "800", color: colors.text },
  date: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  product: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  preview: { fontSize: 13, color: colors.text, marginTop: 2 },
  badge: { minWidth: 22, paddingHorizontal: 6, height: 22, borderRadius: 999, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },

  actionsRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillDanger: { borderColor: colors.error + "44" },
  pillText: { fontSize: 11, fontWeight: "700", color: colors.text },

  composerWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 96,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 13,
    color: colors.text,
  },
  composerCancel: {
    width: 32,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  composerSend: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  emptyTitle: { marginTop: spacing.md, fontSize: 16, fontWeight: "800", color: colors.text },
  emptySub: { marginTop: 6, color: colors.textMuted, fontSize: 13, textAlign: "center" },
});
