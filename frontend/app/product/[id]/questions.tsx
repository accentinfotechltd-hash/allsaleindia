/**
 * Product Q&A "See all" screen — dedicated route showing every question
 * for a product, with each question expanded inline to reveal ALL its
 * answers (not just the top-1 preview from the PDP).
 *
 * Header: back, product name, "Ask" CTA, sort toggle (helpful | recent).
 * Body: paginated list of Question cards; tap a card to toggle the
 * full-answer list. Helpful votes on questions and answers persist via
 * the same `/questions/{id}/vote` and `/answers/{id}/helpful` endpoints
 * used by the PDP preview section.
 *
 * Route: `/product/{id}/questions`
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  MessageCircleQuestion,
  Plus,
  ShieldCheck,
  ThumbsUp,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Answer = {
  id: string;
  question_id: string;
  user_name: string;
  text: string;
  created_at: string;
  helpful_count: number;
  is_helpful_to_me: boolean;
  is_seller: boolean;
  is_verified_purchase: boolean;
};

type Question = {
  id: string;
  user_name: string;
  text: string;
  created_at: string;
  upvotes: number;
  answer_count: number;
  is_upvoted_by_me: boolean;
  top_answer: Answer | null;
};

type Sort = "helpful" | "recent";

export default function QuestionsSeeAllScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { id: productId } = useLocalSearchParams<{ id: string }>();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("helpful");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [answersByQ, setAnswersByQ] = useState<Record<string, Answer[]>>({});
  const [loadingAnswers, setLoadingAnswers] = useState<Set<string>>(new Set());
  const [askOpen, setAskOpen] = useState<
    null | { kind: "ask" } | { kind: "answer"; questionId: string; preview: string }
  >(null);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const d = await api<{ items: Question[] }>(
        `/products/${productId}/questions?sort=${sort}&limit=50`
      );
      setQuestions(d.items || []);
    } catch {
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  }, [productId, sort]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const requireAuth = useCallback(
    (next: () => void) => {
      if (!user) {
        toast.show({ title: "Sign in to continue", kind: "info" });
        router.push("/(auth)/login");
        return;
      }
      next();
    },
    [user, router, toast]
  );

  const toggleExpand = useCallback(
    async (qid: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(qid)) {
          next.delete(qid);
        } else {
          next.add(qid);
        }
        return next;
      });
      if (!answersByQ[qid] && !loadingAnswers.has(qid)) {
        setLoadingAnswers((prev) => new Set([...prev, qid]));
        try {
          const d = await api<{ items: Answer[] }>(
            `/questions/${qid}/answers?limit=50`
          );
          setAnswersByQ((prev) => ({ ...prev, [qid]: d.items || [] }));
        } catch {
          setAnswersByQ((prev) => ({ ...prev, [qid]: [] }));
        } finally {
          setLoadingAnswers((prev) => {
            const n = new Set(prev);
            n.delete(qid);
            return n;
          });
        }
      }
    },
    [answersByQ, loadingAnswers]
  );

  const toggleQuestionVote = useCallback(
    async (q: Question) => {
      requireAuth(async () => {
        const next = !q.is_upvoted_by_me;
        setQuestions((prev) =>
          prev.map((row) =>
            row.id === q.id
              ? {
                  ...row,
                  is_upvoted_by_me: next,
                  upvotes: row.upvotes + (next ? 1 : -1),
                }
              : row
          )
        );
        try {
          await api(`/questions/${q.id}/vote`, {
            method: "POST",
            body: { direction: next ? "up" : "clear" },
          });
        } catch (e) {
          setQuestions((prev) =>
            prev.map((row) =>
              row.id === q.id
                ? {
                    ...row,
                    is_upvoted_by_me: !next,
                    upvotes: row.upvotes + (next ? -1 : 1),
                  }
                : row
            )
          );
          const msg = e instanceof Error ? e.message : "Vote failed";
          toast.show({ title: msg, kind: "error" });
        }
      });
    },
    [requireAuth, toast]
  );

  const toggleAnswerHelpful = useCallback(
    async (qid: string, a: Answer) => {
      requireAuth(async () => {
        const next = !a.is_helpful_to_me;
        setAnswersByQ((prev) => ({
          ...prev,
          [qid]: (prev[qid] || []).map((row) =>
            row.id === a.id
              ? {
                  ...row,
                  is_helpful_to_me: next,
                  helpful_count: row.helpful_count + (next ? 1 : -1),
                }
              : row
          ),
        }));
        try {
          await api(`/answers/${a.id}/helpful`, {
            method: "POST",
            body: { direction: next ? "up" : "clear" },
          });
        } catch {
          // rollback
          setAnswersByQ((prev) => ({
            ...prev,
            [qid]: (prev[qid] || []).map((row) =>
              row.id === a.id
                ? {
                    ...row,
                    is_helpful_to_me: !next,
                    helpful_count: row.helpful_count + (next ? -1 : 1),
                  }
                : row
            ),
          }));
        }
      });
    },
    [requireAuth]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="qa-all-back"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={styles.title}>Questions & answers</Text>
          <Text style={styles.subtitle}>
            {questions.length}{" "}
            {questions.length === 1 ? "question" : "questions"}
          </Text>
        </View>
        <Pressable
          testID="qa-all-ask"
          onPress={() => requireAuth(() => setAskOpen({ kind: "ask" }))}
          style={styles.askBtn}
        >
          <Plus size={14} color="#fff" />
          <Text style={styles.askBtnText}>Ask</Text>
        </Pressable>
      </View>

      {/* Sort toggle */}
      <View style={styles.sortRow}>
        <SortPill
          label="Most helpful"
          active={sort === "helpful"}
          onPress={() => setSort("helpful")}
        />
        <SortPill
          label="Most recent"
          active={sort === "recent"}
          onPress={() => setSort("recent")}
        />
      </View>

      <FlatList
        data={questions}
        keyExtractor={(q) => q.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxl,
          gap: 10,
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator
              color={colors.primary}
              style={{ marginVertical: 40 }}
            />
          ) : (
            <View style={styles.empty}>
              <MessageCircleQuestion size={32} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No questions yet</Text>
              <Text style={styles.emptySub}>
                Be the first to ask about this product.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const isOpen = expanded.has(item.id);
          const answers = answersByQ[item.id] || [];
          const isLoading = loadingAnswers.has(item.id);
          return (
            <View style={styles.card}>
              <View style={styles.qHeader}>
                <Text style={styles.qPrefix}>Q.</Text>
                <Text style={styles.qText}>{item.text}</Text>
              </View>
              <Text style={styles.qMeta}>
                asked by {item.user_name} ·{" "}
                {new Date(item.created_at).toLocaleDateString()}
              </Text>

              {/* Top answer (always visible) */}
              {item.top_answer ? (
                <AnswerRow
                  answer={item.top_answer}
                  onToggleHelpful={() =>
                    toggleAnswerHelpful(item.id, item.top_answer!)
                  }
                />
              ) : (
                <View style={styles.unanswered}>
                  <Text style={styles.unansweredText}>
                    No answers yet.
                  </Text>
                </View>
              )}

              {/* Expanded answer list */}
              {isOpen && answers.length > 1 ? (
                <View style={styles.expandedList}>
                  {answers
                    .filter((a) => a.id !== item.top_answer?.id)
                    .map((a) => (
                      <AnswerRow
                        key={a.id}
                        answer={a}
                        onToggleHelpful={() =>
                          toggleAnswerHelpful(item.id, a)
                        }
                      />
                    ))}
                </View>
              ) : null}
              {isOpen && isLoading ? (
                <ActivityIndicator
                  color={colors.primary}
                  style={{ marginVertical: 8 }}
                />
              ) : null}

              {/* Footer actions */}
              <View style={styles.footerRow}>
                <Pressable
                  testID={`qa-all-vote-${item.id}`}
                  onPress={() => toggleQuestionVote(item)}
                  style={[
                    styles.actionBtn,
                    item.is_upvoted_by_me && styles.actionBtnActive,
                  ]}
                >
                  <ThumbsUp
                    size={11}
                    color={
                      item.is_upvoted_by_me ? colors.primary : colors.textMuted
                    }
                  />
                  <Text
                    style={[
                      styles.actionText,
                      item.is_upvoted_by_me && { color: colors.primary },
                    ]}
                  >
                    Helpful{item.upvotes > 0 ? ` · ${item.upvotes}` : ""}
                  </Text>
                </Pressable>

                {item.answer_count > 1 ? (
                  <Pressable
                    testID={`qa-all-expand-${item.id}`}
                    onPress={() => toggleExpand(item.id)}
                    style={styles.actionBtn}
                  >
                    <Text style={styles.actionText}>
                      {isOpen
                        ? "Hide answers"
                        : `+${item.answer_count - 1} more answer${item.answer_count - 1 === 1 ? "" : "s"}`}
                    </Text>
                    {isOpen ? (
                      <ChevronUp size={11} color={colors.textMuted} />
                    ) : (
                      <ChevronDown size={11} color={colors.textMuted} />
                    )}
                  </Pressable>
                ) : null}

                <Pressable
                  testID={`qa-all-reply-${item.id}`}
                  onPress={() =>
                    requireAuth(() =>
                      setAskOpen({
                        kind: "answer",
                        questionId: item.id,
                        preview: item.text,
                      })
                    )
                  }
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionText}>Add answer</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      {askOpen ? (
        <AskAnswerSheet
          mode={askOpen}
          productId={String(productId)}
          onClose={() => setAskOpen(null)}
          onSubmitted={(qid) => {
            setAskOpen(null);
            load();
            // If we just answered a question, refresh its expanded answer list
            if (qid && expanded.has(qid)) {
              setAnswersByQ((prev) => {
                const next = { ...prev };
                delete next[qid];
                return next;
              });
              toggleExpand(qid);
            }
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function SortPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.sortPill, active && styles.sortPillActive]}
    >
      <Text style={[styles.sortText, active && styles.sortTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AnswerRow({
  answer,
  onToggleHelpful,
}: {
  answer: Answer;
  onToggleHelpful: () => void;
}) {
  return (
    <View style={styles.aBlock}>
      <View style={styles.aRow}>
        <Text style={styles.aPrefix}>A.</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.aText}>{answer.text}</Text>
          <View style={styles.aMetaRow}>
            <Text style={styles.aAuthor}>— {answer.user_name}</Text>
            {answer.is_seller ? (
              <View style={[styles.tag, styles.tagSeller]}>
                <ShieldCheck size={9} color="#7C3AED" />
                <Text style={[styles.tagText, { color: "#7C3AED" }]}>
                  Seller
                </Text>
              </View>
            ) : null}
            {answer.is_verified_purchase ? (
              <View style={[styles.tag, styles.tagVerified]}>
                <BadgeCheck size={9} color="#059669" />
                <Text style={[styles.tagText, { color: "#059669" }]}>
                  Verified buyer
                </Text>
              </View>
            ) : null}
          </View>
          <Pressable
            onPress={onToggleHelpful}
            style={[
              styles.helpfulBtn,
              answer.is_helpful_to_me && styles.helpfulBtnActive,
            ]}
          >
            <ThumbsUp
              size={10}
              color={
                answer.is_helpful_to_me ? colors.primary : colors.textMuted
              }
            />
            <Text
              style={[
                styles.helpfulText,
                answer.is_helpful_to_me && { color: colors.primary },
              ]}
            >
              Helpful
              {answer.helpful_count > 0 ? ` · ${answer.helpful_count}` : ""}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AskAnswerSheet({
  mode,
  productId,
  onClose,
  onSubmitted,
}: {
  mode: { kind: "ask" } | { kind: "answer"; questionId: string; preview: string };
  productId: string;
  onClose: () => void;
  onSubmitted: (qid?: string) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const minLen = mode.kind === "ask" ? 5 : 2;
  const maxLen = mode.kind === "ask" ? 500 : 1000;
  const valid = text.trim().length >= minLen && text.length <= maxLen;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      if (mode.kind === "ask") {
        await api(`/products/${productId}/questions`, {
          method: "POST",
          body: { text: text.trim() },
        });
        toast.show({ title: "Question posted", kind: "success" });
        onSubmitted();
      } else {
        await api(`/questions/${mode.questionId}/answers`, {
          method: "POST",
          body: { text: text.trim() },
        });
        toast.show({ title: "Answer posted", kind: "success" });
        onSubmitted(mode.questionId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't post";
      toast.show({ title: msg, kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={["bottom"]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              {mode.kind === "ask" ? "Ask a question" : "Add an answer"}
            </Text>
            {mode.kind === "answer" ? (
              <View style={styles.previewQ}>
                <Text style={styles.qPrefix}>Q.</Text>
                <Text style={styles.previewQText} numberOfLines={3}>
                  {mode.preview}
                </Text>
              </View>
            ) : null}
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={
                mode.kind === "ask"
                  ? "e.g. Does this come in size XL?"
                  : "Share what you know…"
              }
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={maxLen}
              style={styles.input}
              autoFocus
            />
            <View style={styles.sheetFooter}>
              <Text style={styles.counter}>
                {text.length} / {maxLen}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={onClose} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  disabled={!valid || submitting}
                  onPress={submit}
                  style={[
                    styles.submitBtn,
                    (!valid || submitting) && { opacity: 0.4 },
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.submitText}>
                      {mode.kind === "ask" ? "Post question" : "Post answer"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
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
  title: { fontSize: 20, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  askBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  askBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  sortRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sortPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortPillActive: { backgroundColor: colors.text, borderColor: colors.text },
  sortText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  sortTextActive: { color: "#fff" },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 8,
  },
  qHeader: { flexDirection: "row", gap: 8 },
  qPrefix: { fontWeight: "800", color: colors.primary, fontSize: 13 },
  qText: { flex: 1, fontWeight: "700", color: colors.text, fontSize: 13, lineHeight: 18 },
  qMeta: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  unanswered: {
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  unansweredText: { fontSize: 11, color: colors.textMuted, fontStyle: "italic" },
  expandedList: { gap: 10, marginTop: 4 },
  aBlock: {
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  aRow: { flexDirection: "row", gap: 8 },
  aPrefix: { fontWeight: "800", color: colors.textMuted, fontSize: 13 },
  aText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  aMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  aAuthor: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagSeller: { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" },
  tagVerified: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  tagText: { fontSize: 9, fontWeight: "800" },
  helpfulBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  helpfulBtnActive: { backgroundColor: colors.primarySoft },
  helpfulText: { color: colors.textMuted, fontSize: 10.5, fontWeight: "700" },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    flexWrap: "wrap",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
  },
  actionBtnActive: { backgroundColor: colors.primarySoft },
  actionText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  empty: {
    paddingTop: 80,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginTop: 8 },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: "center" },

  // Sheet
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    minHeight: 320,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 12,
  },
  previewQ: {
    flexDirection: "row",
    gap: 8,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  previewQText: { flex: 1, fontSize: 13, color: colors.text, fontWeight: "600" },
  input: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: "top",
  },
  sheetFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  counter: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  cancelBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  cancelText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  submitBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    minWidth: 120,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
