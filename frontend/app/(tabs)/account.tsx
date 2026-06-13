import { useFocusEffect, useRouter } from "expo-router";
import { Bell, ChevronRight, FileText, Gift, Globe2, Heart, LogOut, MapPin, MessageCircle, Package, RefreshCcw, Settings, ShieldCheck, ShieldAlert, Sparkles, Store, XCircle } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { useRegion } from "@/src/contexts/RegionContext";
import { useWishlist } from "@/src/contexts/WishlistContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Account() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { country, info, countries, setCountry } = useRegion();
  const { count: wishlistCount } = useWishlist();
  const [unread, setUnread] = useState(0);
  const [showCountrySheet, setShowCountrySheet] = useState(false);
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
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

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} testID="account-name">{user?.full_name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={styles.regionBadge}>
              <Globe2 size={11} color={colors.textMuted} />
              <Text style={styles.regionText}>Shipping to New Zealand</Text>
            </View>
          </View>
        </View>

        <View style={styles.menuGroup}>
          <Row
            icon={<Package size={18} color={colors.text} />}
            label="My orders"
            onPress={() => router.push("/orders")}
            testID="account-orders-btn"
          />
          <Row
            icon={<Heart size={18} color={colors.text} />}
            label="My wishlist"
            subtitle={wishlistCount > 0 ? `${wishlistCount} saved` : "Save items for later"}
            onPress={() => router.push("/wishlist")}
            testID="account-wishlist-btn"
          />
          <Row
            icon={<Sparkles size={18} color="#7C3AED" />}
            label="Allsale Points"
            subtitle="Earn on every order · redeem for discounts"
            onPress={() => router.push("/points/history")}
            testID="account-points-btn"
          />
          <Row
            icon={<Gift size={18} color="#7C3AED" />}
            label="Invite friends"
            subtitle="Give pts, get pts when they buy"
            onPress={() => router.push("/referrals")}
            testID="account-referrals-btn"
          />
          <Row
            icon={<MessageCircle size={18} color={colors.text} />}
            label="Messages"
            subtitle="Chat with sellers about your orders"
            onPress={() => router.push("/chat")}
            testID="account-messages-btn"
          />
          <Row
            icon={<RefreshCcw size={18} color={colors.text} />}
            label="My returns"
            subtitle="Track refund requests & seller responses"
            onPress={() => router.push("/returns")}
            testID="account-returns-btn"
          />
          <Row
            icon={<Text style={{ fontSize: 18 }}>{regionFlag}</Text>}
            label={`Ship to ${regionName}`}
            subtitle={`Prices shown in ${regionCurrency}`}
            onPress={() => setShowCountrySheet(true)}
            testID="account-region-btn"
          />
          {user?.is_seller ? (
            <Row
              icon={<Store size={18} color={colors.primary} />}
              label="Seller dashboard"
              subtitle={user.seller_verified ? "Verified · manage listings" : "Verification pending"}
              onPress={() => router.push("/seller/dashboard")}
              testID="account-seller-dashboard-btn"
            />
          ) : (
            <Row
              icon={<Store size={18} color={colors.primary} />}
              label="Become a seller"
              subtitle="List your India-registered business on Allsale"
              onPress={() => router.push("/seller/welcome")}
              testID="account-become-seller-btn"
            />
          )}
          <Row
            icon={<MapPin size={18} color={colors.text} />}
            label="Shipping addresses"
            onPress={() => {}}
            testID="account-addresses-btn"
            subtitle="Set up at checkout"
          />
          <Row
            icon={<ShieldAlert size={18} color={colors.primary} />}
            label="Allowed in NZ?"
            subtitle="Check prohibited items before you ship"
            onPress={() => router.push("/help/prohibited-checker")}
            testID="account-prohibited-checker-btn"
          />
          <Row
            icon={<ShieldCheck size={18} color={colors.text} />}
            label="Buyer protection"
            onPress={() => {}}
            testID="account-protection-btn"
            subtitle="Refund if item not delivered"
          />
          <Row
            icon={<Settings size={18} color={colors.text} />}
            label="Preferences"
            onPress={() => {}}
            testID="account-prefs-btn"
          />
        </View>

        <Text style={styles.groupLabel}>Policies & help</Text>
        <View style={styles.menuGroup}>
          <Row
            icon={<FileText size={18} color={colors.text} />}
            label="Payment policy"
            subtitle="How we charge, taxes, refunds"
            onPress={() => router.push("/help/payment-policy")}
            testID="account-payment-policy-btn"
          />
          <Row
            icon={<RefreshCcw size={18} color={colors.text} />}
            label="Return policy"
            subtitle="7-day window · cross-border returns"
            onPress={() => router.push("/help/return-policy")}
            testID="account-return-policy-btn"
          />
          <Row
            icon={<XCircle size={18} color={colors.text} />}
            label="Cancellation policy"
            subtitle="Free cancel within 12 hours"
            onPress={() => router.push("/help/cancellation-policy")}
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
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.footer}>Allsale · India → NZ · Authentic, fairly traded.</Text>
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
