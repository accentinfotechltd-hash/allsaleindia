/**
 * Product Q&A section — Amazon-style customer questions on the PDP.
 *
 * Renders the top N questions ranked by helpful votes (sort=helpful)
 * with their top answer preview, an "Ask a question" CTA, and per-row
 * actions: thumbs-up the question (helpful vote), reply, "+M more
 * answers" expand. Reply / Ask open the same `QuestionAskSheet` modal
 * with mode={"ask" | "answer"}.
 *
 * Auth: read is anonymous; ask/answer/vote require login → buyer is
 * redirected to /(auth)/login when they tap any of those actions.
 */
import { useRouter } from "expo-router";
import {
  BadgeCheck,
  ChevronRight,
  MessageCircleQuestion,
  Plus,
  ShieldCheck,
  ThumbsUp,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  product_id: string;
  user_name: string;
  text: string;
  created_at: string;
  upvotes: number;
  answer_count: number;
  is_upvoted_by_me: boolean;
  top_answer: Answer | null;
};

type ListResponse = {
  product_id: string;
  count: number;
  items: Question[];
};

const PREVIEW_LIMIT = 3;

export default function ProductQuestionsSection({
  productId,
}: {
  productId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [sheetMode, setSheetMode] = useState<
    null | { kind: "ask" } | { kind: "answer"; questionId: string; preview: string }
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<ListResponse>(
        `/products/${productId}/questions?sort=helpful&limit=20`
      );
      setItems(d.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

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

  const toggleVote = useCallback(
    async (q: Question) => {
      requireAuth(async () => {
        const next = !q.is_upvoted_by_me;
        // optimistic
        setItems((prev) =>
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
          // rollback
          setItems((prev) =>
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

  if (loading) {
    return (
      <View style={styles.loading} testID="qa-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const visible = showAll ? items : items.slice(0, PREVIEW_LIMIT);
  const more = items.length - visible.length;

  return (
    <View style={styles.wrap} testID="qa-section">
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <MessageCircleQuestion size={18} color={colors.primary} />
          <Text style={styles.heading}>Questions & answers</Text>
          {items.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countText}>{items.length}</Text>
            </View>
          ) : null}
        </View>
        <Pressable
          testID="qa-ask-btn"
          onPress={() => requireAuth(() => setSheetMode({ kind: "ask" }))}
          style={styles.askBtn}
        >
          <Plus size={14} color="#fff" />
          <Text style={styles.askBtnText}>Ask</Text>
        </Pressable>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No questions yet</Text>
          <Text style={styles.emptySub}>
            Be the first to ask about size, shipping, or anything else.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visible.map((q) => (
            <View key={q.id} style={styles.card} testID={`qa-q-${q.id}`}>
              <View style={styles.questionRow}>
                <Text style={styles.qPrefix}>Q.</Text>
                <Text style={styles.qText}>{q.text}</Text>
              </View>
              {q.top_answer ? (
                <View style={styles.answerRow}>
                  <Text style={styles.aPrefix}>A.</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aText} numberOfLines={4}>
                      {q.top_answer.text}
                    </Text>
                    <View style={styles.aMetaRow}>
                      <Text style={styles.aAuthor}>
                        — {q.top_answer.user_name}
                      </Text>
                      {q.top_answer.is_seller ? (
                        <View style={[styles.tag, styles.tagSeller]}>
                          <ShieldCheck size={9} color="#7C3AED" />
                          <Text style={[styles.tagText, { color: "#7C3AED" }]}>
                            Seller
                          </Text>
                        </View>
                      ) : null}
                      {q.top_answer.is_verified_purchase ? (
                        <View style={[styles.tag, styles.tagVerified]}>
                          <BadgeCheck size={9} color="#059669" />
                          <Text style={[styles.tagText, { color: "#059669" }]}>
                            Verified buyer
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.unanswered}>
                  <Text style={styles.unansweredText}>
                    No answers yet — be the first to help.
                  </Text>
                </View>
              )}

              <View style={styles.footerRow}>
                <Pressable
                  testID={`qa-vote-${q.id}`}
                  onPress={() => toggleVote(q)}
                  style={[
                    styles.actionBtn,
                    q.is_upvoted_by_me && styles.actionBtnActive,
                  ]}
                >
                  <ThumbsUp
                    size={11}
                    color={q.is_upvoted_by_me ? colors.primary : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.actionText,
                      q.is_upvoted_by_me && { color: colors.primary },
                    ]}
                  >
                    Helpful{q.upvotes > 0 ? ` · ${q.upvotes}` : ""}
                  </Text>
                </Pressable>
                <Pressable
                  testID={`qa-reply-${q.id}`}
                  onPress={() =>
                    requireAuth(() =>
                      setSheetMode({
                        kind: "answer",
                        questionId: q.id,
                        preview: q.text,
                      })
                    )
                  }
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionText}>
                    {q.top_answer ? "Add answer" : "Answer"}
                    {q.answer_count > 1
                      ? ` · +${q.answer_count - 1} more`
                      : ""}
                  </Text>
                  <ChevronRight size={11} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>
          ))}

          {more > 0 ? (
            <Pressable
              testID="qa-see-more"
              onPress={() => setShowAll(true)}
              style={styles.seeMore}
            >
              <Text style={styles.seeMoreText}>
                See {more} more question{more === 1 ? "" : "s"}
              </Text>
              <ChevronRight size={14} color={colors.primary} />
            </Pressable>
          ) : null}
        </View>
      )}

      {sheetMode ? (
        <QuestionAskSheet
          mode={sheetMode}
          productId={productId}
          onClose={() => setSheetMode(null)}
          onSubmitted={() => {
            setSheetMode(null);
            load();
          }}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet for both "ask" and "answer" flows.
// ---------------------------------------------------------------------------
function QuestionAskSheet({
  mode,
  productId,
  onClose,
  onSubmitted,
}: {
  mode: { kind: "ask" } | { kind: "answer"; questionId: string; preview: string };
  productId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const minLen = mode.kind === "ask" ? 5 : 2;
  const maxLen = mode.kind === "ask" ? 500 : 1000;
  const valid = text.trim().length >= minLen && text.length <= maxLen;

  const submit = useCallback(async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      if (mode.kind === "ask") {
        await api(`/products/${productId}/questions`, {
          method: "POST",
          body: { text: text.trim() },
        });
        toast.show({ title: "Question posted", kind: "success" });
      } else {
        await api(`/questions/${mode.questionId}/answers`, {
          method: "POST",
          body: { text: text.trim() },
        });
        toast.show({ title: "Answer posted", kind: "success" });
      }
      onSubmitted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't post";
      toast.show({ title: msg, kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [valid, submitting, mode, productId, text, toast, onSubmitted]);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={["bottom"]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {mode.kind === "ask" ? "Ask a question" : "Add an answer"}
            </Text>
            {mode.kind === "answer" ? (
              <View style={styles.previewQ}>
                <Text style={styles.previewQLabel}>Q.</Text>
                <Text style={styles.previewQText} numberOfLines={3}>
                  {mode.preview}
                </Text>
              </View>
            ) : (
              <Text style={styles.sheetHint}>
                Keep it about the product — size, shipping, materials, fit, etc.
              </Text>
            )}
            <TextInput
              testID="qa-sheet-input"
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
                  testID="qa-sheet-submit"
                  disabled={!valid || submitting}
                  onPress={submit}
                  style={[
                    styles.submitBtn,
                    (!valid || submitting) && styles.submitBtnDisabled,
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
  loading: { padding: spacing.md, alignItems: "center" },
  wrap: { marginTop: spacing.xl, gap: spacing.sm },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  countPill: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { color: colors.primary, fontWeight: "800", fontSize: 11 },
  askBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  askBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  empty: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 13 },
  emptySub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: "center",
  },
  list: { gap: 10 },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 10,
  },
  questionRow: { flexDirection: "row", gap: 8 },
  qPrefix: {
    fontWeight: "800",
    color: colors.primary,
    fontSize: 13,
  },
  qText: {
    flex: 1,
    fontWeight: "700",
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  answerRow: { flexDirection: "row", gap: 8 },
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
  tagText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
  unanswered: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  unansweredText: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
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
  actionText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  seeMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
  },
  seeMoreText: { color: colors.primary, fontWeight: "800", fontSize: 12 },

  // Sheet
  modalBackdrop: {
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
  sheetHandle: {
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
    marginBottom: 6,
  },
  sheetHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  previewQ: {
    flexDirection: "row",
    gap: 8,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  previewQLabel: { fontWeight: "800", color: colors.primary },
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
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
