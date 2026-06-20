import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ExternalLink,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { adminApi, AdminForbidden, AdminUnauthorized } from "@/src/lib/adminApi";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

type Row = {
  id: string;
  name: string;
  email: string;
  code: string;
  code_b2b: string | null;
  country: string;
  payout_currency: string;
  program: "B2C" | "B2B" | "BOTH";
  status: "active" | "dormant" | "suspended" | "forfeited";
  tier_key: string;
  unpaid_balance: number;
  lifetime_commission: number;
  lifetime_orders: number;
  referred_sellers_count: number;
  joined_at: string;
};

type ContentItem = {
  id: string;
  submitted_at: string;
  post_url: string;
  platform: string;
  status: "pending" | "verified" | "rejected";
  reject_reason: string | null;
  has_required_tag: boolean;
};

export default function AdminAmbassadorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();
  const [amb, setAmb] = useState<Row | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      // Backend has no GET-by-id yet, so re-use the list endpoint with a
      // tight filter. Cheap given typical scale (< few hundred ambassadors).
      const [rows, items] = await Promise.all([
        adminApi<Row[]>(`/admin/ambassadors?limit=500`),
        adminApi<ContentItem[]>(`/admin/ambassadors/${id}/content?limit=50`),
      ]);
      const match = rows.find((r) => r.id === id);
      if (!match) {
        toast.show({ title: t("admin_ambassador_detail.not_found"), kind: "error" });
        router.back();
        return;
      }
      setAmb(match);
      setContent(items);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized || e instanceof AdminForbidden) {
        toast.show({ title: t("admin_ambassador_detail.admin_required"), kind: "error" });
        router.replace("/admin");
        return;
      }
      toast.show({ title: t("admin_ambassador_detail.couldnt_load"), body: e?.message, kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [id, router, toast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  const onMarkPaid = async () => {
    if (!amb || amb.unpaid_balance <= 0) return;
    setBusy("pay");
    try {
      const res = await adminApi<{ ok: boolean; paid_amount: number; currency: string }>(
        `/admin/ambassadors/${amb.id}/mark-paid`,
        { method: "POST" },
      );
      toast.show({
        title: t("admin_ambassador_detail.mark_paid_done"),
        body: t("admin_ambassador_detail.mark_paid_done_body", { currency: res.currency, amount: res.paid_amount.toFixed(2) }),
        kind: "success",
      });
      await load();
    } catch (e: any) {
      toast.show({ title: t("admin_ambassador_detail.mark_paid_failed"), body: e?.message, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const onSuspend = async () => {
    if (!amb) return;
    if (suspendReason.trim().length < 4) {
      toast.show({ title: t("admin_ambassador_detail.reason_too_short"), kind: "error" });
      return;
    }
    setBusy("sus");
    try {
      await adminApi(
        `/admin/ambassadors/${amb.id}/suspend?reason=${encodeURIComponent(suspendReason.trim())}`,
        { method: "POST" },
      );
      toast.show({ title: t("admin_ambassador_detail.suspended_done"), kind: "success" });
      setSuspendReason("");
      await load();
    } catch (e: any) {
      toast.show({ title: t("admin_ambassador_detail.suspend_failed"), body: e?.message, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const onUnsuspend = async () => {
    if (!amb) return;
    setBusy("unsus");
    try {
      await adminApi(`/admin/ambassadors/${amb.id}/unsuspend`, { method: "POST" });
      toast.show({ title: t("admin_ambassador_detail.reactivated"), kind: "success" });
      await load();
    } catch (e: any) {
      toast.show({ title: t("admin_ambassador_detail.unsuspend_failed"), body: e?.message, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  const reviewContent = async (contentId: string, action: "verify" | "reject") => {
    if (!amb) return;
    let reason: string | undefined;
    if (action === "reject") {
      reason = await new Promise<string | undefined>((resolve) => {
        Alert.prompt?.(
          t("admin_ambassador_detail.reject_reason_title"),
          t("admin_ambassador_detail.reject_reason_body"),
          [
            { text: t("admin_ambassador_detail.cancel_btn"), style: "cancel", onPress: () => resolve(undefined) },
            { text: t("admin_ambassador_detail.reject_btn"), onPress: (v) => resolve(v || t("admin_ambassador_detail.reject_default_reason")) },
          ],
          "plain-text",
        );
        if (!Alert.prompt) resolve(t("admin_ambassador_detail.reject_default_reason"));
      });
      if (reason === undefined) return;
    }
    setBusy(`content_${contentId}`);
    try {
      const qs = `action=${action}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`;
      await adminApi(
        `/admin/ambassadors/${amb.id}/content/${contentId}/review?${qs}`,
        { method: "POST" },
      );
      toast.show({ title: action === "verify" ? t("admin_ambassador_detail.approved_done") : t("admin_ambassador_detail.rejected_done"), kind: "success" });
      setContent((prev) =>
        prev.map((c) =>
          c.id === contentId
            ? {
                ...c,
                status: action === "verify" ? "verified" : "rejected",
                reject_reason: reason || null,
                has_required_tag: action === "verify",
              }
            : c
        )
      );
    } catch (e: any) {
      toast.show({ title: t("admin_ambassador_detail.review_failed"), body: e?.message, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (loading || !amb) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const pending = content.filter((c) => c.status === "pending");
  const reviewed = content.filter((c) => c.status !== "pending");
  const isSuspended = amb.status === "suspended";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{amb.name || amb.email}</Text>
        <Pressable onPress={onRefresh} style={styles.backBtn}>
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Identity card */}
        <View style={styles.identityCard}>
          <Text style={styles.identityName}>{amb.name}</Text>
          <Text style={styles.identityEmail}>{amb.email}</Text>
          <View style={styles.identityRowChips}>
            <View style={styles.identityChip}><Text style={styles.identityChipText}>{amb.country}</Text></View>
            <View style={styles.identityChip}><Text style={styles.identityChipText}>{amb.program}</Text></View>
            <View style={[styles.identityChip, isSuspended && { backgroundColor: "#FEE2E2" }]}>
              <Text style={styles.identityChipText}>{amb.status}</Text>
            </View>
            <View style={styles.identityChip}><Text style={styles.identityChipText}>{amb.tier_key}</Text></View>
          </View>
        </View>

        {/* Codes */}
        <View style={styles.codesCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.codeLabel}>B2C code</Text>
            <Text style={styles.codeValue}>{amb.code}</Text>
          </View>
          {amb.code_b2b && (
            <View style={{ flex: 1 }}>
              <Text style={styles.codeLabel}>B2B code</Text>
              <Text style={styles.codeValue}>{amb.code_b2b}</Text>
            </View>
          )}
        </View>

        {/* KPIs */}
        <View style={styles.kpiGrid}>
          <Kpi label="Unpaid" value={`${amb.payout_currency} ${amb.unpaid_balance.toFixed(2)}`} accent />
          <Kpi label="Lifetime" value={`${amb.payout_currency} ${amb.lifetime_commission.toFixed(2)}`} />
          <Kpi label="Orders" value={String(amb.lifetime_orders)} />
          <Kpi label="Sellers" value={String(amb.referred_sellers_count)} />
        </View>

        {/* Actions */}
        <Text style={styles.sectionTitle}>Actions</Text>
        <Pressable
          testID="admin-amb-mark-paid"
          disabled={amb.unpaid_balance <= 0 || busy === "pay"}
          onPress={onMarkPaid}
          style={[styles.payBtn, (amb.unpaid_balance <= 0 || busy === "pay") && { opacity: 0.5 }]}
        >
          <Wallet size={16} color="#fff" />
          <Text style={styles.payBtnText}>
            {busy === "pay"
              ? "Processing…"
              : amb.unpaid_balance > 0
                ? `Mark ${amb.payout_currency} ${amb.unpaid_balance.toFixed(2)} paid`
                : "No balance to pay"}
          </Text>
        </Pressable>

        {isSuspended ? (
          <Pressable
            testID="admin-amb-unsuspend"
            disabled={busy === "unsus"}
            onPress={onUnsuspend}
            style={[styles.unsuspendBtn, busy === "unsus" && { opacity: 0.5 }]}
          >
            <Check size={16} color="#fff" />
            <Text style={styles.payBtnText}>Reactivate ambassador</Text>
          </Pressable>
        ) : (
          <View style={styles.suspendCard}>
            <TextInput
              testID="admin-amb-suspend-reason"
              style={styles.suspendInput}
              value={suspendReason}
              onChangeText={setSuspendReason}
              placeholder="Reason (min 4 chars)…"
              placeholderTextColor={colors.textFaint}
            />
            <Pressable
              testID="admin-amb-suspend"
              disabled={busy === "sus" || suspendReason.trim().length < 4}
              onPress={onSuspend}
              style={[styles.suspendBtn, (busy === "sus" || suspendReason.trim().length < 4) && { opacity: 0.4 }]}
            >
              <AlertTriangle size={14} color="#fff" />
              <Text style={styles.payBtnText}>Suspend</Text>
            </Pressable>
          </View>
        )}

        {/* Content moderation */}
        <Text style={styles.sectionTitle}>
          Pending content {pending.length > 0 && `(${pending.length})`}
        </Text>
        {pending.length === 0 ? (
          <Text style={styles.emptyInline}>No pending submissions.</Text>
        ) : (
          pending.map((c) => (
            <ContentRow
              key={c.id}
              item={c}
              busy={busy === `content_${c.id}`}
              onReview={(action) => reviewContent(c.id, action)}
            />
          ))
        )}

        {reviewed.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Reviewed ({reviewed.length})</Text>
            {reviewed.slice(0, 10).map((c) => (
              <ContentRow key={c.id} item={c} busy={false} onReview={() => {}} readOnly />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.kpi, accent && styles.kpiAccent]}>
      <Text style={[styles.kpiValue, accent && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function ContentRow({
  item,
  busy,
  onReview,
  readOnly = false,
}: {
  item: ContentItem;
  busy: boolean;
  onReview: (action: "verify" | "reject") => void;
  readOnly?: boolean;
}) {
  return (
    <View style={styles.contentRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Pressable onPress={() => Linking.openURL(item.post_url).catch(() => {})}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <ExternalLink size={12} color={colors.primary} />
            <Text style={styles.contentUrl} numberOfLines={1}>
              {item.post_url}
            </Text>
          </View>
        </Pressable>
        <Text style={styles.contentMeta}>
          {item.platform} · {new Date(item.submitted_at).toLocaleDateString()}
          {item.reject_reason && `  · “${item.reject_reason}”`}
        </Text>
      </View>
      {readOnly ? (
        <View style={[styles.statusPill, statusPillColor(item.status)]}>
          <Text style={styles.statusPillText}>{item.status}</Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable
            testID={`admin-amb-content-${item.id}-reject`}
            disabled={busy}
            onPress={() => onReview("reject")}
            style={[styles.contentBtnReject, busy && { opacity: 0.5 }]}
          >
            <X size={14} color="#fff" />
          </Pressable>
          <Pressable
            testID={`admin-amb-content-${item.id}-verify`}
            disabled={busy}
            onPress={() => onReview("verify")}
            style={[styles.contentBtnApprove, busy && { opacity: 0.5 }]}
          >
            <Check size={14} color="#fff" />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function statusPillColor(status: ContentItem["status"]) {
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
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl * 2 },
  identityCard: { backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 4 },
  identityName: { fontWeight: "800", color: colors.text, fontSize: 18 },
  identityEmail: { color: colors.textMuted, fontSize: 12 },
  identityRowChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  identityChip: { backgroundColor: colors.surfaceMuted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  identityChipText: { fontSize: 10, color: colors.text, fontWeight: "800", textTransform: "uppercase" },
  codesCard: { flexDirection: "row", backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  codeLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  codeValue: { color: colors.text, fontWeight: "800", fontSize: 18, letterSpacing: 2, marginTop: 2 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kpi: { flexBasis: "48%", flexGrow: 1, backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  kpiAccent: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  kpiValue: { fontSize: 16, fontWeight: "800", color: colors.text },
  kpiLabel: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  sectionTitle: { fontWeight: "800", color: colors.text, fontSize: 13, marginTop: spacing.md, letterSpacing: 0.5, textTransform: "uppercase" },
  payBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999 },
  payBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  unsuspendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.success, paddingVertical: 14, borderRadius: 999 },
  suspendCard: { backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  suspendInput: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 13, color: colors.text },
  suspendBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#DC2626", paddingVertical: 12, borderRadius: 999 },
  contentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  contentUrl: { color: colors.primary, fontSize: 12, fontWeight: "600", flex: 1 },
  contentMeta: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  contentBtnReject: { width: 36, height: 36, borderRadius: 999, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  contentBtnApprove: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 10, color: colors.text, fontWeight: "800", textTransform: "uppercase" },
  emptyInline: { color: colors.textMuted, fontSize: 12, padding: spacing.md, textAlign: "center" },
});
