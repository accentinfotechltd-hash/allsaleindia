import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Lock, Send, Star, X as XIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
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
  subject: string;
  category: string;
  priority: string;
  status: string;
  sla_breached: boolean;
  csat_rating: number | null;
  csat_comment: string | null;
  resolved_at: string | null;
  created_at: string;
};

type Detail = { ticket: Ticket; messages: Msg[] };

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  awaiting_reply: "Reply waiting",
  resolved: "Resolved",
  closed: "Closed",
};

export default function TicketDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // CSAT modal state
  const [ratingOpen, setRatingOpen] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingSaving, setRatingSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await api<Detail>(`/support/tickets/${id}`);
      setDetail(d);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    } catch (e: any) {
      toast.show({ title: "Could not load ticket", body: e?.message || "Please try again.", kind: "success" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Auto-open rating prompt when newly resolved without CSAT
  useEffect(() => {
    if (
      detail &&
      detail.ticket.status === "resolved" &&
      !detail.ticket.csat_rating
    ) {
      const t = setTimeout(() => setRatingOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [detail]);

  const sendReply = useCallback(async () => {
    if (!id || reply.trim().length < 1) return;
    setSending(true);
    try {
      await api(`/support/tickets/${id}/reply`, {
        method: "POST",
        body: { body: reply.trim() },
      });
      setReply("");
      await load();
    } catch (e: any) {
      toast.show({ title: "Could not send", body: e?.message || "Try again.", kind: "success" });
    } finally {
      setSending(false);
    }
  }, [id, reply, load]);

  const submitRating = useCallback(async () => {
    if (!id || ratingValue < 1) return;
    setRatingSaving(true);
    try {
      await api(`/support/tickets/${id}/rate`, {
        method: "POST",
        body: { rating: ratingValue, comment: ratingComment.trim() || null },
      });
      setRatingOpen(false);
      await load();
    } catch (e: any) {
      toast.show({ title: "Could not submit rating", body: e?.message || "Try again.", kind: "success" });
    } finally {
      setRatingSaving(false);
    }
  }, [id, ratingValue, ratingComment, load]);

  const confirm = useConfirm();
  const toast = useToast();

  const closeTicket = useCallback(async () => {
    if (!id) return;
    const ok = await confirm({
      title: "Close this ticket?",
      message: "You won't be able to add more replies.",
      destructive: true,
      confirmLabel: "Close ticket",
    });
    if (!ok) return;
    try {
      await api(`/support/tickets/${id}/close`, { method: "POST" });
      toast.show({ kind: "success", title: "Ticket closed" });
      await load();
    } catch (e: any) {
      toast.show({ kind: "error", title: "Could not close", body: e?.message || "Try again." });
    }
  }, [id, load, confirm, toast]);

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
  const canReply = t.status !== "closed";
  const isResolved = t.status === "resolved" || t.status === "closed";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar
        onBack={() => router.back()}
        title={`#${t.id.replace("tkt_", "").slice(0, 8).toUpperCase()}`}
        right={
          canReply ? (
            <Pressable testID="ticket-close-btn" onPress={closeTicket} hitSlop={12}>
              <Text style={styles.closeLink}>Close</Text>
            </Pressable>
          ) : null
        }
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.md }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {/* Header card */}
          <View style={styles.headerCard}>
            <View style={styles.headerTopRow}>
              <View style={[styles.statusPill, statusStyle(t.status)]}>
                <Text style={[styles.statusText, { color: statusStyle(t.status).color }]}>
                  {STATUS_LABEL[t.status] || t.status}
                </Text>
              </View>
              <View style={styles.priorityBadge}>
                <Text style={styles.priorityText}>{t.priority.toUpperCase()}</Text>
              </View>
              {t.csat_rating ? (
                <View style={styles.csatPill}>
                  <Star size={12} color="#F59E0B" fill="#F59E0B" />
                  <Text style={styles.csatText}>{t.csat_rating}/5</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.subject}>{t.subject}</Text>
            <Text style={styles.metaText}>
              {t.category} · raised {new Date(t.created_at).toLocaleString()}
            </Text>
          </View>

          {/* Message thread */}
          {detail.messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}

          {isResolved && !t.csat_rating ? (
            <Pressable
              testID="rate-resolved-btn"
              onPress={() => setRatingOpen(true)}
              style={styles.ratePrompt}
            >
              <Star size={18} color={colors.primary} fill={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.ratePromptTitle}>Rate our support</Text>
                <Text style={styles.ratePromptBody}>
                  Tap to leave a 1–5 star rating for this ticket.
                </Text>
              </View>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* Reply composer */}
        {canReply ? (
          <SafeAreaView edges={["bottom"]} style={styles.composer}>
            <View style={styles.composerRow}>
              <TextInput
                testID="ticket-reply-input"
                value={reply}
                onChangeText={setReply}
                placeholder="Type a reply…"
                placeholderTextColor={colors.textFaint}
                multiline
                maxLength={4000}
                style={styles.replyInput}
              />
              <Pressable
                testID="ticket-reply-send"
                disabled={!reply.trim() || sending}
                onPress={sendReply}
                style={({ pressed }) => [
                  styles.sendBtn,
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
            <Text style={styles.closedText}>This ticket is closed.</Text>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>

      {/* CSAT modal */}
      {ratingOpen ? (
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Pressable
              testID="csat-close"
              onPress={() => setRatingOpen(false)}
              style={styles.modalClose}
            >
              <XIcon size={18} color={colors.textMuted} />
            </Pressable>
            <Text style={styles.modalTitle}>How did we do?</Text>
            <Text style={styles.modalBody}>
              Your rating helps our support team improve. Tap the stars below.
            </Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  testID={`csat-star-${n}`}
                  onPress={() => setRatingValue(n)}
                  hitSlop={6}
                >
                  <Star
                    size={36}
                    color={n <= ratingValue ? "#F59E0B" : colors.border}
                    fill={n <= ratingValue ? "#F59E0B" : "transparent"}
                  />
                </Pressable>
              ))}
            </View>
            <TextInput
              testID="csat-comment"
              value={ratingComment}
              onChangeText={setRatingComment}
              placeholder="Optional comment…"
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={600}
              style={styles.csatComment}
            />
            <Pressable
              testID="csat-submit"
              disabled={ratingValue < 1 || ratingSaving}
              onPress={submitRating}
              style={({ pressed }) => [
                styles.csatSubmit,
                (ratingValue < 1 || ratingSaving) && { opacity: 0.5 },
                pressed && ratingValue >= 1 && { opacity: 0.85 },
              ]}
            >
              {ratingSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.csatSubmitText}>Submit rating</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isAdmin = msg.sender_role === "admin";
  return (
    <View style={[styles.bubble, isAdmin ? styles.bubbleAdmin : styles.bubbleSelf]}>
      <View style={styles.bubbleHeader}>
        <Text style={[styles.bubbleSender, isAdmin && { color: colors.primaryDark }]}>
          {isAdmin ? "Allsale support" : "You"}
          {msg.sender_name && isAdmin ? ` · ${msg.sender_name}` : ""}
        </Text>
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

function TopBar({
  onBack,
  title,
  right,
}: {
  onBack: () => void;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.topBar}>
      <Pressable testID="ticket-back" onPress={onBack} style={styles.backBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40, alignItems: "flex-end" }}>{right}</View>
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
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  closeLink: { fontSize: 13, fontWeight: "700", color: colors.error },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "800" },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  priorityText: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
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
  subject: { fontSize: 17, fontWeight: "800", color: colors.text, lineHeight: 22 },
  metaText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  bubble: { padding: spacing.md, borderRadius: radius.lg, gap: 6 },
  bubbleSelf: {
    backgroundColor: colors.primarySoft,
    alignSelf: "flex-end",
    maxWidth: "92%",
  },
  bubbleAdmin: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
    maxWidth: "92%",
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
  ratePrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  ratePromptTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  ratePromptBody: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
  },
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
  modalBackdrop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  modalClose: { position: "absolute", top: 12, right: 12, padding: 4 },
  modalTitle: { fontSize: 20, fontWeight: "800", color: colors.text, textAlign: "center" },
  modalBody: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
  starRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginVertical: 6 },
  csatComment: {
    minHeight: 80,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 13,
    color: colors.text,
    textAlignVertical: "top",
  },
  csatSubmit: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  csatSubmitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
