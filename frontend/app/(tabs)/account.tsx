import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Bell, BadgeCheck, ChevronRight, CreditCard, FileText, Fingerprint, Gift, Globe2, Heart, HelpCircle, LogOut, Mail, MapPin, MessageCircle, Package, RefreshCcw, Search, Settings, ShieldCheck, ShieldAlert, Sparkles, Store, XCircle } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LanguagePicker, LanguagePill } from "@/src/components/LanguagePicker";
import { useToast } from "@/src/components/UiOverlayProvider";

import { useAuth } from "@/src/contexts/AuthContext";
import { useTranslation } from "@/src/i18n";
import { useRegion } from "@/src/contexts/RegionContext";
import { useWishlist } from "@/src/contexts/WishlistContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Account() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { country, info, countries, setCountry } = useRegion();
  const { count: wishlistCount } = useWishlist();
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);
  const [showCountrySheet, setShowCountrySheet] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [resendingVerify, setResendingVerify] = useState(false);
  const toast = useToast();
  const regionFlag = info.flag;
  const regionName = info.name;
  const regionCurrency = info.currency;

  const loadUnread = useCallback(async () => {
    try {
      const res = await api<{ unread: number }>("/notifications/unread-count");
      setUnread(res?.unread || 0);
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadUnread();
    }, [loadUnread])
  );

  const initials = (user?.full_name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const resendVerification = useCallback(async () => {
    if (resendingVerify) return;
    setResendingVerify(true);
    try {
      await api("/auth/verify-email/request", { method: "POST", body: {} });
      toast.show({
        kind: "success",
        title: t("toasts.verify_email_sent"),
        body: t("toasts.verify_email_sent_body"),
      });
    } catch (e: any) {
      toast.show({
        kind: "error",
        title: t("toasts.couldnt_send_email"),
        body: e?.message || t("toasts.try_again_moment"),
      });
    } finally {
      setResendingVerify(false);
    }
  }, [resendingVerify, toast, t]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("account_menu.title")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <LanguagePill onPress={() => setLangOpen(true)} />
            <Pressable
              testID="account-notifications-btn"
              onPress={() => router.push("/notifications")}
              style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.8 }]}
              hitSlop={10}
            >
              <Bell size={20} color={colors.text} />
              {unread > 0 ? (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>
        <LanguagePicker visible={langOpen} onClose={() => setLangOpen(false)} />

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} testID="account-name">{user?.full_name}</Text>
            <View style={styles.emailRow}>
              <Text style={styles.email} numberOfLines={1}>{user?.email}</Text>
              {user?.email_verified ? (
                <View style={styles.verifiedPill} testID="account-email-verified-pill">
                  <BadgeCheck size={11} color="#16a34a" />
                  <Text style={styles.verifiedPillText}>{t("account_menu.verified")}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.regionBadge}>
              <Globe2 size={11} color={colors.textMuted} />
              <Text style={styles.regionText}>{t("account_menu.shipping_to", { country: regionName })}</Text>
            </View>
          </View>
        </View>

        {user && user.email_verified === false ? (
          <View style={styles.verifyBanner} testID="account-verify-email-banner">
            <View style={styles.verifyIcon}>
              <Mail size={18} color="#92400E" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.verifyTitle}>{t("account_menu.verify_email")}</Text>
              <Text style={styles.verifySubtitle}>
                Secure your account & unlock checkout shortcuts.
              </Text>
            </View>
            <Pressable
              testID="account-verify-email-btn"
              onPress={resendVerification}
              disabled={resendingVerify}
              style={({ pressed }) => [
                styles.verifyCta,
                pressed && { opacity: 0.85 },
                resendingVerify && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.verifyCtaText}>
                {resendingVerify ? t("account_menu.sending") : t("account_menu.verify")}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.menuGroup}>
          <Row
            icon={<Package size={18} color={colors.text} />}
            label={t("account_menu.my_orders")}
            onPress={() => router.push("/orders")}
            testID="account-orders-btn"
          />
          <Row
            icon={<Heart size={18} color={colors.text} />}
            label={t("account_menu.my_wishlist")}
            subtitle={wishlistCount > 0 ? `${wishlistCount} saved` : "Save items for later"}
            onPress={() => router.push("/wishlist")}
            testID="account-wishlist-btn"
          />
          <Row
            icon={<Sparkles size={18} color="#7C3AED" />}
            label={t("account_menu.points")}
            subtitle={t("account_sub.points")}
            onPress={() => router.push("/points/history")}
            testID="account-points-btn"
          />
          <Row
            icon={<Gift size={18} color="#7C3AED" />}
            label={t("account_menu.invite_friends")}
            subtitle={t("account_sub.invite_friends")}
            onPress={() => router.push("/referrals")}
            testID="account-referrals-btn"
          />
          <Row
            icon={<Sparkles size={18} color={colors.primary} />}
            label={t("account_menu.ambassador")}
            subtitle={t("account_sub.ambassador")}
            onPress={() => router.push("/ambassadors")}
            testID="account-ambassador-btn"
          />
          <Row
            icon={<MessageCircle size={18} color={colors.text} />}
            label={t("account_menu.messages")}
            subtitle={t("account_sub.messages")}
            onPress={() => router.push("/chat")}
            testID="account-messages-btn"
          />
          <Row
            icon={<RefreshCcw size={18} color={colors.text} />}
            label={t("account_menu.returns")}
            subtitle={t("account_sub.returns")}
            onPress={() => router.push("/returns")}
            testID="account-returns-btn"
          />
          <Row
            icon={<Search size={18} color={colors.text} />}
            label={t("account_menu.saved_searches")}
            subtitle={t("account_sub.saved_searches")}
            onPress={() => router.push("/account/saved-searches")}
            testID="account-saved-searches-btn"
          />
          <Row
            icon={<Text style={{ fontSize: 18 }}>{regionFlag}</Text>}
            label={t("account_menu.ship_to", { country: regionName })}
            subtitle={`Prices shown in ${regionCurrency}`}
            onPress={() => setShowCountrySheet(true)}
            testID="account-region-btn"
          />
          {user?.is_seller ? (
            <Row
              icon={<Store size={18} color={colors.primary} />}
              label={t("account_menu.seller_dashboard")}
              subtitle={user.seller_verified ? "Verified · manage listings" : "Verification pending"}
              onPress={() => router.push("/seller/dashboard")}
              testID="account-seller-dashboard-btn"
            />
          ) : (
            <Row
              icon={<Store size={18} color={colors.primary} />}
              label={t("account_menu.become_seller")}
              subtitle={t("account_sub.become_seller")}
              onPress={() => router.push("/seller/welcome")}
              testID="account-become-seller-btn"
            />
          )}
          <Row
            icon={<MapPin size={18} color={colors.text} />}
            label={t("account_menu.addresses")}
            onPress={() => {}}
            testID="account-addresses-btn"
            subtitle={t("account_sub.addresses_setup")}
          />
          <Row
            icon={<ShieldAlert size={18} color={colors.primary} />}
            label={t("account_menu.prohibited")}
            subtitle={t("account_sub.prohibited")}
            onPress={() => router.push("/help/prohibited-checker")}
            testID="account-prohibited-checker-btn"
          />
          <Row
            icon={<ShieldCheck size={18} color={colors.text} />}
            label={t("account_menu.protection")}
            onPress={() => {}}
            testID="account-protection-btn"
            subtitle={t("account_sub.protection")}
          />
          <Row
            icon={<MapPin size={18} color={colors.primary} />}
            label={t("account_menu.saved_addresses")}
            subtitle={t("account_sub.saved_addresses")}
            onPress={() => router.push("/account/addresses")}
            testID="account-addresses-btn"
          />
          <Row
            icon={<ShieldCheck size={18} color={colors.primary} />}
            label={t("account_menu.two_factor")}
            subtitle={t("account_sub.two_factor")}
            onPress={() => router.push("/account/two-factor")}
            testID="account-2fa-btn"
          />
          <Row
            icon={<Fingerprint size={18} color={colors.primary} />}
            label="Security & biometrics"
            subtitle="Face ID / Touch ID login, auto-lock, checkout confirmation"
            onPress={() => router.push("/account/security")}
            testID="account-security-btn"
          />
          <Row
            icon={<ShieldCheck size={18} color={colors.text} />}
            label={t("account_menu.privacy")}
            subtitle={t("account_sub.privacy")}
            onPress={() => router.push("/account/privacy")}
            testID="account-privacy-btn"
          />
          <Row
            icon={<Bell size={18} color={colors.primary} />}
            label={t("account_menu.notifications")}
            subtitle={t("account_sub.notifications")}
            onPress={() => router.push("/account/notification-prefs")}
            testID="account-notif-prefs-btn"
          />
          <Row
            icon={<Settings size={18} color={colors.text} />}
            label={t("account_menu.preferences")}
            onPress={() => {}}
            testID="account-prefs-btn"
          />
        </View>

        <Text style={styles.groupLabel}>{t("account_menu.policies_help")}</Text>
        <View style={styles.menuGroup}>
          <Row
            icon={<HelpCircle size={18} color={colors.primary} />}
            label={t("account_menu.help_center")}
            subtitle={t("account_sub.help_center")}
            onPress={() => router.push("/help")}
            testID="account-help-center-btn"
          />
          <Row
            icon={<FileText size={18} color={colors.primary} />}
            label="Legal & Policies"
            subtitle={t("account_sub.legal")}
            onPress={() => router.push("/legal")}
            testID="account-legal-hub-btn"
          />
          <Row
            icon={<CreditCard size={18} color={colors.text} />}
            label="Payment policy"
            subtitle={t("account_sub.fees")}
            onPress={() => router.push("/legal/payment")}
            testID="account-payment-policy-btn"
          />
          <Row
            icon={<RefreshCcw size={18} color={colors.text} />}
            label="Return policy"
            subtitle={t("account_sub.returns_policy")}
            onPress={() => router.push("/legal/return")}
            testID="account-return-policy-btn"
          />
          <Row
            icon={<XCircle size={18} color={colors.text} />}
            label="Cancellation policy"
            subtitle={t("account_sub.cancel_policy")}
            onPress={() => router.push("/legal/cancellation")}
            testID="account-cancellation-policy-btn"
          />
        </View>

        <Pressable
          testID="account-logout-btn"
          onPress={async () => {
            await logout();
            router.replace("/(auth)/welcome");
          }}
          style={({ pressed }) => [styles.logout, pressed && { opacity: 0.8 }]}
        >
          <LogOut size={18} color={colors.error} />
          <Text style={styles.logoutText}>{t("account_menu.sign_out")}</Text>
        </Pressable>

        <Text style={styles.footer}>{t("account_menu.footer")}</Text>
      </ScrollView>

      <Modal
        visible={showCountrySheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCountrySheet(false)}
      >
        <Pressable
          style={styles.modalScrim}
          onPress={() => setShowCountrySheet(false)}
        />
        <View style={styles.countrySheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Where do you want to ship?</Text>
          <Text style={styles.sheetSubtitle}>
            Prices, taxes and delivery options adjust to your selection.
          </Text>
          {countries.map((c) => {
            const active = c.code === country;
            return (
              <Pressable
                key={c.code}
                testID={`country-opt-${c.code}`}
                onPress={async () => {
                  await setCountry(c.code as any);
                  setShowCountrySheet(false);
                }}
                style={[styles.countryRow, active && styles.countryRowActive]}
              >
                <Text style={{ fontSize: 22 }}>{c.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.countryName}>{c.name}</Text>
                  <Text style={styles.countryMeta}>
                    {c.currency} · {c.symbol}
                  </Text>
                </View>
                {active ? <ShieldCheck size={18} color={colors.success} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  subtitle,
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  bellBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  groupLabel: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontSize: 11,
    fontWeight: "800",
    color: colors.textFaint,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  profileCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  name: { fontSize: 17, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  email: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  regionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  regionText: { fontSize: 10, color: colors.textMuted, fontWeight: "600" },
  emailRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#dcfce7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  verifiedPillText: { fontSize: 10, color: "#166534", fontWeight: "700" },
  verifyBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: "#FEF3C7",
    borderRadius: radius.lg,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  verifyIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#FDE68A",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyTitle: { fontSize: 14, fontWeight: "800", color: "#78350F" },
  verifySubtitle: { fontSize: 12, color: "#92400E", marginTop: 2 },
  verifyCta: {
    backgroundColor: "#D97706",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  verifyCtaText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  menuGroup: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  logout: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutText: { color: colors.error, fontWeight: "700", fontSize: 14 },
  footer: { textAlign: "center", color: colors.textFaint, fontSize: 11, marginTop: spacing.xl },
  modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  countrySheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 4 },
  sheetSubtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 17 },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  countryRowActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  countryName: { fontSize: 14, fontWeight: "700", color: colors.text },
  countryMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
