import { useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  Crown,
  ExternalLink,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type ProStatus = {
  active: boolean;
  status?: string;
  plan?: string | null;
  current_period_end?: number | null;
  will_cancel?: boolean;
  price_id_configured?: boolean;
};

const BENEFIT_ICONS: { icon: typeof Zap; color: string; titleKey: string; bodyKey: string }[] = [
  { icon: Zap, color: "#f97316", titleKey: "seller_pro.benefit1_title", bodyKey: "seller_pro.benefit1_body" },
  { icon: Star, color: "#facc15", titleKey: "seller_pro.benefit2_title", bodyKey: "seller_pro.benefit2_body" },
  { icon: TrendingUp, color: "#22c55e", titleKey: "seller_pro.benefit3_title", bodyKey: "seller_pro.benefit3_body" },
  { icon: Sparkles, color: "#a855f7", titleKey: "seller_pro.benefit4_title", bodyKey: "seller_pro.benefit4_body" },
  { icon: Users, color: "#0ea5e9", titleKey: "seller_pro.benefit5_title", bodyKey: "seller_pro.benefit5_body" },
  { icon: Crown, color: "#ec4899", titleKey: "seller_pro.benefit6_title", bodyKey: "seller_pro.benefit6_body" },
];

export default function AllsalePro() {
  const router = useRouter();
  const { t } = useTranslation();
  const { show } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<ProStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<ProStatus>("/seller/pro/status");
      setStatus(d);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startCheckout = async () => {
    if (!status?.price_id_configured) {
      show({
        title: t("seller_pro.not_enabled_title"),
        message: t("seller_pro.not_enabled_msg"),
        kind: "info",
      });
      return;
    }
    setActing(true);
    try {
      const d = await api<{ url: string }>("/seller/pro/checkout", { method: "POST", body: {} });
      if (Platform.OS === "web") (globalThis as unknown as Window).location.href = d.url;
      else await Linking.openURL(d.url);
    } catch (e: any) {
      show({ title: t("seller_pro.couldnt_checkout"), message: e?.message, kind: "error" });
    } finally {
      setActing(false);
    }
  };

  const cancelSub = async () => {
    const ok = await confirm({
      title: t("seller_pro.confirm_cancel_title"),
      message: t("seller_pro.confirm_cancel_msg"),
      confirmLabel: t("seller_pro.confirm_cancel_btn"),
      destructive: true,
    });
    if (!ok) return;
    setActing(true);
    try {
      await api("/seller/pro/cancel", { method: "POST", body: {} });
      show({ title: t("seller_pro.cancel_scheduled_title"), message: t("seller_pro.cancel_scheduled_msg"), kind: "success" });
      load();
    } catch (e: any) {
      show({ title: t("seller_pro.couldnt_cancel"), message: e?.message, kind: "error" });
    } finally {
      setActing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable testID="pro-back" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("seller_pro.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.crownChip}>
            <Crown size={20} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>{t("seller_pro.hero_title")}</Text>
          <Text style={styles.heroBody}>
            {t("seller_pro.hero_body")}
          </Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{t("seller_pro.price")}</Text>
            <Text style={styles.priceUnit}>{t("seller_pro.price_unit")}</Text>
          </View>
          <Text style={styles.priceSub}>{t("seller_pro.price_sub")}</Text>
        </View>

        {/* Active banner */}
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} />
        ) : status?.active ? (
          <View style={styles.activeBanner}>
            <CheckCircle2 size={20} color="#16a34a" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.activeTitle}>{t("seller_pro.active_title")}</Text>
              <Text style={styles.activeBody}>
                {status.will_cancel
                  ? t("seller_pro.will_cancel_body")
                  : status.current_period_end
                    ? t("seller_pro.renews_on", { date: new Date(status.current_period_end * 1000).toLocaleDateString() })
                    : t("seller_pro.renews_monthly")}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Benefits */}
        <Text style={styles.sectionLabel}>{t("seller_pro.section_benefits")}</Text>
        {BENEFIT_ICONS.map((b, i) => {
          const Icon = b.icon;
          return (
            <View key={i} style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: b.color + "22" }]}>
                <Icon size={18} color={b.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{t(b.titleKey)}</Text>
                <Text style={styles.benefitBody}>{t(b.bodyKey)}</Text>
              </View>
            </View>
          );
        })}

        {/* CTA */}
        <View style={styles.ctaWrap}>
          {!status?.active ? (
            <Pressable
              testID="pro-subscribe-btn"
              onPress={startCheckout}
              disabled={acting}
              style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }, acting && { opacity: 0.7 }]}
            >
              {acting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Crown size={18} color="#fff" />
                  <Text style={styles.ctaText}>
                    {status?.price_id_configured === false ? t("seller_pro.coming_soon") : t("seller_pro.subscribe_btn")}
                  </Text>
                </>
              )}
            </Pressable>
          ) : !status.will_cancel ? (
            <Pressable
              testID="pro-cancel-btn"
              onPress={cancelSub}
              disabled={acting}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.cancelBtnText}>{t("seller_pro.cancel_btn")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            testID="pro-refresh-btn"
            onPress={load}
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.secondaryBtnText}>{t("seller_pro.refresh_btn")}</Text>
          </Pressable>
        </View>

        {/* Math */}
        <View style={styles.mathCard}>
          <Text style={styles.mathTitle}>{t("seller_pro.math_title")}</Text>
          <Row label={t("seller_pro.math_gmv")} value={t("seller_pro.math_gmv_val")} />
          <Row label={t("seller_pro.math_std")} value={t("seller_pro.math_std_val")} />
          <Row label={t("seller_pro.math_pro")} value={t("seller_pro.math_pro_val")} highlight />
          <Row label={t("seller_pro.math_sub")} value={t("seller_pro.math_sub_val")} />
          <Row label={t("seller_pro.math_save")} value={t("seller_pro.math_save_val")} bold />
        </View>

        <Pressable
          testID="pro-fees-explainer"
          onPress={() => Linking.openURL("https://shop.allsale.co.nz/help/seller-policy")}
          style={styles.linkBtn}
        >
          <Text style={styles.linkText}>{t("seller_pro.seller_policy_link")}</Text>
          <ExternalLink size={12} color={colors.primary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, highlight, bold }: { label: string; value: string; highlight?: boolean; bold?: boolean }) {
  return (
    <View style={styles.mathRow}>
      <Text style={[styles.mathLabel, bold && { color: colors.text, fontWeight: "800" }]}>{label}</Text>
      <Text
        style={[
          styles.mathValue,
          highlight && { color: "#16a34a" },
          bold && { fontWeight: "800", color: "#16a34a", fontSize: 16 },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: colors.surface, alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800", color: colors.text },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  hero: {
    backgroundColor: "#1e293b",
    borderRadius: radius.xl, padding: spacing.lg, gap: 6, marginBottom: spacing.lg,
  },
  crownChip: {
    width: 44, height: 44, borderRadius: 999,
    backgroundColor: "#facc15", alignItems: "center", justifyContent: "center",
    marginBottom: 6,
  },
  heroTitle: { fontSize: 26, fontWeight: "800", color: "#fff", letterSpacing: -0.5 },
  heroBody: { fontSize: 14, color: "#cbd5e1", lineHeight: 21, marginBottom: 8 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 },
  price: { fontSize: 32, fontWeight: "900", color: "#facc15" },
  priceUnit: { fontSize: 14, color: "#cbd5e1", fontWeight: "700" },
  priceSub: { fontSize: 12, color: "#94a3b8" },
  activeBanner: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#dcfce7", borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: "#bbf7d0", marginBottom: spacing.lg,
  },
  activeTitle: { fontSize: 14, fontWeight: "800", color: "#166534" },
  activeBody: { fontSize: 12, color: "#166534", marginTop: 2 },
  sectionLabel: {
    fontSize: 13, fontWeight: "800", color: colors.textMuted,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
  },
  benefit: {
    flexDirection: "row", gap: 12,
    backgroundColor: "#fff", borderRadius: radius.lg, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  benefitIcon: {
    width: 36, height: 36, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
  },
  benefitTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  benefitBody: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
  ctaWrap: { gap: 10, marginTop: spacing.lg, marginBottom: spacing.lg },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 56, borderRadius: radius.pill, backgroundColor: "#facc15",
  },
  ctaText: { color: "#78350f", fontSize: 16, fontWeight: "900" },
  cancelBtn: {
    height: 50, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2",
  },
  cancelBtnText: { color: "#b91c1c", fontSize: 14, fontWeight: "800" },
  secondaryBtn: {
    height: 44, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff",
  },
  secondaryBtnText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  mathCard: {
    backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  mathTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginBottom: 8 },
  mathRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  mathLabel: { fontSize: 13, color: colors.textMuted },
  mathValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  linkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    marginTop: spacing.lg, padding: spacing.md,
  },
  linkText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
});
