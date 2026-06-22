import { useRouter } from "expo-router";
import {
  Camera,
  Check,
  ChevronLeft,
  Copy,
  Share2,
  Sparkles,
  Wallet,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { ApiError } from "@/src/lib/api";
import {
  AmbassadorMe,
  ContentSubmission,
  formatMoney,
  getMe,
  getMyLinkMetrics,
  LinkMetrics,
  listContent,
  listReferredSellers,
  listSales,
  ReferredSellerRow,
  requestWithdraw,
  SaleRow,
  submitContent,
} from "@/src/lib/ambassadors";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

type Tab = "sales" | "sellers" | "profile";

export default function AmbassadorDashboard() {
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();
  const [me, setMe] = useState<AmbassadorMe | null>(null);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sellers, setSellers] = useState<ReferredSellerRow[]>([]);
  const [content, setContent] = useState<ContentSubmission[]>([]);
  const [linkMetrics, setLinkMetrics] = useState<LinkMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("sales");
  const [postUrl, setPostUrl] = useState("");
  const [posting, setPosting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const load = useCallback(async () => {
    try {
      const m = await getMe();
      setMe(m);
      const [s, sl, c, lm] = await Promise.all([
        listSales(20),
        m.program === "B2B" || m.program === "BOTH"
          ? listReferredSellers()
          : Promise.resolve<ReferredSellerRow[]>([]),
        listContent(),
        getMyLinkMetrics().catch(() => null),
      ]);
      setSales(s);
      setSellers(sl);
      setContent(c);
      setLinkMetrics(lm);
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("not enrolled")) {
        router.replace("/ambassadors");
      } else {
        toast.show({ title: "Couldn't load dashboard", body: msg, kind: "error" });
      }
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const onCopyCode = async (code: string) => {
    try {
      // @ts-ignore
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        // @ts-ignore
        await navigator.clipboard.writeText(code);
      }
      toast.show({ title: t("ambassadors_dashboard.toast_code_copied_title"), body: t("ambassadors_dashboard.toast_code_copied_body", { code }), kind: "success" });
    } catch {
      toast.show({ title: t("ambassadors_dashboard.toast_your_code"), body: code, kind: "success" });
    }
  };

  const onShareCode = async (code: string, suffix: string) => {
    try {
      await Share.share({
        message: t("ambassadors_dashboard.share_msg", { code, suffix }),
      });
    } catch (e: any) {
      toast.show({ title: t("ambassadors_dashboard.toast_share_failed_title"), body: e?.message || t("ambassadors_dashboard.toast_share_failed_body"), kind: "error" });
    }
  };

  const onSubmitPost = async () => {
    const url = postUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      toast.show({ title: t("ambassadors_dashboard.err_post_url"), kind: "error" });
      return;
    }
    setPosting(true);
    try {
      const item = await submitContent(url);
      setContent((prev) => [item, ...prev]);
      setPostUrl("");
      toast.show({ title: t("ambassadors_dashboard.post_submitted_title"), body: t("ambassadors_dashboard.post_submitted_body"), kind: "success" });
      // Refresh `me` so the posts-this-month counter ticks up.
      const fresh = await getMe();
      setMe(fresh);
    } catch (e: any) {
      toast.show({ title: t("ambassadors_dashboard.post_failed_title"), body: e?.message || t("ambassadors_dashboard.post_failed_body"), kind: "error" });
    } finally {
      setPosting(false);
    }
  };

  const onWithdraw = async () => {
    setWithdrawing(true);
    try {
      const res = await requestWithdraw();
      if (res.status === "blocked") {
        toast.show({ title: t("ambassadors_dashboard.withdraw_blocked_title"), body: res.reason || "", kind: "info" });
      } else {
        toast.show({
          title: t("ambassadors_dashboard.withdraw_queued_title"),
          body: t("ambassadors_dashboard.withdraw_queued_body", { amount: formatMoney(res.requested_amount, res.currency) }),
          kind: "success",
        });
        const fresh = await getMe();
        setMe(fresh);
      }
    } catch (e: any) {
      toast.show({ title: t("ambassadors_dashboard.withdraw_failed_title"), body: e?.message || "", kind: "error" });
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }
  if (!me) return null;

  // ---------------------------------------------------------------------
  // Terminal-state views: rejected / permanently_banned ambassadors don't
  // get the full dashboard — they get a focused card explaining the state
  // (and a Re-apply CTA if the cool-down has elapsed).
  // ---------------------------------------------------------------------
  if (me.status === "rejected" || me.status === "permanently_banned") {
    return (
      <RejectedDashboard
        me={me}
        onReapply={() => router.replace("/ambassadors/join")}
        onBack={() => router.back()}
      />
    );
  }

  // Pending applications: show the in-review interstitial with T&Cs and
  // resend-email actions. No share/withdraw/KPIs/tier widgets — the code
  // isn't live yet.
  if (me.status === "pending_approval") {
    return (
      <PendingDashboard
        me={me}
        onChange={(m) => setMe(m)}
        onBack={() => router.back()}
      />
    );
  }

  // Tier progress
  const tierFrom = me.tier.min_orders_30d;
  const tierTo = me.next_tier?.min_orders_30d ?? me.tier.min_orders_30d;
  const tierSpan = Math.max(1, tierTo - tierFrom);
  const tierProgressPct = me.next_tier
    ? Math.min(100, Math.max(0, ((me.orders_30d - tierFrom) / tierSpan) * 100))
    : 100;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("ambassadors_dashboard.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Greeting + lifetime */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Sparkles size={22} color="#fff" />
          </View>
          <Text style={styles.heroGreeting}>{t("ambassadors_dashboard.hero_hi", { name: me.name.split(" ")[0] || t("ambassadors_dashboard.hero_default_name") })}</Text>
          <Text style={styles.heroBig}>
            {formatMoney(me.lifetime_commission, me.payout_currency)}
          </Text>
          <Text style={styles.heroLabel}>{t("ambassadors_dashboard.hero_lifetime")}</Text>
        </View>

        {/* Share code cards */}
        <Text style={styles.sectionTitle}>{me.code_b2b ? t("ambassadors_dashboard.your_codes_plural") : t("ambassadors_dashboard.your_code_single")}</Text>
        <CodeCard
          code={me.code}
          subtitle={t("ambassadors_dashboard.code_subtitle_b2c")}
          onCopy={() => onCopyCode(me.code)}
          onShare={() => onShareCode(me.code, t("ambassadors_dashboard.share_suffix_b2c"))}
          testIDPrefix="amb-code-b2c"
        />
        {me.code_b2b && (
          <CodeCard
            code={me.code_b2b}
            subtitle={t("ambassadors_dashboard.code_subtitle_b2b")}
            onCopy={() => onCopyCode(me.code_b2b!)}
            onShare={() => onShareCode(me.code_b2b!, t("ambassadors_dashboard.share_suffix_b2b"))}
            testIDPrefix="amb-code-b2b"
          />
        )}

        {/* KPI tiles */}
        <View style={styles.kpiGrid}>
          <Kpi
            label={t("ambassadors_dashboard.kpi_available")}
            value={formatMoney(me.unpaid_balance, me.payout_currency)}
            color={colors.success}
          />
          <Kpi
            label={t("ambassadors_dashboard.kpi_pending")}
            value={formatMoney(me.pending_commission, me.payout_currency)}
            color={colors.textMuted}
          />
          <Kpi label={t("ambassadors_dashboard.kpi_orders_30d")} value={String(me.orders_30d)} />
          <Kpi
            label={t("ambassadors_dashboard.kpi_posts_mo")}
            value={`${me.posts_this_month}/${me.posts_required}`}
            color={me.posts_this_month >= me.posts_required ? colors.success : colors.textMuted}
          />
        </View>

        {/* Link Performance — clicks on /a/{code} smart links */}
        {linkMetrics ? (
          <View style={styles.linkPerfCard} testID="ambassadors-link-performance">
            <View style={styles.linkPerfHeader}>
              <Text style={styles.linkPerfTitle}>🔗 Link Performance</Text>
              <Text style={styles.linkPerfHint}>
                Anyone tapping your share link is counted here.
              </Text>
            </View>
            <View style={styles.linkPerfGrid}>
              <Kpi label="Clicks · 7d" value={String(linkMetrics.clicks_7d)} />
              <Kpi label="Clicks · 30d" value={String(linkMetrics.clicks_30d)} />
              {me.program === "B2B" || me.program === "BOTH" ? (
                <Kpi
                  label="Seller signups · 30d"
                  value={String(linkMetrics.seller_signups_30d)}
                  color={linkMetrics.seller_signups_30d > 0 ? colors.success : colors.textMuted}
                />
              ) : (
                <Kpi
                  label="Conversions · 30d"
                  value={String(linkMetrics.conversions_30d)}
                  color={linkMetrics.conversions_30d > 0 ? colors.success : colors.textMuted}
                />
              )}
              <Kpi
                label="Conv. rate · 30d"
                value={`${linkMetrics.conversion_rate_30d}%`}
                color={linkMetrics.conversion_rate_30d > 0 ? colors.primary : colors.textMuted}
              />
            </View>
            <Text style={styles.linkPerfFootnote}>
              {`Lifetime clicks: ${linkMetrics.clicks_total}`}
              {me.code_b2b
                ? ` · 🛒 ${linkMetrics.clicks_b2c} customer · 🏪 ${linkMetrics.clicks_b2b} seller`
                : null}
            </Text>
          </View>
        ) : null}

        {/* Tier progress */}
        <View style={styles.tierBox}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={styles.tierName}>{me.tier.label}</Text>
            <Text style={styles.tierRate}>{me.tier.rate_pct}%</Text>
          </View>
          {me.next_tier ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${tierProgressPct}%` }]} />
              </View>
              <Text style={styles.tierHint}>
                {t("ambassadors_dashboard.tier_more_orders", { n: Math.max(0, tierTo - me.orders_30d), label: me.next_tier.label, pct: me.next_tier.rate_pct })}
              </Text>
            </>
          ) : (
            <Text style={styles.tierHint}>{t("ambassadors_dashboard.tier_top")}</Text>
          )}
        </View>

        {/* Withdraw card */}
        <View style={styles.withdrawCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.withdrawLabel}>{t("ambassadors_dashboard.withdraw_label")}</Text>
            <Text style={styles.withdrawAmount}>
              {formatMoney(me.unpaid_balance, me.payout_currency)}
            </Text>
          </View>
          <Pressable
            testID="amb-withdraw"
            disabled={withdrawing || me.unpaid_balance <= 0}
            onPress={onWithdraw}
            style={[
              styles.withdrawBtn,
              (withdrawing || me.unpaid_balance <= 0) && { opacity: 0.5 },
            ]}
          >
            <Wallet size={14} color="#fff" />
            <Text style={styles.withdrawText}>{t("ambassadors_dashboard.withdraw_btn")}</Text>
          </Pressable>
        </View>

        {/* Submit-content card */}
        <View style={styles.contentCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Camera size={16} color={colors.primary} />
            <Text style={styles.contentTitle}>{t("ambassadors_dashboard.content_title")}</Text>
          </View>
          <Text style={styles.contentSub}>
            {t("ambassadors_dashboard.content_sub", { n: me.posts_required })}
          </Text>
          <TextInput
            testID="amb-post-url"
            style={styles.contentInput}
            value={postUrl}
            onChangeText={setPostUrl}
            placeholder={t("ambassadors_dashboard.content_placeholder")}
            autoCapitalize="none"
            placeholderTextColor={colors.textFaint}
          />
          <Pressable
            testID="amb-post-submit"
            disabled={posting}
            style={[styles.contentBtn, posting && { opacity: 0.6 }]}
            onPress={onSubmitPost}
          >
            {posting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.contentBtnText}>{t("ambassadors_dashboard.content_submit_btn")}</Text>
            )}
          </Pressable>
          {content.length > 0 && (
            <View style={{ marginTop: spacing.sm, gap: 6 }}>
              {content.slice(0, 3).map((c) => (
                <View key={c.id} style={styles.contentRow}>
                  <Text numberOfLines={1} style={styles.contentRowUrl}>{c.post_url}</Text>
                  <View style={[styles.statusChip, statusStyle(c.status)]}>
                    <Text style={styles.statusText}>{c.status}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          <TabBtn label={t("ambassadors_dashboard.tab_sales")} testIDKey="sales" active={tab === "sales"} onPress={() => setTab("sales")} />
          {(me.program === "B2B" || me.program === "BOTH") && (
            <TabBtn
              label={t("ambassadors_dashboard.tab_sellers")} testIDKey="sellers"
              active={tab === "sellers"}
              onPress={() => setTab("sellers")}
            />
          )}
          <TabBtn label={t("ambassadors_dashboard.tab_profile")} testIDKey="profile" active={tab === "profile"} onPress={() => setTab("profile")} />
        </View>

        {tab === "sales" && (
          <View style={{ gap: spacing.xs }}>
            {sales.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t("ambassadors_dashboard.sales_empty")}</Text>
              </View>
            ) : (
              <>
                {sales.slice(0, 5).map((s) => (
                  <View key={s.order_id} style={styles.saleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.saleId}>#{s.order_short_id}</Text>
                      <Text style={styles.saleMeta}>
                        {new Date(s.placed_at).toLocaleDateString()} · {s.status}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.saleCommission}>
                        +{formatMoney(s.commission, s.currency)}
                      </Text>
                      <Text style={styles.saleLocked}>
                        {s.locked_at && new Date(s.locked_at) <= new Date() ? t("ambassadors_dashboard.sales_locked_available") : t("ambassadors_dashboard.sales_locked_on_hold")}
                      </Text>
                    </View>
                  </View>
                ))}
                <Pressable
                  testID="amb-view-all-sales"
                  onPress={() => router.push("/ambassadors/dashboard/sales")}
                  style={styles.viewAllBtn}
                >
                  <Text style={styles.viewAllText}>
                    {sales.length >= 5 ? t("ambassadors_dashboard.sales_view_all_n", { n: sales.length }) : t("ambassadors_dashboard.sales_view_all")}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {tab === "sellers" && (
          <View style={{ gap: spacing.xs }}>
            {sellers.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{t("ambassadors_dashboard.sellers_empty")}</Text>
              </View>
            ) : (
              <>
                {sellers.slice(0, 5).map((s) => (
                  <View key={s.seller_id} style={styles.saleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.saleId}>{s.seller_name}</Text>
                      <Text style={styles.saleMeta}>
                        {t("ambassadors_dashboard.sellers_meta", { orders: s.orders_to_date, mo: s.months_since_onboard })}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.saleCommission}>
                        ₹{s.earnings_to_date_inr.toLocaleString("en-IN")}
                      </Text>
                      <Text style={styles.saleLocked}>
                        {s.bounty_paid ? t("ambassadors_dashboard.sellers_bounty_paid") : t("ambassadors_dashboard.sellers_bounty_pending")}
                      </Text>
                    </View>
                  </View>
                ))}
                <Pressable
                  testID="amb-view-all-sellers"
                  onPress={() => router.push("/ambassadors/dashboard/sellers")}
                  style={styles.viewAllBtn}
                >
                  <Text style={styles.viewAllText}>{t("ambassadors_dashboard.sellers_view_all")}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {tab === "profile" && (
          <View>
            <ProfileEditor me={me} onSaved={(m) => setMe(m)} />
            <Pressable
              testID="amb-open-profile-page"
              onPress={() => router.push("/ambassadors/dashboard/profile")}
              style={styles.viewAllBtn}
            >
              <Text style={styles.viewAllText}>{t("ambassadors_dashboard.profile_open_full")}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Kpi({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function TabBtn({ label, active, onPress, testIDKey }: { label: string; active: boolean; onPress: () => void; testIDKey?: string }) {
  return (
    <Pressable
      testID={`amb-tab-${testIDKey || label.toLowerCase()}`}
      onPress={onPress}
      style={[styles.tabBtn, active && styles.tabBtnActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CodeCard({
  code,
  subtitle,
  onCopy,
  onShare,
  testIDPrefix,
}: {
  code: string;
  subtitle: string;
  onCopy: () => void;
  onShare: () => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.codeCard}>
      <Text style={styles.codeSubtitle}>{subtitle}</Text>
      <Text testID={`${testIDPrefix}-value`} style={styles.codeValue}>{code}</Text>
      <View style={styles.codeActions}>
        <Pressable testID={`${testIDPrefix}-copy`} onPress={onCopy} style={styles.codeCopy}>
          <Copy size={14} color={colors.primary} />
          <Text style={styles.codeCopyText}>{t("ambassadors_dashboard.code_copy")}</Text>
        </Pressable>
        <Pressable testID={`${testIDPrefix}-share`} onPress={onShare} style={styles.codeShare}>
          <Share2 size={14} color="#fff" />
          <Text style={styles.codeShareText}>{t("ambassadors_dashboard.code_share")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProfileEditor({ me, onSaved }: { me: AmbassadorMe; onSaved: (m: AmbassadorMe) => void }) {
  const toast = useToast();
  const { t } = useTranslation();
  const [handle, setHandle] = useState(me.social_handle || "");
  const [phone, setPhone] = useState(me.phone || "");
  const [audience, setAudience] = useState(
    me.audience_size != null ? String(me.audience_size) : ""
  );
  const [ccy, setCcy] = useState(me.payout_currency);
  const [saving, setSaving] = useState(false);
  const isIndia = me.country === "IN";

  const onSave = async () => {
    setSaving(true);
    try {
      const { updateMe } = await import("@/src/lib/ambassadors");
      const patch: Record<string, any> = {
        social_handle: handle.trim() || null,
        phone: phone.trim() || null,
      };
      if (audience.trim()) {
        const n = parseInt(audience.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(n)) patch.audience_size = n;
      }
      if (ccy !== me.payout_currency) patch.payout_currency = ccy;
      const fresh = await updateMe(patch);
      onSaved(fresh);
      toast.show({ title: t("ambassadors_dashboard.profile_saved_title"), kind: "success" });
    } catch (e: any) {
      toast.show({ title: t("ambassadors_dashboard.profile_save_failed"), body: e?.message || "", kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.label}>{t("ambassadors_dashboard.profile_label_handle")}</Text>
      <TextInput
        testID="amb-edit-handle"
        style={styles.input}
        value={handle}
        onChangeText={setHandle}
        placeholder={t("ambassadors_dashboard.profile_placeholder_handle")}
        autoCapitalize="none"
        placeholderTextColor={colors.textFaint}
      />

      <Text style={styles.label}>{t("ambassadors_dashboard.profile_label_phone")}</Text>
      <TextInput
        testID="amb-edit-phone"
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={t("ambassadors_dashboard.profile_placeholder_phone")}
        keyboardType="phone-pad"
        placeholderTextColor={colors.textFaint}
      />

      <Text style={styles.label}>{t("ambassadors_dashboard.profile_label_audience")}</Text>
      <TextInput
        testID="amb-edit-audience"
        style={styles.input}
        value={audience}
        onChangeText={setAudience}
        placeholder={t("ambassadors_dashboard.profile_placeholder_audience")}
        keyboardType="number-pad"
        placeholderTextColor={colors.textFaint}
      />

      <Text style={styles.label}>{t("ambassadors_dashboard.profile_label_currency")}</Text>
      <View style={styles.platformWrap}>
        {(isIndia ? ["INR"] : ["NZD", "AUD", "USD", "GBP", "CAD"]).map((c) => (
          <Pressable
            key={c}
            testID={`amb-ccy-${c}`}
            onPress={() => !isIndia && setCcy(c)}
            disabled={isIndia}
            style={[
              styles.platformChip,
              ccy === c && styles.platformChipActive,
              isIndia && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.platformChipText, ccy === c && styles.platformChipTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>
      {isIndia && (
        <Text style={{ color: colors.textFaint, fontSize: 11 }}>{t("ambassadors_dashboard.profile_india_inr_only")}</Text>
      )}

      <Pressable
        testID="amb-edit-save"
        disabled={saving}
        onPress={onSave}
        style={[styles.submitBtn, saving && { opacity: 0.6 }]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{t("ambassadors_dashboard.profile_save_btn")}</Text>}
      </Pressable>
    </View>
  );
}


/**
 * Terminal-state dashboard shown to rejected / permanently-banned ambassadors.
 * Surfaces the rejection reason + (for non-permanent rejections) the re-apply
 * date with a CTA that activates once the cool-down elapses.
 */
function RejectedDashboard({
  me,
  onReapply,
  onBack,
}: {
  me: AmbassadorMe;
  onReapply: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const isPermanent = me.status === "permanently_banned";
  const canReapplyAt = me.can_reapply_at ? new Date(me.can_reapply_at) : null;
  const now = new Date();
  const canReapplyNow = !isPermanent && canReapplyAt && canReapplyAt <= now;
  const daysUntil = canReapplyAt
    ? Math.max(0, Math.ceil((canReapplyAt.getTime() - now.getTime()) / 86_400_000))
    : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} testID="amb-rejected-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("ambassadors_dashboard.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.rejectedScroll}>
        {/* Status hero */}
        <View
          style={[
            styles.rejectedHero,
            isPermanent && { backgroundColor: "#7F1D1D" },
          ]}
          testID={isPermanent ? "amb-status-banned" : "amb-status-rejected"}
        >
          <Text style={styles.rejectedHeroTitle}>
            {isPermanent ? t("ambassadors_dashboard.rej_title_banned") : t("ambassadors_dashboard.rej_title_rejected")}
          </Text>
          <Text style={styles.rejectedHeroSub}>
            {isPermanent ? t("ambassadors_dashboard.rej_sub_banned") : t("ambassadors_dashboard.rej_sub_rejected", { name: me.name.split(" ")[0] || t("ambassadors_dashboard.hero_default_name") })}
          </Text>
        </View>

        {/* Reason card */}
        {me.rejected_reason && (
          <View style={styles.rejectedReasonCard} testID="amb-rejected-reason">
            <Text style={styles.rejectedReasonLabel}>{t("ambassadors_dashboard.rej_reason_label")}</Text>
            <Text style={styles.rejectedReasonText}>{me.rejected_reason}</Text>
          </View>
        )}

        {/* Re-apply CTA or cool-down hint */}
        {!isPermanent && canReapplyAt && (
          <View style={styles.rejectedReapplyCard}>
            <Text style={styles.rejectedReapplyLabel}>
              {canReapplyNow ? t("ambassadors_dashboard.rej_can_reapply_now") : t("ambassadors_dashboard.rej_can_reapply_on")}
            </Text>
            <Text style={styles.rejectedReapplyDate} testID="amb-rejected-reapply-date">
              {canReapplyAt.toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
            {!canReapplyNow && (
              <Text style={styles.rejectedReapplyHint}>
                {t(daysUntil === 1 ? "ambassadors_dashboard.rej_days_remaining_one" : "ambassadors_dashboard.rej_days_remaining_other", { n: daysUntil })}
              </Text>
            )}
            <Pressable
              testID="amb-rejected-reapply"
              disabled={!canReapplyNow}
              onPress={onReapply}
              style={[styles.rejectedReapplyBtn, !canReapplyNow && { opacity: 0.4 }]}
            >
              <Text style={styles.rejectedReapplyBtnText}>
                {canReapplyNow ? t("ambassadors_dashboard.rej_btn_reapply_now") : t("ambassadors_dashboard.rej_btn_unavailable")}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Support fallback (always present) */}
        <Text style={styles.rejectedSupport}>
          Questions?{" "}
          <Text
            style={styles.rejectedSupportLink}
            onPress={() => Linking.openURL("mailto:support@allsale.co.nz").catch(() => {})}
          >
            support@allsale.co.nz
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}


function statusStyle(status: ContentSubmission["status"]) {
  if (status === "verified") return { backgroundColor: colors.successSoft };
  if (status === "rejected") return { backgroundColor: "#FEE2E2" };
  return { backgroundColor: colors.surfaceMuted };
}

/**
 * Pending-state dashboard shown to ambassadors awaiting admin approval.
 * Three sticky tasks: read T&Cs → accept → resend activation email if lost.
 * Suppresses share/withdraw/KPIs/tier widgets because the code isn't live yet.
 */
function PendingDashboard({
  me,
  onChange,
  onBack,
}: {
  me: AmbassadorMe;
  onChange: (m: AmbassadorMe) => void;
  onBack: () => void;
}) {
  const toast = useToast();
  const { t } = useTranslation();
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const [resending, setResending] = useState(false);
  // Local cooldown countdown (seconds remaining). Seeded from a 429
  // response's Retry-After OR a successful response's next_allowed_at.
  const [cooldownSecs, setCooldownSecs] = useState<number>(0);

  // Tick the countdown down once per second when active.
  useEffect(() => {
    if (cooldownSecs <= 0) return;
    const t = setTimeout(() => setCooldownSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldownSecs]);

  const onAcceptTerms = async () => {
    setAcceptingTerms(true);
    try {
      const { acceptTerms, getMe } = await import("@/src/lib/ambassadors");
      await acceptTerms("v1");
      const fresh = await getMe();
      onChange(fresh);
      toast.show({
        title: t("ambassadors_dashboard.pend_terms_accepted_title"),
        body: t("ambassadors_dashboard.pend_terms_accepted_body"),
        kind: "success",
      });
    } catch (e: any) {
      toast.show({ title: t("ambassadors_dashboard.pend_terms_failed"), body: e?.message || "", kind: "error" });
    } finally {
      setAcceptingTerms(false);
    }
  };

  const onResend = async () => {
    setResending(true);
    try {
      const { resendActivation } = await import("@/src/lib/ambassadors");
      const res = await resendActivation();
      const next = res.next_allowed_at ? new Date(res.next_allowed_at) : null;
      if (next) {
        const secs = Math.max(0, Math.ceil((next.getTime() - Date.now()) / 1000));
        setCooldownSecs(secs);
      }
      toast.show({
        title: t("ambassadors_dashboard.pend_resend_sent_title"),
        body: t("ambassadors_dashboard.pend_resend_sent_body"),
        kind: "success",
      });
    } catch (e: any) {
      if (e instanceof ApiError) {
        if (e.status === 429 && e.retryAfter) {
          setCooldownSecs(e.retryAfter);
          toast.show({
            title: t("ambassadors_dashboard.pend_resend_slow_title"),
            body: e.message,
            kind: "info",
          });
        } else if (e.status === 401 || e.status === 403) {
          toast.show({ title: t("ambassadors_dashboard.pend_resend_signin_title"), body: e.message, kind: "error" });
        } else {
          toast.show({ title: t("ambassadors_dashboard.pend_resend_failed_title"), body: e.message, kind: "error" });
        }
      } else {
        toast.show({ title: t("ambassadors_dashboard.pend_resend_failed_title"), body: String(e), kind: "error" });
      }
    } finally {
      setResending(false);
    }
  };

  const mmss = formatMmSs(cooldownSecs);
  const termsAccepted = !!me.terms_accepted_at;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn} testID="amb-pending-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Ambassador</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.pendingScroll}>
        {/* Status hero */}
        <View style={styles.pendingHero} testID="amb-status-pending">
          <View style={styles.pendingPill}><Text style={styles.pendingPillText}>{t("ambassadors_dashboard.pend_in_review")}</Text></View>
          <Text style={styles.pendingHeroTitle}>{t("ambassadors_dashboard.pend_title")}</Text>
          <Text style={styles.pendingHeroSub}>
            {t("ambassadors_dashboard.pend_sub", { name: me.name.split(" ")[0] || t("ambassadors_dashboard.hero_default_name") })}
          </Text>
        </View>

        {/* Code preview (greyed) */}
        <View style={styles.pendingCodeCard}>
          <Text style={styles.pendingCodeLabel}>{t("ambassadors_dashboard.pend_code_label")}</Text>
          <Text style={styles.pendingCodeValue}>{me.code}</Text>
          {me.code_b2b && (
            <>
              <Text style={[styles.pendingCodeLabel, { marginTop: 10 }]}>{t("ambassadors_dashboard.pend_code_b2b_label")}</Text>
              <Text style={styles.pendingCodeValue}>{me.code_b2b}</Text>
            </>
          )}
        </View>

        {/* T&Cs card */}
        <View
          style={[styles.taskCard, termsAccepted && styles.taskCardDone]}
          testID="amb-pending-terms-card"
        >
          <View style={styles.taskRow}>
            <View style={[styles.taskCheckbox, termsAccepted && styles.taskCheckboxDone]}>
              {termsAccepted && <Check size={14} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskTitle}>
                {termsAccepted ? t("ambassadors_dashboard.pend_terms_done") : t("ambassadors_dashboard.pend_terms_pending")}
              </Text>
              <Text style={styles.taskSub}>
                {termsAccepted ? t("ambassadors_dashboard.pend_terms_done_sub", { date: new Date(me.terms_accepted_at!).toLocaleDateString() }) : t("ambassadors_dashboard.pend_terms_pending_sub")}
              </Text>
            </View>
          </View>
          {!termsAccepted && (
            <Pressable
              testID="amb-pending-accept-terms"
              disabled={acceptingTerms}
              onPress={onAcceptTerms}
              style={[styles.taskBtn, acceptingTerms && { opacity: 0.5 }]}
            >
              {acceptingTerms ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.taskBtnText}>{t("ambassadors_dashboard.pend_terms_btn")}</Text>
              )}
            </Pressable>
          )}
        </View>

        {/* Resend activation card */}
        <View style={styles.taskCard} testID="amb-pending-resend-card">
          <View style={styles.taskRow}>
            <View style={styles.taskCheckbox}>
              <Text style={{ fontSize: 16 }}>📨</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskTitle}>{t("ambassadors_dashboard.pend_resend_title")}</Text>
              <Text style={styles.taskSub}>
                {t("ambassadors_dashboard.pend_resend_sub", { email: me.email })}
              </Text>
            </View>
          </View>
          <Pressable
            testID="amb-pending-resend-button"
            disabled={resending || cooldownSecs > 0}
            onPress={onResend}
            style={[
              styles.taskBtn,
              (resending || cooldownSecs > 0) && { opacity: 0.5 },
              { backgroundColor: cooldownSecs > 0 ? colors.surfaceMuted : colors.primary },
            ]}
          >
            {resending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                testID="amb-pending-resend-label"
                style={[styles.taskBtnText, cooldownSecs > 0 && { color: colors.textMuted }]}
              >
                {cooldownSecs > 0 ? t("ambassadors_dashboard.pend_resend_try_again_in", { mmss }) : t("ambassadors_dashboard.pend_resend_btn")}
              </Text>
            )}
          </Pressable>
          {cooldownSecs > 0 && (
            <Text testID="amb-pending-cooldown-hint" style={styles.cooldownHint}>{t("ambassadors_dashboard.pend_resend_rate_limit")}</Text>
          )}
        </View>

        {/* What happens next */}
        <View style={styles.timelineCard}>
          <Text style={styles.timelineTitle}>{t("ambassadors_dashboard.pend_timeline_title")}</Text>
          <TimelineRow num={1} done text={t("ambassadors_dashboard.pend_timeline_1")} />
          <TimelineRow
            num={2}
            done={termsAccepted}
            text={termsAccepted ? t("ambassadors_dashboard.pend_timeline_2_done") : t("ambassadors_dashboard.pend_timeline_2_pending")}
          />
          <TimelineRow num={3} done={false} text={t("ambassadors_dashboard.pend_timeline_3")} />
          <TimelineRow num={4} done={false} text={t("ambassadors_dashboard.pend_timeline_4")} />
        </View>

        <Text style={styles.rejectedSupport}>
          Questions?{" "}
          <Text
            style={styles.rejectedSupportLink}
            onPress={() => Linking.openURL("mailto:support@allsale.co.nz").catch(() => {})}
          >
            support@allsale.co.nz
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function TimelineRow({ num, done, text }: { num: number; done: boolean; text: string }) {
  return (
    <View style={styles.timelineRow}>
      <View style={[styles.timelineNum, done && styles.timelineNumDone]}>
        {done ? (
          <Check size={11} color="#fff" />
        ) : (
          <Text style={styles.timelineNumText}>{num}</Text>
        )}
      </View>
      <Text style={[styles.timelineText, done && styles.timelineTextDone]}>{text}</Text>
    </View>
  );
}

function formatMmSs(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: 4,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroGreeting: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600" },
  heroBig: { color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -0.5 },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  sectionTitle: { fontWeight: "800", color: colors.text, fontSize: 13, letterSpacing: 0.3, textTransform: "uppercase" },
  codeCard: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: 6,
  },
  codeSubtitle: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  codeValue: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: 3 },
  codeActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  codeCopy: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.primary },
  codeCopyText: { color: colors.primary, fontWeight: "800", fontSize: 12 },
  codeShare: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: colors.primary },
  codeShareText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  linkPerfCard: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  linkPerfHeader: { gap: 2 },
  linkPerfTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  linkPerfHint: { fontSize: 11, color: colors.textMuted },
  linkPerfGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  linkPerfFootnote: { fontSize: 11, color: colors.textFaint, paddingTop: 2 },
  kpi: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiValue: { fontSize: 18, fontWeight: "800", color: colors.text },
  kpiLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tierBox: {
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  tierName: { fontWeight: "800", color: colors.text, fontSize: 14 },
  tierRate: { fontWeight: "800", color: colors.primary, fontSize: 18 },
  progressTrack: { height: 8, backgroundColor: colors.surfaceMuted, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 999 },
  tierHint: { color: colors.textMuted, fontSize: 12 },
  withdrawCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  withdrawLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  withdrawAmount: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 2 },
  withdrawBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999 },
  withdrawText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  contentCard: {
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  contentTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  contentSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  contentInput: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 13, color: colors.text },
  contentBtn: { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 999, alignItems: "center", marginTop: 4 },
  contentBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  contentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  contentRowUrl: { flex: 1, color: colors.textMuted, fontSize: 11 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontWeight: "800", fontSize: 10, color: colors.text, textTransform: "capitalize" },
  tabsRow: { flexDirection: "row", backgroundColor: colors.surfaceMuted, borderRadius: 999, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 999 },
  tabBtnActive: { backgroundColor: "#fff" },
  tabText: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  tabTextActive: { color: colors.text },
  empty: { padding: spacing.lg, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  saleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saleId: { fontWeight: "800", color: colors.text, fontSize: 13 },
  saleMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  saleCommission: { fontWeight: "800", color: colors.success, fontSize: 14 },
  saleLocked: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  viewAllBtn: {
    paddingVertical: 12,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  viewAllText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.3,
  },
  // ---- RejectedDashboard ----
  rejectedScroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  rejectedHero: {
    backgroundColor: "#B91C1C",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  rejectedHeroTitle: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  rejectedHeroSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, lineHeight: 19 },
  rejectedReasonCard: {
    backgroundColor: "#FEF3C7",
    borderLeftWidth: 3,
    borderLeftColor: "#D97706",
    padding: spacing.md,
    borderRadius: radius.md,
    gap: 4,
  },
  rejectedReasonLabel: {
    color: "#92400E", fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  rejectedReasonText: { color: "#78350F", fontSize: 14, lineHeight: 20 },
  rejectedReapplyCard: {
    backgroundColor: "#fff",
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    gap: 6,
  },
  rejectedReapplyLabel: {
    color: colors.textMuted, fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  rejectedReapplyDate: { color: colors.text, fontSize: 20, fontWeight: "800" },
  rejectedReapplyHint: { color: colors.textMuted, fontSize: 12 },
  rejectedReapplyBtn: {
    backgroundColor: colors.primary, paddingVertical: 14,
    paddingHorizontal: 28, borderRadius: 999, marginTop: spacing.sm,
  },
  rejectedReapplyBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  rejectedSupport: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
  rejectedSupportLink: { color: colors.primary, fontWeight: "800" },
  // ---- PendingDashboard ----
  pendingScroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  pendingHero: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 8,
  },
  pendingPill: {
    alignSelf: "flex-start",
    backgroundColor: "#FED7AA",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pendingPillText: { color: "#9A3412", fontWeight: "800", fontSize: 11 },
  pendingHeroTitle: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  pendingHeroSub: { color: "#78350F", fontSize: 13, lineHeight: 19 },
  pendingCodeCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  pendingCodeLabel: {
    color: colors.textMuted, fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.8,
  },
  pendingCodeValue: {
    color: colors.textFaint, fontSize: 26, fontWeight: "800", letterSpacing: 3, marginTop: 4,
  },
  taskCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  taskCardDone: { backgroundColor: colors.successSoft, borderColor: colors.success },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  taskCheckbox: {
    width: 28, height: 28, borderRadius: 999,
    borderWidth: 2, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff",
  },
  taskCheckboxDone: { backgroundColor: colors.success, borderColor: colors.success },
  taskTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  taskSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  taskBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  taskBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  cooldownHint: { color: colors.textFaint, fontSize: 11, textAlign: "center" },
  timelineCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  timelineTitle: {
    fontWeight: "800", color: colors.text, fontSize: 13,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
  },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timelineNum: {
    width: 22, height: 22, borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center", justifyContent: "center",
  },
  timelineNumDone: { backgroundColor: colors.success },
  timelineNumText: { color: colors.textMuted, fontWeight: "800", fontSize: 11 },
  timelineText: { color: colors.textMuted, fontSize: 13, flex: 1 },
  timelineTextDone: { color: colors.text, fontWeight: "600" },
  label: {
    fontWeight: "700",
    color: colors.text,
    fontSize: 12,
    marginTop: spacing.xs,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
  },
  platformWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  platformChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  platformChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  platformChipText: { fontSize: 12, color: colors.text, fontWeight: "600" },
  platformChipTextActive: { color: colors.primary, fontWeight: "800" },
  submitBtn: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999, alignItems: "center", marginTop: spacing.sm },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
