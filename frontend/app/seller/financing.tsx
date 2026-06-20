import * as Linking from "expo-linking";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useFocusEffect, useRouter } from "expo-router";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  HandCoins,
  Info,
  Landmark,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Partner = {
  id: string;
  name: string;
  tagline: string;
  website: string;
  advance_pct_min: number;
  advance_pct_max: number;
  fee_pct_min: number;
  fee_pct_max: number;
  min_monthly_invoices_inr: number;
  min_business_age_months: number;
  turnaround_hours: number;
  best_for: string[];
};

type PartnersResp = {
  tier: string;
  tier_label: string;
  eligibility: { eligible: boolean; reason: string };
  disclaimer: string;
  partners: Partner[];
};

type Application = {
  id: string;
  partner_id: string;
  partner_name: string;
  desired_advance_nzd: number;
  status: string;
  created_at: string;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  interest: { bg: "#FEF3C7", fg: "#92400E" },
  submitted_to_partner: { bg: "#DBEAFE", fg: "#1E3A8A" },
  approved: { bg: "#D1FAE5", fg: "#065F46" },
  rejected: { bg: "#FEE2E2", fg: "#991B1B" },
  withdrawn: { bg: "#E5E7EB", fg: "#374151" },
};

const STATUS_LABEL_KEY: Record<string, string> = {
  interest: "seller_financing.status_interest",
  submitted_to_partner: "seller_financing.status_submitted",
  approved: "seller_financing.status_approved",
  rejected: "seller_financing.status_rejected",
  withdrawn: "seller_financing.status_withdrawn",
};

export default function FinancingScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = useState<PartnersResp | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  // Apply modal state
  const [selected, setSelected] = useState<Partner | null>(null);
  const [advance, setAdvance] = useState("");
  const [monthly, setMonthly] = useState("");
  const [ageMonths, setAgeMonths] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api<PartnersResp>("/financing/partners"),
        api<Application[]>("/financing/applications"),
      ]);
      setData(p);
      setApps(a);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openApply = (p: Partner) => {
    if (!data?.eligibility.eligible) {
      toast.show({ title: t("seller_financing.not_eligible_toast"), body: data?.eligibility.reason || t("seller_financing.not_eligible_fallback"), kind: "success" });
      return;
    }
    setSelected(p);
    setAdvance("");
    setMonthly("");
    setAgeMonths("");
    setNotes("");
  };

  const submit = useCallback(async () => {
    if (!selected) return;
    const amount = parseFloat(advance);
    if (!amount || amount < 100) {
      toast.show({ title: t("seller_financing.enter_advance_title"), body: t("seller_financing.enter_advance_body"), kind: "success" });
      return;
    }
    setSubmitting(true);
    try {
      await api("/financing/apply", {
        method: "POST",
        body: {
          partner_id: selected.id,
          desired_advance_nzd: amount,
          monthly_invoices_inr: monthly ? parseFloat(monthly) : undefined,
          business_age_months: ageMonths ? parseInt(ageMonths, 10) : undefined,
          notes: notes.trim() || undefined,
        },
      });
      setSelected(null);
      await load();
      toast.show({
        title: t("seller_financing.interest_noted_title"),
        body: t("seller_financing.interest_noted_body", { name: selected.name, hours: selected.turnaround_hours }),
        kind: "success",
      });
    } catch (e: any) {
      toast.show({ title: t("seller_financing.could_not_apply"), body: e?.message || t("seller_financing.please_try_again"), kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [selected, advance, monthly, ageMonths, notes, load, t, toast]);

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header onBack={() => router.back()} title={t("seller_financing.title")} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Header onBack={() => router.back()} title={t("seller_financing.title")} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <HandCoins size={22} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>{t("seller_financing.hero_title")}</Text>
          <Text style={styles.heroBody}>
            {t("seller_financing.hero_body")}
          </Text>
        </View>

        {/* Eligibility */}
        <View
          style={[
            styles.eligibilityCard,
            data.eligibility.eligible ? styles.eligibilityOk : styles.eligibilityBlocked,
          ]}
        >
          {data.eligibility.eligible ? (
            <CheckCircle2 size={18} color={colors.success} />
          ) : (
            <AlertTriangle size={18} color="#92400E" />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.eligibilityTitle}>
              {data.eligibility.eligible
                ? t("seller_financing.eligible_title", { tier: data.tier_label })
                : t("seller_financing.not_eligible_title", { tier: data.tier_label })}
            </Text>
            <Text style={styles.eligibilityBody}>{data.eligibility.reason}</Text>
          </View>
        </View>

        {/* Existing applications */}
        {apps.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>{t("seller_financing.your_applications")}</Text>
            {apps.map((a) => {
              const s = STATUS_STYLE[a.status] || { bg: colors.surface, fg: colors.text };
              const labelKey = STATUS_LABEL_KEY[a.status];
              const label = labelKey ? t(labelKey) : a.status;
              return (
                <View key={a.id} style={styles.appRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.appPartner}>{a.partner_name}</Text>
                    <Text style={styles.appMeta}>
                      NZD {a.desired_advance_nzd.toLocaleString()} ·{" "}
                      {new Date(a.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
                    <Text style={[styles.statusText, { color: s.fg }]}>{label}</Text>
                  </View>
                </View>
              );
            })}
          </>
        ) : null}

        {/* Partners */}
        <Text style={styles.sectionTitle}>{t("seller_financing.choose_partner")}</Text>
        {data.partners.map((p) => (
          <View key={p.id} style={styles.partnerCard}>
            <View style={styles.partnerHeader}>
              <View style={styles.partnerLogo}>
                <Landmark size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.partnerName}>{p.name}</Text>
                <Text style={styles.partnerTagline}>{p.tagline}</Text>
              </View>
            </View>

            <View style={styles.factsRow}>
              <Fact
                icon={<HandCoins size={14} color={colors.primary} />}
                label={t("seller_financing.fact_advance")}
                value={`${p.advance_pct_min}–${p.advance_pct_max}%`}
              />
              <Fact
                icon={<Sparkles size={14} color={colors.primary} />}
                label={t("seller_financing.fact_fee")}
                value={`${p.fee_pct_min}–${p.fee_pct_max}%`}
              />
              <Fact
                icon={<Clock size={14} color={colors.primary} />}
                label={t("seller_financing.fact_speed")}
                value={t("seller_financing.fact_hours", { hours: p.turnaround_hours })}
              />
            </View>

            <View style={styles.reqsBox}>
              <Text style={styles.reqsHeader}>{t("seller_financing.eligibility_header")}</Text>
              <Req text={t("seller_financing.elig_invoices", { amount: (p.min_monthly_invoices_inr / 1000).toFixed(0) })} />
              <Req text={t("seller_financing.elig_months", { months: p.min_business_age_months })} />
              <Req text={t("seller_financing.elig_gst")} />
            </View>

            <View style={styles.bestForRow}>
              {p.best_for.slice(0, 3).map((b) => (
                <View key={b} style={styles.bestChip}>
                  <Text style={styles.bestText}>{b}</Text>
                </View>
              ))}
            </View>

            <View style={styles.partnerActions}>
              <Pressable
                testID={`apply-${p.id}`}
                onPress={() => openApply(p)}
                style={({ pressed }) => [
                  styles.applyBtn,
                  !data.eligibility.eligible && styles.applyBtnDisabled,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.applyBtnText}>{t("seller_financing.express_interest")}</Text>
              </Pressable>
              <Pressable
                testID={`learn-${p.id}`}
                onPress={() => Linking.openURL(p.website)}
                style={styles.linkBtn}
              >
                <ExternalLink size={14} color={colors.primary} />
                <Text style={styles.linkBtnText}>{t("seller_financing.visit_website")}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Info size={14} color={colors.textMuted} />
          <Text style={styles.disclaimerText}>{data.disclaimer}</Text>
        </View>

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      {/* Apply modal */}
      <Modal
        animationType="slide"
        transparent
        visible={!!selected}
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalWrap}
          >
            <View style={styles.modalCard}>
              <Pressable
                testID="apply-modal-close"
                onPress={() => setSelected(null)}
                style={styles.modalClose}
              >
                <X size={20} color={colors.textMuted} />
              </Pressable>
              <View style={styles.modalIcon}>
                <Building2 size={22} color={colors.primary} />
              </View>
              <Text style={styles.modalTitle}>{t("seller_financing.apply_to", { name: selected?.name ?? "" })}</Text>
              <Text style={styles.modalSub}>
                {t("seller_financing.apply_sub", { hours: selected?.turnaround_hours ?? 0 })}
              </Text>

              <Label>{t("seller_financing.label_desired_advance")}</Label>
              <TextInput
                testID="advance-input"
                value={advance}
                onChangeText={setAdvance}
                placeholder="5000"
                placeholderTextColor={colors.textFaint}
                keyboardType="decimal-pad"
                style={styles.input}
              />

              <Label>{t("seller_financing.label_monthly_invoices")}</Label>
              <TextInput
                testID="monthly-input"
                value={monthly}
                onChangeText={setMonthly}
                placeholder="100000"
                placeholderTextColor={colors.textFaint}
                keyboardType="decimal-pad"
                style={styles.input}
              />

              <Label>{t("seller_financing.label_business_age")}</Label>
              <TextInput
                testID="age-input"
                value={ageMonths}
                onChangeText={setAgeMonths}
                placeholder="12"
                placeholderTextColor={colors.textFaint}
                keyboardType="number-pad"
                style={styles.input}
              />

              <Label>{t("seller_financing.label_notes")}</Label>
              <TextInput
                testID="notes-input"
                value={notes}
                onChangeText={(txt) => setNotes(txt.slice(0, 600))}
                placeholder={t("seller_financing.placeholder_notes")}
                placeholderTextColor={colors.textFaint}
                multiline
                style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
              />

              <Pressable
                testID="apply-modal-submit"
                disabled={submitting}
                onPress={submit}
                style={({ pressed }) => [
                  styles.submitBtn,
                  submitting && { opacity: 0.6 },
                  pressed && !submitting && { opacity: 0.85 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <ShieldCheck size={16} color="#fff" />
                    <Text style={styles.submitText}>{t("seller_financing.submit_interest")}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.topBar}>
      <Pressable testID="financing-back" onPress={onBack} style={styles.backBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.fact}>
      {icon}
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Req({ text }: { text: string }) {
  return (
    <View style={styles.reqRow}>
      <CheckCircle2 size={12} color={colors.success} />
      <Text style={styles.reqText}>{text}</Text>
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDark,
    gap: 8,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: -0.3 },
  heroBody: { fontSize: 13.5, color: "rgba(255,255,255,0.85)", lineHeight: 19 },
  eligibilityCard: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  eligibilityOk: { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  eligibilityBlocked: { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" },
  eligibilityTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  eligibilityBody: { fontSize: 12.5, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginTop: spacing.md },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  appPartner: { fontSize: 13.5, fontWeight: "800", color: colors.text },
  appMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  partnerCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  partnerHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  partnerLogo: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  partnerName: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  partnerTagline: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  factsRow: { flexDirection: "row", gap: 8 },
  fact: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: 4,
  },
  factLabel: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.3 },
  factValue: { fontSize: 14, fontWeight: "800", color: colors.text },
  reqsBox: { gap: 4 },
  reqsHeader: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.3, marginBottom: 4 },
  reqRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reqText: { fontSize: 12.5, color: colors.text, fontWeight: "600" },
  bestForRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  bestChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  bestText: { fontSize: 11, fontWeight: "700", color: colors.primaryDark },
  partnerActions: { flexDirection: "row", gap: 8, alignItems: "center" },
  applyBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  applyBtnDisabled: { backgroundColor: colors.textFaint },
  applyBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  linkBtnText: { color: colors.primary, fontWeight: "800", fontSize: 13 },
  disclaimer: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  disclaimerText: { fontSize: 11.5, color: colors.textMuted, flex: 1, lineHeight: 16 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalWrap: { width: "100%" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  modalClose: { position: "absolute", top: 14, right: 14, padding: 4, zIndex: 1 },
  modalIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: { fontSize: 20, fontWeight: "800", color: colors.text, marginTop: 4 },
  modalSub: { fontSize: 13, color: colors.textMuted, lineHeight: 18, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.3, marginTop: 6 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
