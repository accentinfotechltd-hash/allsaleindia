import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  CheckCircle2,
  Lock,
  MessageSquare,
  Send,
  Shield,
  Star,
  StickyNote,
  XCircle,
} from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminUnauthorized, adminApi } from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type Msg = {
  id: string;
  sender_role: string;
  sender_name: string | null;
  body: string;
  attachments: string[];
  is_internal_note: boolean;
  created_at: string;
};

type Ticket = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  subject: string;
  category: string;
  priority: string;
  status: string;
  sla_breached: boolean;
  csat_rating: number | null;
  csat_comment: string | null;
  assignee_name: string | null;
  resolved_at: string | null;
  created_at: string;
};

type Detail = { ticket: Ticket; messages: Msg[] };

const STATUSES = [
  { value: "open", label: "Reopen", color: "#92400E" },
  { value: "in_progress", label: "In progress", color: "#1E3A8A" },
  { value: "resolved", label: "Resolve", color: "#065F46" },
  { value: "closed", label: "Close", color: "#374151" },
];

export default function AdminTicketDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await adminApi<Detail>(`/admin/tickets/${id}`);
      setDetail(d);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 80);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        Alert.alert("Admin login required", "Please unlock the admin dashboard.", [
          { text: "OK", onPress: () => router.replace("/admin") },
        ]);
      } else {
        Alert.alert("Could not load", e?.message || "Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const send = useCallback(async () => {
    if (!id || !reply.trim()) return;
    setSending(true);
    try {
      const path = isNoteMode
        ? `/admin/tickets/${id}/note`
        : `/admin/tickets/${id}/reply`;
      await adminApi(path, { method: "POST", body: { body: reply.trim() } });
      setReply("");
      await load();
    } catch (e: any) {
      Alert.alert("Could not send", e?.message || "Try again.");
    } finally {
      setSending(false);
    }
  }, [id, reply, isNoteMode, load]);

  const updateStatus = useCallback(
    async (status: string) => {
      if (!id) return;
      setStatusBusy(true);
      try {
        await adminApi(`/admin/tickets/${id}/status`, {
          method: "PATCH",
          body: { status },
        });
        await load();
      } catch (e: any) {
        Alert.alert("Status update failed", e?.message || "Try again.");
      } finally {
        setStatusBusy(false);
      }
    },
    [id, load],
  );

  if (loading || !detail) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <TopBar onBack={() => router.back()} title="Loading…" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const t = detail.ticket;
  const canEdit = t.status !== "closed";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar
        onBack={() => router.back()}
        title={`#${t.id.replace("tkt_", "").slice(0, 8).toUpperCase()}`}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: 220,
            gap: spacing.md,
          }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {/* Header card */}
          <View style={styles.headerCard}>
            <Text style={styles.subject}>{t.subject}</Text>
            <View style={styles.metaRow}>
              <View style={[styles.statusPill, statusStyle(t.status)]}>
                <Text style={[styles.statusText, { color: statusStyle(t.status).color }]}>
                  {t.status.toUpperCase()}
                </Text>
              </View>
              <View style={styles.priorityBadge}>
                <Text style={styles.priorityText}>{t.priority.toUpperCase()}</Text>
              </View>
              {t.sla_breached ? (
                <View style={styles.breachPill}>
                  <Text style={styles.breachText}>SLA</Text>
                </View>
              ) : null}
              {t.csat_rating ? (
                <View style={styles.csatPill}>
                  <Star size={11} color="#F59E0B" fill="#F59E0B" />
                  <Text style={styles.csatText}>{t.csat_rating}/5</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.userLine}>
              {t.user_name || t.user_email} · {t.user_email}
            </Text>
            <Text style={styles.muted}>
              {t.category} · raised {new Date(t.created_at).toLocaleString()}
            </Text>
            {t.csat_comment ? (
              <Text style={styles.csatComment}>“{t.csat_comment}”</Text>
            ) : null}
          </View>

          {/* Status quick actions */}
          {canEdit ? (
            <View style={styles.statusActions}>
              {STATUSES.filter((s) => s.value !== t.status).map((s) => (
                <Pressable
                  key={s.value}
                  testID={`status-${s.value}`}
                  disabled={statusBusy}
                  onPress={() => updateStatus(s.value)}
                  style={[styles.statusAction, statusBusy && { opacity: 0.4 }]}
                >
                  {s.value === "resolved" ? (
                    <CheckCircle2 size={14} color={s.color} />
                  ) : s.value === "closed" ? (
                    <XCircle size={14} color={s.color} />
                  ) : null}
                  <Text style={[styles.statusActionText, { color: s.color }]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Thread */}
          {detail.messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </ScrollView>

        {/* Composer */}
        {canEdit ? (
          <SafeAreaView edges={["bottom"]} style={styles.composer}>
            <View style={styles.composerModeRow}>
              <Pressable
                testID="mode-reply"
                onPress={() => setIsNoteMode(false)}
                style={[styles.modeBtn, !isNoteMode && styles.modeBtnActive]}
              >
                <MessageSquare size={14} color={!isNoteMode ? "#fff" : colors.textMuted} />
                <Text style={[styles.modeText, !isNoteMode && { color: "#fff" }]}>
                  Reply to seller
                </Text>
              </Pressable>
              <Pressable
                testID="mode-note"
                onPress={() => setIsNoteMode(true)}
                style={[styles.modeBtn, isNoteMode && styles.modeBtnNote]}
              >
                <StickyNote size={14} color={isNoteMode ? "#fff" : colors.textMuted} />
                <Text style={[styles.modeText, isNoteMode && { color: "#fff" }]}>
                  Internal note
                </Text>
              </Pressable>
            </View>
            <View style={styles.composerRow}>
              <TextInput
                testID="admin-reply-input"
                value={reply}
                onChangeText={setReply}
                placeholder={isNoteMode ? "Note for admins only…" : "Reply to the seller…"}
                placeholderTextColor={colors.textFaint}
                multiline
                maxLength={4000}
                style={[
                  styles.replyInput,
                  isNoteMode && { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" },
                ]}
              />
              <Pressable
                testID="admin-reply-send"
                disabled={!reply.trim() || sending}
                onPress={send}
                style={({ pressed }) => [
                  styles.sendBtn,
                  isNoteMode && { backgroundColor: "#92400E" },
                  (!reply.trim() || sending) && { opacity: 0.5 },
                  pressed && reply.trim() && { opacity: 0.85 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Send size={18} color="#fff" />
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        ) : (
          <SafeAreaView edges={["bottom"]} style={styles.closedBar}>
            <Lock size={14} color={colors.textMuted} />
            <Text style={styles.closedText}>Ticket is closed.</Text>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isAdmin = msg.sender_role === "admin";
  const isNote = !!msg.is_internal_note;
  return (
    <View
      style={[
        styles.bubble,
        isNote
          ? styles.bubbleNote
          : isAdmin
          ? styles.bubbleAdmin
          : styles.bubbleSeller,
      ]}
    >
      <View style={styles.bubbleHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {isNote ? <StickyNote size={11} color="#92400E" /> : null}
          <Text style={[styles.bubbleSender, isAdmin && { color: colors.primaryDark }]}>
            {isNote ? "INTERNAL NOTE" : isAdmin ? "Support" : "Seller"}
            {msg.sender_name ? ` · ${msg.sender_name}` : ""}
          </Text>
        </View>
        <Text style={styles.bubbleTime}>{new Date(msg.created_at).toLocaleString()}</Text>
      </View>
      <Text style={styles.bubbleBody}>{msg.body}</Text>
      {msg.attachments?.length ? (
        <View style={styles.attachRow}>
          {msg.attachments.map((url, idx) => (
            <Image key={idx} source={{ uri: url }} style={styles.attachThumb} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.topBar}>
      <Pressable testID="admin-detail-back" onPress={onBack} style={styles.backBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Shield size={16} color={colors.primary} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
}

function statusStyle(status: string) {
  switch (status) {
    case "open":
      return { backgroundColor: "#FEF3C7", color: "#92400E" };
    case "in_progress":
      return { backgroundColor: "#DBEAFE", color: "#1E3A8A" };
    case "awaiting_reply":
      return { backgroundColor: "#FFE4D9", color: "#9A3412" };
    case "resolved":
      return { backgroundColor: "#D1FAE5", color: "#065F46" };
    case "closed":
      return { backgroundColor: "#E5E7EB", color: "#374151" };
    default:
      return { backgroundColor: colors.surface, color: colors.text };
  }
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
  title: { fontSize: 16, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  subject: { fontSize: 17, fontWeight: "800", color: colors.text, lineHeight: 22 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityText: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
  breachPill: {
    backgroundColor: colors.error,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  breachText: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 0.4 },
  csatPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  csatText: { fontSize: 11, fontWeight: "800", color: "#92400E" },
  userLine: { fontSize: 13, fontWeight: "700", color: colors.text },
  muted: { fontSize: 11.5, color: colors.textMuted },
  csatComment: {
    fontStyle: "italic",
    color: "#92400E",
    fontSize: 13,
    marginTop: 4,
    backgroundColor: "#FEF9C3",
    padding: 8,
    borderRadius: radius.sm,
  },
  statusActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusActionText: { fontSize: 12.5, fontWeight: "800" },
  bubble: { padding: spacing.md, borderRadius: radius.lg, gap: 6 },
  bubbleSeller: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
    maxWidth: "92%",
  },
  bubbleAdmin: {
    backgroundColor: colors.primarySoft,
    alignSelf: "flex-end",
    maxWidth: "92%",
  },
  bubbleNote: {
    backgroundColor: "#FEF9C3",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderStyle: "dashed",
    alignSelf: "stretch",
  },
  bubbleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  bubbleSender: { fontSize: 11, fontWeight: "800", color: colors.text, letterSpacing: 0.2 },
  bubbleTime: { fontSize: 10, color: colors.textFaint },
  bubbleBody: { fontSize: 14, color: colors.text, lineHeight: 19 },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  attachThumb: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surface },
  composer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  composerModeRow: { flexDirection: "row", gap: 6 },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  modeBtnActive: { backgroundColor: colors.primary },
  modeBtnNote: { backgroundColor: "#92400E" },
  modeText: { fontSize: 12, fontWeight: "800", color: colors.textMuted },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  replyInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  closedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  closedText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
});
