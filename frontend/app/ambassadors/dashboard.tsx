import { useRouter } from "expo-router";
import {
  Camera,
  ChevronLeft,
  Copy,
  Share2,
  Sparkles,
  Wallet,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import {
  AmbassadorMe,
  ContentSubmission,
  formatMoney,
  getMe,
  listContent,
  listReferredSellers,
  listSales,
  ReferredSellerRow,
  requestWithdraw,
  SaleRow,
  submitContent,
} from "@/src/lib/ambassadors";
import { colors, radius, spacing } from "@/src/lib/theme";

type Tab = "sales" | "sellers" | "profile";

export default function AmbassadorDashboard() {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<AmbassadorMe | null>(null);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sellers, setSellers] = useState<ReferredSellerRow[]>([]);
  const [content, setContent] = useState<ContentSubmission[]>([]);
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
      const [s, sl, c] = await Promise.all([
        listSales(20),
        m.program === "B2B" || m.program === "BOTH"
          ? listReferredSellers()
          : Promise.resolve<ReferredSellerRow[]>([]),
        listContent(),
      ]);
      setSales(s);
      setSellers(sl);
      setContent(c);
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
      toast.show({ title: "Code copied!", body: `${code} is ready to paste.`, kind: "success" });
    } catch {
      toast.show({ title: "Your code", body: code, kind: "success" });
    }
  };

  const onShareCode = async (code: string, suffix: string) => {
    try {
      await Share.share({
        message: `Use my code ${code} on Allsale for ${suffix}! https://allsale.co.nz/?ref=${code}`,
      });
    } catch (e: any) {
      toast.show({ title: "Couldn't share", body: e?.message || "Try again.", kind: "error" });
    }
  };

  const onSubmitPost = async () => {
    const url = postUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      toast.show({ title: "Paste a full https:// link", kind: "error" });
      return;
    }
    setPosting(true);
    try {
      const item = await submitContent(url);
      setContent((prev) => [item, ...prev]);
      setPostUrl("");
      toast.show({ title: "Post submitted ✓", body: "We'll verify it shortly.", kind: "success" });
      // Refresh `me` so the posts-this-month counter ticks up.
      const fresh = await getMe();
      setMe(fresh);
    } catch (e: any) {
      toast.show({ title: "Submission failed", body: e?.message || "Try again.", kind: "error" });
    } finally {
      setPosting(false);
    }
  };

  const onWithdraw = async () => {
    setWithdrawing(true);
    try {
      const res = await requestWithdraw();
      if (res.status === "blocked") {
        toast.show({ title: "Withdrawal blocked", body: res.reason || "", kind: "info" });
      } else {
        toast.show({
          title: "Payout queued 🏦",
          body: `${formatMoney(res.requested_amount, res.currency)} — you'll receive it within a few business days.`,
          kind: "success",
        });
        const fresh = await getMe();
        setMe(fresh);
      }
    } catch (e: any) {
      toast.show({ title: "Couldn't withdraw", body: e?.message || "", kind: "error" });
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
        <Text style={styles.headerTitle}>Ambassador</Text>
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
          <Text style={styles.heroGreeting}>Hi {me.name.split(" ")[0] || "there"} 👋</Text>
          <Text style={styles.heroBig}>
            {formatMoney(me.lifetime_commission, me.payout_currency)}
          </Text>
          <Text style={styles.heroLabel}>Lifetime earnings</Text>
        </View>

        {/* Share code cards */}
        <Text style={styles.sectionTitle}>Your code{me.code_b2b ? "s" : ""}</Text>
        <CodeCard
          code={me.code}
          subtitle={`Customer code · 5% off for shoppers`}
          onCopy={() => onCopyCode(me.code)}
          onShare={() => onShareCode(me.code, "5% off your first order")}
          testIDPrefix="amb-code-b2c"
        />
        {me.code_b2b && (
          <CodeCard
            code={me.code_b2b}
            subtitle="Seller-recruit code · Refer Indian businesses"
            onCopy={() => onCopyCode(me.code_b2b!)}
            onShare={() => onShareCode(me.code_b2b!, "3 months Pro free when you join as a seller")}
            testIDPrefix="amb-code-b2b"
          />
        )}

        {/* KPI tiles */}
        <View style={styles.kpiGrid}>
          <Kpi
            label="Available"
            value={formatMoney(me.unpaid_balance, me.payout_currency)}
            color={colors.success}
          />
          <Kpi
            label="Pending"
            value={formatMoney(me.pending_commission, me.payout_currency)}
            color={colors.textMuted}
          />
          <Kpi label="Orders / 30d" value={String(me.orders_30d)} />
          <Kpi
            label="Posts / mo"
            value={`${me.posts_this_month}/${me.posts_required}`}
            color={me.posts_this_month >= me.posts_required ? colors.success : colors.textMuted}
          />
        </View>

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
                {Math.max(0, tierTo - me.orders_30d)} more orders to {me.next_tier.label} ({me.next_tier.rate_pct}%)
              </Text>
            </>
          ) : (
            <Text style={styles.tierHint}>🏆 Top tier — you&apos;ve maxed out!</Text>
          )}
        </View>

        {/* Withdraw card */}
        <View style={styles.withdrawCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.withdrawLabel}>Available to withdraw</Text>
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
            <Text style={styles.withdrawText}>Withdraw</Text>
          </Pressable>
        </View>

        {/* Submit-content card */}
        <View style={styles.contentCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Camera size={16} color={colors.primary} />
            <Text style={styles.contentTitle}>Log a post</Text>
          </View>
          <Text style={styles.contentSub}>
            Paste any social post URL where you tagged Allsale.
            We need {me.posts_required}/mo to keep your tier active.
          </Text>
          <TextInput
            testID="amb-post-url"
            style={styles.contentInput}
            value={postUrl}
            onChangeText={setPostUrl}
            placeholder="https://instagram.com/p/..."
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
              <Text style={styles.contentBtnText}>Submit post</Text>
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
          <TabBtn label="Sales" active={tab === "sales"} onPress={() => setTab("sales")} />
          {(me.program === "B2B" || me.program === "BOTH") && (
            <TabBtn
              label="Sellers"
              active={tab === "sellers"}
              onPress={() => setTab("sellers")}
            />
          )}
          <TabBtn label="Profile" active={tab === "profile"} onPress={() => setTab("profile")} />
        </View>

        {tab === "sales" && (
          <View style={{ gap: spacing.xs }}>
            {sales.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No sales yet. Share your code to start earning!</Text>
              </View>
            ) : (
              sales.map((s) => (
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
                      {s.locked_at && new Date(s.locked_at) <= new Date() ? "available" : "on hold"}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {tab === "sellers" && (
          <View style={{ gap: spacing.xs }}>
            {sellers.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  No referred sellers yet. Share your business code with founders you know.
                </Text>
              </View>
            ) : (
              sellers.map((s) => (
                <View key={s.seller_id} style={styles.saleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.saleId}>{s.seller_name}</Text>
                    <Text style={styles.saleMeta}>
                      {s.orders_to_date} orders · {s.months_since_onboard}mo old
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.saleCommission}>
                      ₹{s.earnings_to_date_inr.toLocaleString("en-IN")}
                    </Text>
                    <Text style={styles.saleLocked}>
                      {s.bounty_paid ? "bounty paid" : "bounty pending"}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {tab === "profile" && <ProfileEditor me={me} onSaved={(m) => setMe(m)} />}
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

function TabBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`amb-tab-${label.toLowerCase()}`}
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
          <Text style={styles.codeCopyText}>Copy</Text>
        </Pressable>
        <Pressable testID={`${testIDPrefix}-share`} onPress={onShare} style={styles.codeShare}>
          <Share2 size={14} color="#fff" />
          <Text style={styles.codeShareText}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ProfileEditor({ me, onSaved }: { me: AmbassadorMe; onSaved: (m: AmbassadorMe) => void }) {
  const toast = useToast();
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
      toast.show({ title: "Profile saved ✓", kind: "success" });
    } catch (e: any) {
      toast.show({ title: "Couldn't save", body: e?.message || "", kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.label}>Social handle</Text>
      <TextInput
        testID="amb-edit-handle"
        style={styles.input}
        value={handle}
        onChangeText={setHandle}
        placeholder="@sarahjenkins"
        autoCapitalize="none"
        placeholderTextColor={colors.textFaint}
      />

      <Text style={styles.label}>Phone</Text>
      <TextInput
        testID="amb-edit-phone"
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="+64 21 555 1234"
        keyboardType="phone-pad"
        placeholderTextColor={colors.textFaint}
      />

      <Text style={styles.label}>Audience size</Text>
      <TextInput
        testID="amb-edit-audience"
        style={styles.input}
        value={audience}
        onChangeText={setAudience}
        placeholder="14500"
        keyboardType="number-pad"
        placeholderTextColor={colors.textFaint}
      />

      <Text style={styles.label}>Payout currency</Text>
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
        <Text style={{ color: colors.textFaint, fontSize: 11 }}>
          India is INR-only (Razorpay).
        </Text>
      )}

      <Pressable
        testID="amb-edit-save"
        disabled={saving}
        onPress={onSave}
        style={[styles.submitBtn, saving && { opacity: 0.6 }]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save changes</Text>}
      </Pressable>
    </View>
  );
}

function statusStyle(status: ContentSubmission["status"]) {
  if (status === "verified") return { backgroundColor: colors.successSoft };
  if (status === "rejected") return { backgroundColor: "#FEE2E2" };
  return { backgroundColor: colors.surfaceMuted };
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
