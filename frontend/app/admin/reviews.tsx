import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Filter,
  ImageIcon,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AdminForbidden,
  AdminIdentity,
  AdminUnauthorized,
  adminApi,
  bootstrapIdentity,
  fetchCurrentAdmin,
  getAdminIdentity,
  getAdminSecret,
  hasRole,
} from "@/src/lib/adminApi";
import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

type Review = {
  id: string;
  product_id: string;
  product_name?: string | null;
  user_id: string;
  user_name?: string | null;
  rating: number;
  title?: string | null;
  comment?: string | null;
  photos?: string[] | null;
  helpful_count?: number;
  created_at?: string | null;
  verified_purchase?: boolean;
  seller_id?: string | null;
  reported?: boolean;
  hidden?: boolean;
};

type ListResp = {
  reviews: Review[];
  total: number;
  limit: number;
  skip: number;
  has_more: boolean;
};

const RATING_FILTERS: { label: string; min?: number; max?: number }[] = [
  { label: "All" },
  { label: "1★", min: 1, max: 1 },
  { label: "2★", min: 2, max: 2 },
  { label: "1–2★", min: 1, max: 2 },
  { label: "3★", min: 3, max: 3 },
  { label: "4★+", min: 4 },
];

const PAGE_SIZE = 25;

export default function AdminReviews() {
  const router = useRouter();
  const { show } = useToast();
  const confirm = useConfirm();
  const { t } = useTranslation();

  const [me, setMe] = useState<AdminIdentity | null>(null);
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [ratingIdx, setRatingIdx] = useState(0);
  const [photosOnly, setPhotosOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "approved" | "reported" | "hidden"
  >("all");

  // Lightbox for photos
  const [lightbox, setLightbox] = useState<string | null>(null);

  const canDelete = me ? hasRole(me.role, "manager") : false;

  const queryString = useCallback(
    (skip: number) => {
      const f = RATING_FILTERS[ratingIdx];
      const parts = [`limit=${PAGE_SIZE}`, `skip=${skip}`];
      if (f.min !== undefined) parts.push(`rating_min=${f.min}`);
      if (f.max !== undefined) parts.push(`rating_max=${f.max}`);
      if (photosOnly) parts.push("has_photos=true");
      if (statusFilter !== "all") parts.push(`status=${statusFilter}`);
      return `?${parts.join("&")}`;
    },
    [photosOnly, ratingIdx, statusFilter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Resolve identity (mirrors team.tsx pattern).
      let identity: AdminIdentity | null = await getAdminIdentity();
      if (!identity) identity = await fetchCurrentAdmin();
      if (!identity) {
        const sec = await getAdminSecret();
        if (sec) identity = bootstrapIdentity();
      }
      setMe(identity);

      const resp = await adminApi<ListResp>(
        `/admin/reviews${queryString(0)}`
      );
      setItems(resp.reviews || []);
      setTotal(resp.total || 0);
      setHasMore(!!resp.has_more);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        show({ title: t("admin_reviews.login_required"), kind: "error" });
        router.replace("/admin");
        return;
      }
      if (e instanceof AdminForbidden) {
        show({ title: t("admin_reviews.forbidden"), kind: "error" });
        router.replace("/admin");
        return;
      }
      show({ title: e?.message || t("admin_reviews.failed_load"), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [queryString, router, show, t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const resp = await adminApi<ListResp>(
        `/admin/reviews${queryString(items.length)}`
      );
      setItems((prev) => [...prev, ...(resp.reviews || [])]);
      setHasMore(!!resp.has_more);
    } catch (e: any) {
      show({ title: e?.message || t("admin_reviews.failed_load_more"), kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items.length, loadingMore, queryString, show, t]);

  const onDelete = async (review: Review) => {
    const ok = await confirm({
      title: t("admin_reviews.delete_title"),
      message: t("admin_reviews.delete_msg"),
      confirmLabel: t("admin_reviews.delete_confirm"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminApi(`/admin/reviews/${review.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((r) => r.id !== review.id));
      setTotal((t2) => Math.max(0, t2 - 1));
      show({ title: t("admin_reviews.review_deleted"), kind: "success" });
    } catch (e: any) {
      show({ title: e?.message || t("admin_reviews.delete_failed"), kind: "error" });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          testID="admin-reviews-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>{t("admin_reviews.title")}</Text>
          <Text style={styles.headerSub}>{t("admin_reviews.total_matching", { count: total })}</Text>
        </View>
        <Pressable
          testID="admin-reviews-refresh"
          onPress={load}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <RefreshCw size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Filters */}
      <View style={styles.filterBar}>
        <View style={styles.filterScrollWrap}>
          <FlatList
            horizontal
            data={RATING_FILTERS}
            keyExtractor={(f) => f.label}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.lg }}
            renderItem={({ item, index }) => {
              const active = index === ratingIdx;
              return (
                <Pressable
                  testID={`admin-reviews-filter-rating-${item.label}`}
                  onPress={() => setRatingIdx(index)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
        <View style={styles.filterRow}>
          <Pressable
            testID="admin-reviews-filter-photos"
            onPress={() => setPhotosOnly((v) => !v)}
            style={[styles.chipSmall, photosOnly && styles.chipActive]}
          >
            <ImageIcon size={12} color={photosOnly ? "#fff" : colors.textMuted} />
            <Text
              style={[
                styles.chipTextSmall,
                photosOnly && styles.chipTextActive,
              ]}
            >
              With photos
            </Text>
          </Pressable>
          {(["all", "approved", "reported", "hidden"] as const).map((s) => (
            <Pressable
              key={s}
              testID={`admin-reviews-filter-status-${s}`}
              onPress={() => setStatusFilter(s)}
              style={[
                styles.chipSmall,
                statusFilter === s && styles.chipActive,
              ]}
            >
              <Text
                style={[
                  styles.chipTextSmall,
                  statusFilter === s && styles.chipTextActive,
                ]}
              >
                {s === "all"
                  ? t("admin_reviews.filter_any_status")
                  : s === "approved"
                    ? t("admin_reviews.filter_approved")
                    : s === "reported"
                      ? t("admin_reviews.filter_reported")
                      : t("admin_reviews.filter_hidden")}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Filter size={28} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>{t("admin_reviews.empty_title")}</Text>
          <Text style={styles.emptySub}>
            {t("admin_reviews.empty_sub")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ReviewCard
              review={item}
              canDelete={canDelete}
              onDelete={() => onDelete(item)}
              onOpenPhoto={(uri) => setLightbox(uri)}
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ padding: spacing.lg, alignItems: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : !hasMore && items.length > 0 ? (
              <Text style={styles.endNote}>{t("admin_reviews.end_of_list", { shown: items.length, total })}</Text>
            ) : null
          }
        />
      )}

      {/* Lightbox modal */}
      <Modal
        visible={!!lightbox}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <Pressable
          style={styles.lightboxBackdrop}
          onPress={() => setLightbox(null)}
        >
          {lightbox ? (
            <Image
              source={{ uri: lightbox }}
              style={styles.lightboxImage}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Single review card
// ---------------------------------------------------------------------------
function ReviewCard({
  review,
  canDelete,
  onDelete,
  onOpenPhoto,
}: {
  review: Review;
  canDelete: boolean;
  onDelete: () => void;
  onOpenPhoto: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const date = useMemo(() => {
    if (!review.created_at) return "";
    try {
      return new Date(review.created_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  }, [review.created_at]);

  const photos = review.photos || [];

  return (
    <View style={styles.card} testID={`admin-review-${review.id}`}>
      <View style={styles.cardHeader}>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              size={14}
              color={n <= review.rating ? "#F59E0B" : "#E5E7EB"}
              fill={n <= review.rating ? "#F59E0B" : "transparent"}
            />
          ))}
          <Text style={styles.ratingText}>{review.rating.toFixed(1)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {review.reported ? (
          <View style={styles.badgeReported}>
            <Text style={styles.badgeReportedText}>{t("admin_reviews.badge_reported")}</Text>
          </View>
        ) : null}
        {review.verified_purchase ? (
          <View style={styles.badgeVerified}>
            <Text style={styles.badgeVerifiedText}>{t("admin_reviews.badge_verified")}</Text>
          </View>
        ) : null}
      </View>

      {review.title ? (
        <Text style={styles.title} numberOfLines={2}>
          {review.title}
        </Text>
      ) : null}
      {review.comment ? (
        <Text style={styles.comment} numberOfLines={6}>
          {review.comment}
        </Text>
      ) : null}

      {photos.length > 0 ? (
        <View style={styles.photoRow}>
          {photos.slice(0, 6).map((p, i) => (
            <Pressable
              key={`${review.id}-photo-${i}`}
              onPress={() => onOpenPhoto(p)}
              style={styles.thumb}
            >
              <Image source={{ uri: p }} style={styles.thumbImg} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaText} numberOfLines={1}>
          {review.user_name || t("admin_reviews.anonymous")} · {date}
        </Text>
        {review.helpful_count ? (
          <Text style={styles.metaText}>👍 {review.helpful_count}</Text>
        ) : null}
      </View>
      {review.product_name ? (
        <Text style={styles.productLink} numberOfLines={1}>
          {t("admin_reviews.on_product", { name: review.product_name })}
        </Text>
      ) : (
        <Text style={styles.productLink} numberOfLines={1}>
          {t("admin_reviews.product_label", { id: review.product_id.slice(0, 8) })}
        </Text>
      )}

      {canDelete ? (
        <Pressable
          testID={`admin-review-delete-${review.id}`}
          onPress={onDelete}
          style={({ pressed }) => [
            styles.deleteBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Trash2 size={14} color="#b91c1c" />
          <Text style={styles.deleteBtnText}>{t("admin_reviews.delete_review_btn")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  filterBar: {
    backgroundColor: "#fff",
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterScrollWrap: { marginBottom: 8 },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: spacing.lg,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.text },
  chipTextActive: { color: "#fff" },
  chipSmall: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  chipTextSmall: { fontSize: 11, fontWeight: "700", color: colors.textMuted },

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 8 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center" },

  list: { padding: spacing.lg, gap: spacing.md },

  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 1 },
  ratingText: { marginLeft: 6, fontSize: 13, fontWeight: "800", color: colors.text },
  badgeReported: { backgroundColor: "#fee2e2", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeReportedText: { fontSize: 10, fontWeight: "800", color: "#991b1b" },
  badgeVerified: { backgroundColor: "#dcfce7", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  badgeVerifiedText: { fontSize: 10, fontWeight: "800", color: "#166534" },

  title: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 4 },
  comment: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },

  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surface },
  thumbImg: { width: "100%", height: "100%" },

  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  metaText: { fontSize: 12, color: colors.textFaint, fontWeight: "600" },
  productLink: { fontSize: 12, color: colors.primary, fontWeight: "700", marginTop: 4 },

  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.md,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  deleteBtnText: { fontSize: 13, fontWeight: "800", color: "#b91c1c" },

  endNote: { textAlign: "center", color: colors.textFaint, fontSize: 12, paddingVertical: spacing.lg },

  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  lightboxImage: { width: "100%", height: "100%" },
});
