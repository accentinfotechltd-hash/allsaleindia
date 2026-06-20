/**
 * Seller B2B Referral Gamification — tier · badges · leaderboard.
 *
 * Pulls everything from /api/b2b/gamification/{me,leaderboard,tiers}.
 * Designed so a fresh seller (Newcomer tier, 0 badges) and a Gold-tier
 * pro both feel rewarded — locked badges visible in greyscale so there's
 * always a clear next mountain to climb.
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft,
  Crown,
  HelpCircle,
  Share2,
  Trophy,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Tier = {
  key: string;
  label: string;
  emoji: string;
  color: string;
  min_approved: number;
};

type GamificationMe = {
  stats: {
    invites_sent: number;
    signed_up: number;
    approved: number;
    commission_total_nzd: number;
    kingmaker: boolean;
  };
  tier: Tier;
  next_tier: (Tier & { needed: number }) | null;
  progress_pct: number;
  rank_all_time: number | null;
  badges: {
    key: string;
    label: string;
    description: string;
    emoji: string;
    unlocked: boolean;
  }[];
  unlocked_count: number;
};

type LeaderboardRow = {
  rank: number;
  display_name: string;
  city?: string | null;
  approved: number;
  commission_nzd: number;
  tier: Tier;
  is_me: boolean;
};

type Period = "all" | "month" | "week";

export default function GamificationScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { show } = useToast();
  const [me, setMe] = useState<GamificationMe | null>(null);
  const [period, setPeriod] = useState<Period>("all");
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: Period = period) => {
    try {
      const [mePayload, lbPayload] = await Promise.all([
        api<GamificationMe>("/b2b/gamification/me"),
        api<{ items: LeaderboardRow[] }>(
          `/b2b/gamification/leaderboard?period=${p}&limit=20`
        ),
      ]);
      setMe(mePayload);
      setBoard(lbPayload.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(period);
    }, [load, period])
  );

  const onShare = useCallback(async () => {
    try {
      const url = "https://allsale.co.nz/seller/join?ref=ALLSALE-BIZ";
      const message = t("seller_referrals_game.share_message", { url });
      await Share.share({ message });
    } catch {
      show({ title: t("seller_referrals_game.couldnt_share"), kind: "error" });
    }
  }, [show, t]);

  if (loading || !me) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="b2b-game-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("seller_referrals_game.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <TierHero
          me={me}
          onShare={onShare}
          t={t}
        />

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{me.stats.approved}</Text>
            <Text style={styles.statLabel}>{t("seller_referrals_game.stat_approved")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{me.stats.signed_up}</Text>
            <Text style={styles.statLabel}>{t("seller_referrals_game.stat_signed_up")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              ${me.stats.commission_total_nzd.toFixed(0)}
            </Text>
            <Text style={styles.statLabel}>{t("seller_referrals_game.stat_earned")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {me.rank_all_time ? `#${me.rank_all_time}` : "—"}
            </Text>
            <Text style={styles.statLabel}>{t("seller_referrals_game.stat_rank")}</Text>
          </View>
        </View>

        {/* Badges */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("seller_referrals_game.section_badges")}</Text>
          <Text style={styles.sectionMeta}>
            {t("seller_referrals_game.badges_count", { unlocked: me.unlocked_count, total: me.badges.length })}
          </Text>
        </View>
        <View style={styles.badgeGrid}>
          {me.badges.map((b) => (
            <View
              key={b.key}
              testID={`b2b-badge-${b.key}`}
              style={[styles.badgeCard, !b.unlocked && styles.badgeCardLocked]}
            >
              <Text style={[styles.badgeEmoji, !b.unlocked && { opacity: 0.35 }]}>
                {b.emoji}
              </Text>
              <Text
                style={[styles.badgeLabel, !b.unlocked && { opacity: 0.55 }]}
                numberOfLines={1}
              >
                {b.label}
              </Text>
              <Text style={styles.badgeDesc} numberOfLines={2}>
                {b.description}
              </Text>
            </View>
          ))}
        </View>

        {/* Leaderboard */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("seller_referrals_game.section_leaderboard")}</Text>
          <View style={styles.periodPills}>
            {(["week", "month", "all"] as Period[]).map((p) => (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                testID={`b2b-period-${p}`}
                style={[
                  styles.periodPill,
                  period === p && styles.periodPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.periodPillText,
                    period === p && { color: "#fff" },
                  ]}
                >
                  {p === "all" ? t("seller_referrals_game.period_all") : p === "week" ? t("seller_referrals_game.period_week") : t("seller_referrals_game.period_month")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {board && board.length > 0 ? (
          <View style={styles.boardList}>
            {board.map((row) => (
              <View
                key={`${row.rank}-${row.display_name}`}
                style={[styles.boardRow, row.is_me && styles.boardRowMine]}
                testID={`b2b-board-row-${row.rank}`}
              >
                <View style={styles.rankPill}>
                  {row.rank === 1 ? (
                    <Crown size={14} color="#92400E" />
                  ) : (
                    <Text style={styles.rankText}>#{row.rank}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.boardName} numberOfLines={1}>
                    {row.display_name}
                    {row.is_me ? t("seller_referrals_game.you_suffix") : ""}
                  </Text>
                  <Text style={styles.boardMeta} numberOfLines={1}>
                    {row.tier.emoji} {row.tier.label}
                    {row.city ? ` · ${row.city}` : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.boardApproved}>{row.approved}</Text>
                  <Text style={styles.boardCommission}>
                    ${row.commission_nzd.toFixed(0)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyBoard}>
            <Trophy size={28} color={colors.textMuted} />
            <Text style={styles.emptyBoardTitle}>
              {t("seller_referrals_game.empty_first_title")}
            </Text>
            <Text style={styles.emptyBoardBody}>
              {t("seller_referrals_game.empty_first_body", { period: period === "all" ? t("seller_referrals_game.empty_period_year") : period === "week" ? t("seller_referrals_game.period_week") : t("seller_referrals_game.period_month") })}
            </Text>
          </View>
        )}

        <View style={styles.footerHint}>
          <HelpCircle size={14} color={colors.textMuted} />
          <Text style={styles.footerHintText}>
            {t("seller_referrals_game.footer_hint")}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
function TierHero({
  me,
  onShare,
  t,
}: {
  me: GamificationMe;
  onShare: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const ribbon = me.tier.color;
  const progressLabel = useMemo(() => {
    if (!me.next_tier) return t("seller_referrals_game.max_tier");
    return t("seller_referrals_game.more_to_tier", { n: me.next_tier.needed, tier: me.next_tier.label, emoji: me.next_tier.emoji });
  }, [me.next_tier, t]);
  return (
    <View style={[styles.tierHero, { borderColor: ribbon }]}>
      <View style={[styles.tierRibbon, { backgroundColor: ribbon }]}>
        <Text style={styles.tierRibbonText}>{me.tier.label.toUpperCase()}</Text>
      </View>
      <Text style={styles.tierEmoji}>{me.tier.emoji}</Text>
      <Text style={styles.tierName}>{me.tier.label}</Text>
      <Text style={styles.tierSub}>{progressLabel}</Text>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${me.progress_pct}%`, backgroundColor: ribbon },
          ]}
        />
      </View>
      <Pressable
        testID="b2b-share-btn"
        onPress={onShare}
        style={({ pressed }) => [
          styles.shareBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Share2 size={16} color="#fff" />
        <Text style={styles.shareBtnText}>{t("seller_referrals_game.share_btn")}</Text>
      </Pressable>
      {me.stats.kingmaker ? (
        <View style={styles.kingmakerPill}>
          <Crown size={12} color="#92400E" />
          <Text style={styles.kingmakerText}>{t("seller_referrals_game.kingmaker")}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: "#fff",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  center: { alignItems: "center", justifyContent: "center", padding: 32 },

  tierHero: {
    margin: spacing.md, padding: spacing.lg,
    backgroundColor: "#fff", borderRadius: radius.xl,
    borderWidth: 2, alignItems: "center", gap: 6,
    position: "relative",
  },
  tierRibbon: {
    position: "absolute", top: -1, right: -1,
    paddingHorizontal: 12, paddingVertical: 4,
    borderTopRightRadius: radius.xl, borderBottomLeftRadius: radius.md,
  },
  tierRibbonText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  tierEmoji: { fontSize: 56, marginTop: 4 },
  tierName: { fontSize: 22, fontWeight: "800", color: colors.text },
  tierSub: { color: colors.textMuted, fontSize: 13 },
  progressTrack: {
    width: "100%", height: 6,
    backgroundColor: colors.surface, borderRadius: 999, marginTop: 8, overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 999 },

  shareBtn: {
    flexDirection: "row", gap: 6, alignItems: "center",
    backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 11,
    borderRadius: 999, marginTop: 14,
  },
  shareBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  kingmakerPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7", borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 10,
  },
  kingmakerText: { color: "#92400E", fontWeight: "800", fontSize: 11 },

  statsRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: spacing.md, marginBottom: spacing.md,
  },
  statCard: {
    flex: 1, padding: 12, backgroundColor: "#fff",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: "center",
  },
  statValue: { color: colors.text, fontWeight: "800", fontSize: 18 },
  statLabel: { color: colors.textMuted, fontSize: 10, textTransform: "uppercase", marginTop: 2 },

  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, marginTop: 8, marginBottom: 8,
  },
  sectionTitle: { color: colors.text, fontWeight: "800", fontSize: 15 },
  sectionMeta: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },

  badgeGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
    paddingHorizontal: spacing.md,
  },
  badgeCard: {
    flexBasis: "30%", flexGrow: 1,
    padding: 12, backgroundColor: "#fff", borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: 4,
  },
  badgeCardLocked: { backgroundColor: colors.surface },
  badgeEmoji: { fontSize: 30 },
  badgeLabel: { color: colors.text, fontWeight: "800", fontSize: 11, textAlign: "center" },
  badgeDesc: { color: colors.textMuted, fontSize: 10, textAlign: "center", lineHeight: 13 },

  periodPills: { flexDirection: "row", gap: 4 },
  periodPill: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: colors.surface, borderRadius: 999,
  },
  periodPillActive: { backgroundColor: colors.primary },
  periodPillText: { color: colors.text, fontWeight: "700", fontSize: 11, textTransform: "capitalize" },

  boardList: {
    paddingHorizontal: spacing.md, gap: 6,
  },
  boardRow: {
    flexDirection: "row", gap: 10, alignItems: "center",
    padding: 12, backgroundColor: "#fff",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  boardRowMine: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rankPill: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  rankText: { fontWeight: "800", color: colors.text, fontSize: 12 },
  boardName: { fontWeight: "800", color: colors.text, fontSize: 13 },
  boardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  boardApproved: { fontWeight: "800", color: colors.text, fontSize: 14 },
  boardCommission: { color: colors.textMuted, fontSize: 11 },

  emptyBoard: {
    margin: spacing.md, padding: spacing.lg,
    backgroundColor: "#fff", borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", gap: 4,
  },
  emptyBoardTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  emptyBoardBody: {
    color: colors.textMuted, fontSize: 12, textAlign: "center",
    paddingHorizontal: spacing.md, lineHeight: 16,
  },

  footerHint: {
    flexDirection: "row", gap: 8,
    margin: spacing.md, padding: 12,
    backgroundColor: colors.surface, borderRadius: radius.md,
    alignItems: "flex-start",
  },
  footerHintText: { flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 15 },
});
