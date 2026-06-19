import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Flag, ThumbsUp, MessageCircle, PenSquare } from "lucide-react-native";

import StarRating from "@/src/components/StarRating";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";
import { useAuth } from "@/src/contexts/AuthContext";
import { useToast } from "@/src/components/UiOverlayProvider";

type Review = {
  id: string;
  product_id: string;
  user_id: string;
  user_name: string;
  user_country?: string;
  rating: number;
  title?: string | null;
  comment: string;
  photos: string[];
  verified_purchase: boolean;
  helpful_count: number;
  helpful_user_ids: string[];
  seller_reply?: {
    seller_id: string;
    seller_name?: string;
    body: string;
    created_at: string;
  } | null;
  created_at: string;
};

type Summary = {
  product_id: string;
  avg_rating: number;
  total: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};

type ReviewsPage = {
  summary: Summary;
  items: Review[];
  can_review: boolean;
  eligible_order_ids: string[];
};

type Props = {
  productId: string;
  onWriteReview: (orderId: string) => void;
};

const SORTS: { key: "recent" | "helpful" | "rating_desc" | "rating_asc"; label: string }[] = [
  { key: "recent", label: "Recent" },
  { key: "helpful", label: "Helpful" },
  { key: "rating_desc", label: "5★ first" },
  { key: "rating_asc", label: "1★ first" },
];

export default function ReviewsSection({ productId, onWriteReview }: Props) {
  const { user } = useAuth();
  const { show } = useToast();
  const [page, setPage] = useState<ReviewsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("recent");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await api<ReviewsPage>(
        `/reviews/product/${productId}?sort=${sort}`,
        { auth: true },
      );
      setPage(data);
    } catch {
      // Try anonymously if auth call failed
      try {
        const data = await api<ReviewsPage>(
          `/reviews/product/${productId}?sort=${sort}`,
          { auth: false },
        );
        setPage(data);
      } catch {
        setPage(null);
      }
    } finally {
      setLoading(false);
    }
  }, [productId, sort]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const onHelpful = async (rid: string) => {
    if (!user) return;
    setBusyId(rid);
    try {
      await api(`/reviews/${rid}/helpful`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const onReport = (rid: string, authorId: string) => {
    if (!user) {
      show({ title: "Sign in to report", kind: "error" });
      return;
    }
    if (authorId === user.id) {
      show({ title: "You can't report your own review", kind: "error" });
      return;
    }
    if (reportedIds.has(rid)) {
      show({ title: "Already reported", message: "Thanks — our team will review it.", kind: "info" });
      return;
    }
    const REASONS = [
      { label: "Inappropriate / abusive", value: "inappropriate" },
      { label: "Spam or promotional", value: "spam" },
      { label: "Fake / not a real buyer", value: "fake" },
      { label: "Off-topic / not about product", value: "off_topic" },
      { label: "Cancel", value: "" },
    ];
    Alert.alert(
      "Report this review",
      "Tell us why so our team can review it. False reports may affect your account.",
      REASONS.map((r) => ({
        text: r.label,
        style: r.value === "" ? "cancel" : "default",
        onPress: r.value
          ? async () => {
              try {
                await api(`/reviews/${rid}/report`, {
                  method: "POST",
                  body: { reason: r.value },
                });
                setReportedIds((prev) => {
                  const next = new Set(prev);
                  next.add(rid);
                  return next;
                });
                show({
                  title: "Reported. Thanks for letting us know.",
                  message: "An admin will take a look soon.",
                  kind: "success",
                });
              } catch (e: any) {
                show({
                  title: "Couldn't submit report",
                  message: e?.message || "Please try again.",
                  kind: "error",
                });
              }
            }
          : undefined,
      })),
    );
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!page) return null;

  const { summary, items, can_review, eligible_order_ids } = page;
  const distMax = Math.max(1, ...Object.values(summary.distribution || {}));

  return (
    <View style={styles.wrap} testID="reviews-section">
      <Text style={styles.heading}>Ratings & Reviews</Text>

      {/* Summary */}
      <View style={styles.summary} testID="reviews-summary">
        <View style={styles.sumLeft}>
          <Text style={styles.bigScore}>{summary.avg_rating.toFixed(1)}</Text>
          <StarRating value={summary.avg_rating} size={16} />
          <Text style={styles.totalText}>
            {summary.total} review{summary.total === 1 ? "" : "s"}
          </Text>
        </View>
        <View style={styles.sumRight}>
          {([5, 4, 3, 2, 1] as const).map((n) => {
            const cnt = summary.distribution?.[String(n) as "5"] || 0;
            const pct = cnt / distMax;
            return (
              <View key={n} style={styles.distRow}>
                <Text style={styles.distLabel}>{n}★</Text>
                <View style={styles.distTrack}>
                  <View style={[styles.distFill, { width: `${pct * 100}%` }]} />
                </View>
                <Text style={styles.distCount}>{cnt}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Write review CTA */}
      {can_review && eligible_order_ids.length > 0 ? (
        <Pressable
          testID="write-review-btn"
          onPress={() => onWriteReview(eligible_order_ids[0])}
          style={({ pressed }) => [styles.writeBtn, pressed && { opacity: 0.85 }]}
        >
          <PenSquare size={16} color="#fff" />
          <Text style={styles.writeBtnText}>Write a review</Text>
        </Pressable>
      ) : user && !can_review && summary.total === 0 ? (
        <View style={styles.eligibilityNote}>
          <Text style={styles.eligibilityText}>
            ⓘ Only verified buyers can leave a review.
          </Text>
        </View>
      ) : null}

      {/* Sort chips */}
      {items.length > 1 ? (
        <View style={styles.sortRow}>
          {SORTS.map((s) => {
            const active = sort === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => setSort(s.key)}
                style={[styles.sortChip, active && styles.sortChipActive]}
              >
                <Text
                  style={[styles.sortText, active && styles.sortTextActive]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* List */}
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No reviews yet. Be the first! ⭐</Text>
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((r) => {
            const liked = !!user && r.helpful_user_ids?.includes(user.id);
            return (
              <View key={r.id} style={styles.reviewCard} testID={`review-${r.id}`}>
                <View style={styles.reviewHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(r.user_name || "U").slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewer}>{r.user_name}</Text>
                    <View style={styles.reviewMetaRow}>
                      <StarRating value={r.rating} size={12} />
                      {r.verified_purchase ? (
                        <Text style={styles.verified}>✓ Verified purchase</Text>
                      ) : null}
                      {r.user_country ? (
                        <Text style={styles.country}>{r.user_country}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.date}>{formatDate(r.created_at)}</Text>
                </View>

                {r.title ? <Text style={styles.reviewTitle}>{r.title}</Text> : null}
                <Text style={styles.reviewBody}>{r.comment}</Text>

                {r.photos?.length ? (
                  <View style={styles.photoRow}>
                    {r.photos.slice(0, 6).map((p, i) => (
                      <Image key={i} source={{ uri: p }} style={styles.reviewPhoto} />
                    ))}
                  </View>
                ) : null}

                {r.seller_reply ? (
                  <View style={styles.reply}>
                    <View style={styles.replyHeader}>
                      <MessageCircle size={12} color={colors.primary} />
                      <Text style={styles.replyName}>
                        {r.seller_reply.seller_name || "Seller"} replied
                      </Text>
                    </View>
                    <Text style={styles.replyBody}>{r.seller_reply.body}</Text>
                  </View>
                ) : null}

                <View style={styles.actionsRow}>
                  <Pressable
                    disabled={!user || busyId === r.id}
                    onPress={() => onHelpful(r.id)}
                    style={[styles.helpfulBtn, liked && styles.helpfulBtnActive]}
                    testID={`review-helpful-${r.id}`}
                  >
                    <ThumbsUp
                      size={13}
                      color={liked ? colors.primary : colors.textMuted}
                      fill={liked ? colors.primarySoft : "transparent"}
                    />
                    <Text
                      style={[
                        styles.helpfulText,
                        liked && { color: colors.primary },
                      ]}
                    >
                      Helpful{r.helpful_count > 0 ? ` · ${r.helpful_count}` : ""}
                    </Text>
                  </Pressable>
                  {user && r.user_id !== user.id ? (
                    <Pressable
                      onPress={() => onReport(r.id, r.user_id)}
                      style={styles.reportBtn}
                      testID={`review-report-${r.id}`}
                      hitSlop={6}
                    >
                      <Flag
                        size={12}
                        color={reportedIds.has(r.id) ? colors.error : colors.textMuted}
                        fill={reportedIds.has(r.id) ? colors.error : "transparent"}
                      />
                      <Text
                        style={[
                          styles.reportText,
                          reportedIds.has(r.id) && { color: colors.error },
                        ]}
                      >
                        {reportedIds.has(r.id) ? "Reported" : "Report"}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl },
  loading: { padding: spacing.lg, alignItems: "center" },
  heading: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.3,
  },
  summary: {
    flexDirection: "row",
    gap: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sumLeft: { alignItems: "center", gap: 4, minWidth: 80 },
  bigScore: {
    fontSize: 36,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -1,
  },
  totalText: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  sumRight: { flex: 1, justifyContent: "center", gap: 4 },
  distRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  distLabel: { width: 22, color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  distTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  distFill: { height: "100%", backgroundColor: "#F59E0B" },
  distCount: { width: 24, textAlign: "right", color: colors.textMuted, fontSize: 12 },
  writeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  writeBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  eligibilityNote: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  eligibilityText: { color: colors.textMuted, fontSize: 12, textAlign: "center" },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.md },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: "transparent",
  },
  sortChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  sortText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  sortTextActive: { color: colors.primary },
  empty: { padding: spacing.lg, alignItems: "center" },
  emptyText: { color: colors.textMuted },
  reviewCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  reviewHeader: { flexDirection: "row", gap: 10, alignItems: "center" },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.primary, fontWeight: "800" },
  reviewer: { fontWeight: "700", color: colors.text, fontSize: 14 },
  reviewMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
    flexWrap: "wrap",
  },
  verified: { color: colors.success, fontSize: 11, fontWeight: "700" },
  country: { color: colors.textMuted, fontSize: 11 },
  date: { color: colors.textFaint, fontSize: 11 },
  reviewTitle: {
    marginTop: spacing.sm,
    fontWeight: "700",
    color: colors.text,
    fontSize: 14,
  },
  reviewBody: { color: colors.text, marginTop: 4, lineHeight: 20, fontSize: 14 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  reviewPhoto: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surface },
  reply: {
    marginTop: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  replyHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  replyName: { fontWeight: "700", color: colors.primary, fontSize: 12 },
  replyBody: { marginTop: 4, color: colors.text, fontSize: 13, lineHeight: 19 },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.sm,
  },
  helpfulBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  helpfulBtnActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  helpfulText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "transparent",
  },
  reportText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
});
