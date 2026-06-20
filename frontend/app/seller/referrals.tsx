import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  CheckCircle2,
  ChevronLeft,
  Copy,
  Mail,
  PiggyBank,
  Share2,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Referral = {
  id: string;
  referee_email: string;
  status: "pending" | "signed_up" | "approved" | "first_sale" | "paid_out" | "expired";
  invited_at: string;
  signed_up_at?: string | null;
  first_sale_at?: string | null;
  commission_due_nzd: number;
  commission_paid_nzd: number;
  referee_gmv_nzd: number;
};

type Stats = {
  code?: string | null;
  total_invited: number;
  total_signed_up: number;
  total_approved: number;
  total_first_sale: number;
  total_commission_due_nzd: number;
  total_commission_paid_nzd: number;
  invite_url?: string | null;
};

type Page = { stats: Stats; referrals: Referral[] };

const STATUS_STYLES: Record<Referral["status"], { labelKey: string; bg: string; fg: string }> = {
  pending: { labelKey: "seller_referrals.status_pending", bg: "#FFF7ED", fg: "#9A3412" },
  signed_up: { labelKey: "seller_referrals.status_signed_up", bg: "#EFF6FF", fg: "#1E40AF" },
  approved: { labelKey: "seller_referrals.status_approved", bg: "#F3E8FF", fg: "#6B21A8" },
  first_sale: { labelKey: "seller_referrals.status_first_sale", bg: "#ECFDF5", fg: "#065F46" },
  paid_out: { labelKey: "seller_referrals.status_paid_out", bg: "#F1F5F9", fg: "#475569" },
  expired: { labelKey: "seller_referrals.status_expired", bg: "#FEF2F2", fg: "#991B1B" },
};

function maskEmail(e: string): string {
  if (!e || !e.includes("@")) return e;
  const [local, domain] = e.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}***@${domain}`;
}

function relativeDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export default function ReferralsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api<Page>("/seller/me/referrals");
      setPage(p);
    } catch (e: any) {
      toast.show({ title: t("seller_referrals.couldnt_load"), message: e?.message || "", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const copyCode = useCallback(async () => {
    if (!page?.stats?.code) return;
    await Clipboard.setStringAsync(page.stats.code);
    toast.show({ title: t("seller_referrals.code_copied"), kind: "success" });
  }, [page, toast, t]);

  const shareLink = useCallback(async () => {
    if (!page?.stats?.invite_url) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(page.stats.invite_url, {
          dialogTitle: t("seller_referrals.share_dialog_title"),
        });
      } else {
        await Clipboard.setStringAsync(page.stats.invite_url);
        toast.show({ title: t("seller_referrals.link_copied"), kind: "success" });
      }
    } catch {
      // Silent — user likely cancelled the share sheet
    }
  }, [page, toast, t]);

  const sendInvite = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      toast.show({ title: t("seller_referrals.invalid_email"), kind: "error" });
      return;
    }
    setSending(true);
    try {
      const fresh = await api<Referral>("/seller/me/referrals/invite", {
        method: "POST",
        body: {
          referee_email: trimmed.toLowerCase(),
          referee_name: name.trim() || undefined,
          note: note.trim() || undefined,
        },
      });
      toast.show({
        title: t("seller_referrals.invite_sent_title"),
        message: t("seller_referrals.invite_sent_body", { email: trimmed }),
        kind: "success",
      });
      setEmail("");
      setName("");
      setNote("");
      // Optimistic prepend (it might already be deduped server-side)
      setPage((p) =>
        p
          ? {
              ...p,
              stats: { ...p.stats, total_invited: p.stats.total_invited + (p.referrals.find(r => r.id === fresh.id) ? 0 : 1) },
              referrals: p.referrals.find((r) => r.id === fresh.id)
                ? p.referrals
                : [fresh, ...p.referrals],
            }
          : p,
      );
    } catch (e: any) {
      toast.show({ title: t("seller_referrals.couldnt_send"), message: e?.message || "", kind: "error" });
    } finally {
      setSending(false);
    }
  }, [email, name, note, toast, t]);

  if (loading || !page) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const { stats, referrals } = page;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>{t("seller_referrals.title")}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero card */}
          <View style={styles.hero}>
            <View style={styles.heroBadge}>
              <Sparkles size={12} color={colors.primary} />
              <Text style={styles.heroBadgeText}>{t("seller_referrals.hero_badge")}</Text>
            </View>
            <Text style={styles.heroTitle}>{t("seller_referrals.hero_title")}</Text>
            <Text style={styles.heroSub}>
              {t("seller_referrals.hero_sub")}
            </Text>

            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>{t("seller_referrals.your_code_label")}</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeValue} numberOfLines={1} testID="referrals-code">
                  {stats.code || "—"}
                </Text>
                <Pressable
                  onPress={copyCode}
                  style={styles.codeIconBtn}
                  hitSlop={6}
                  testID="referrals-copy-code"
                >
                  <Copy size={14} color={colors.primary} />
                </Pressable>
              </View>
              <Pressable
                onPress={shareLink}
                style={styles.shareBtn}
                testID="referrals-share"
              >
                <Share2 size={14} color="#fff" />
                <Text style={styles.shareBtnText}>{t("seller_referrals.share_invite_btn")}</Text>
              </Pressable>
            </View>
          </View>

          {/* Stats grid */}
          <View style={styles.statsGrid}>
            <StatCard
              icon={<UserPlus size={16} color={colors.primary} />}
              value={stats.total_invited}
              label={t("seller_referrals.stat_invited")}
            />
            <StatCard
              icon={<Users size={16} color={colors.accent} />}
              value={stats.total_signed_up}
              label={t("seller_referrals.stat_signed_up")}
            />
            <StatCard
              icon={<CheckCircle2 size={16} color={colors.success} />}
              value={stats.total_first_sale}
              label={t("seller_referrals.stat_first_sale")}
            />
            <StatCard
              icon={<PiggyBank size={16} color={colors.primary} />}
              value={formatNZD(stats.total_commission_due_nzd)}
              label={t("seller_referrals.stat_earned")}
            />
          </View>

          {/* Invite form */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("seller_referrals.invite_section")}</Text>
            <View style={styles.inputRow}>
              <Mail size={14} color={colors.textMuted} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t("seller_referrals.placeholder_email")}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                autoCapitalize="none"
                keyboardType="email-address"
                testID="referrals-invite-email"
              />
            </View>
            <View style={styles.inputRow}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("seller_referrals.placeholder_name")}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                maxLength={120}
                testID="referrals-invite-name"
              />
            </View>
            <View style={[styles.inputRow, { alignItems: "flex-start" }]}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t("seller_referrals.placeholder_note")}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { minHeight: 60 }]}
                multiline
                maxLength={500}
                testID="referrals-invite-note"
              />
            </View>
            <Pressable
              onPress={sendInvite}
              disabled={sending || !email.trim()}
              style={[
                styles.submit,
                (sending || !email.trim()) && { opacity: 0.5 },
              ]}
              testID="referrals-invite-submit"
            >
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>{t("seller_referrals.send_invite_btn")}</Text>
              )}
            </Pressable>
          </View>

          {/* Referrals list */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("seller_referrals.your_referrals")}</Text>
            {referrals.length === 0 ? (
              <View style={styles.empty}>
                <TrendingUp size={28} color={colors.textFaint} />
                <Text style={styles.emptyTitle}>{t("seller_referrals.no_referrals_title")}</Text>
                <Text style={styles.emptySub}>
                  {t("seller_referrals.no_referrals_sub")}
                </Text>
              </View>
            ) : (
              referrals.map((r) => {
                const st = STATUS_STYLES[r.status] || STATUS_STYLES.pending;
                return (
                  <View key={r.id} style={styles.refRow} testID={`referral-row-${r.id}`}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.refEmail} numberOfLines={1}>
                        {maskEmail(r.referee_email)}
                      </Text>
                      <Text style={styles.refMeta}>
                        {t("seller_referrals.invited_on", { date: relativeDate(r.invited_at) })}
                        {r.first_sale_at ? t("seller_referrals.first_sale_on", { date: relativeDate(r.first_sale_at) }) : ""}
                      </Text>
                      {r.commission_due_nzd > 0 ? (
                        <Text style={styles.refCommission}>
                          {t("seller_referrals.earned_amount", { amount: formatNZD(r.commission_due_nzd) })}
                          {r.commission_paid_nzd > 0 ? t("seller_referrals.paid_out_amount", { amount: formatNZD(r.commission_paid_nzd) }) : ""}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={[styles.statusPill, { backgroundColor: st.bg }]}
                    >
                      <Text style={[styles.statusPillText, { color: st.fg }]}>
                        {t(st.labelKey)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* How it works */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={styles.sectionTitle}>{t("seller_referrals.how_section")}</Text>
            <HowItWorksRow n="1" text={t("seller_referrals.how1")} />
            <HowItWorksRow n="2" text={t("seller_referrals.how2")} />
            <HowItWorksRow n="3" text={t("seller_referrals.how3")} />
            <HowItWorksRow n="4" text={t("seller_referrals.how4")} />
          </View>
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HowItWorksRow({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.hiwRow}>
      <View style={styles.hiwBullet}>
        <Text style={styles.hiwBulletText}>{n}</Text>
      </View>
      <Text style={styles.hiwText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "800", color: colors.text },

  scroll: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  hero: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    gap: 8,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  heroBadgeText: { color: colors.primary, fontWeight: "800", fontSize: 11, letterSpacing: 0.3 },
  heroTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 6, letterSpacing: -0.3 },
  heroSub: { color: "rgba(255,255,255,0.92)", fontSize: 13, lineHeight: 18 },

  codeCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  codeLabel: { color: "rgba(255,255,255,0.88)", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  codeValue: { flex: 1, color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: 1, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  codeIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shareBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  shareBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statCard: {
    flexBasis: "47%",
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 4,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { fontSize: 18, fontWeight: "800", color: colors.text, marginTop: 2 },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700" },

  section: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontSize: 14, color: colors.text },
  submit: {
    marginTop: 4,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  refRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  refEmail: { fontSize: 13, fontWeight: "700", color: colors.text },
  refMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  refCommission: { fontSize: 12, color: colors.success, fontWeight: "700", marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },

  empty: { alignItems: "center", paddingVertical: spacing.lg, gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.md },

  hiwRow: { flexDirection: "row", gap: 10, paddingVertical: 6, alignItems: "flex-start" },
  hiwBullet: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  hiwBulletText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  hiwText: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 18 },
});
