/**
 * WelcomeCouponBanner — first-purchase activation lever.
 *
 * Renders a gradient banner with the buyer's eligible welcome coupon
 * (typically WELCOME10 — 10% off first order, capped at $20 NZD). The user
 * can copy the code with a single tap (and we paste-confirm via a toast),
 * or jump straight to the home product grid to shop.
 *
 * The banner self-hides when:
 *   - the user isn't signed in (no point — they have no order history yet)
 *   - the backend returns null (already redeemed, ineligible region, etc.)
 *   - the user has dismissed it this session (AsyncStorage flag, per-user
 *     scoped so a new login from the same device still sees it)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Gift, X } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type WelcomeCoupon = {
  code: string;
  description: string;
  type: string;
  value: number;
  min_order_nzd: number;
  max_discount_nzd?: number | null;
  first_order_only?: boolean;
};

function dismissKey(userId: string | undefined | null) {
  return `welcome-banner-dismissed:${userId || "anon"}`;
}

export function WelcomeCouponBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();
  const [coupon, setCoupon] = useState<WelcomeCoupon | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.id) {
        setCoupon(null);
        setDismissed(false);
        return;
      }
      // Check local dismissal first so we don't briefly flash the banner
      // every time the home tab focuses.
      try {
        const flag = await AsyncStorage.getItem(dismissKey(user.id));
        if (flag === "1") {
          if (!cancelled) {
            setDismissed(true);
            setCoupon(null);
          }
          return;
        }
        if (!cancelled) setDismissed(false);
      } catch {
        /* ignore — fall through to fetch */
      }
      try {
        const c = await api<WelcomeCoupon | null>("/coupons/welcome");
        if (!cancelled) setCoupon(c ?? null);
      } catch {
        if (!cancelled) setCoupon(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const onCopy = useCallback(async () => {
    if (!coupon) return;
    try {
      await Clipboard.setStringAsync(coupon.code);
      toast.show({
        title: t("welcome_coupon.copied_title"),
        body: t("welcome_coupon.copied_body", { code: coupon.code }),
        kind: "success",
      });
    } catch {
      toast.show({
        title: t("welcome_coupon.copy_failed_title"),
        body: t("welcome_coupon.copy_failed_body", { code: coupon.code }),
        kind: "info",
      });
    }
  }, [coupon, toast, t]);

  const onDismiss = useCallback(async () => {
    setCoupon(null);
    setDismissed(true);
    try {
      await AsyncStorage.setItem(dismissKey(user?.id), "1");
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  if (!user?.id || dismissed || !coupon) return null;

  const pctLabel =
    coupon.type === "percent"
      ? `${Number.isInteger(coupon.value) ? coupon.value : coupon.value.toFixed(1)}%`
      : coupon.type === "fixed"
        ? `$${coupon.value.toFixed(0)}`
        : "";
  const capLabel = coupon.max_discount_nzd
    ? ` up to $${coupon.max_discount_nzd.toFixed(0)}`
    : "";

  return (
    <View style={styles.wrap} testID="welcome-coupon-banner">
      <View style={styles.iconBubble}>
        <Gift size={20} color="#fff" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>
          {t("welcome_coupon.title", { pct: pctLabel, cap: capLabel })}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {coupon.description ||
            `Use code ${coupon.code} at checkout. Minimum spend $${coupon.min_order_nzd.toFixed(0)}.`}
        </Text>
        <View style={styles.actions}>
          <Pressable
            testID="welcome-coupon-copy"
            onPress={onCopy}
            style={({ pressed }) => [styles.codePill, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.codeText}>{coupon.code}</Text>
            <Text style={styles.codeHint}>{t("welcome_coupon.tap_to_copy")}</Text>
          </Pressable>
          <Pressable
            testID="welcome-coupon-shop"
            onPress={() => router.push("/(tabs)/home")}
            style={({ pressed }) => [styles.shopBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.shopBtnText}>{t("welcome_coupon.shop_now")}</Text>
          </Pressable>
        </View>
      </View>
      <Pressable
        testID="welcome-coupon-dismiss"
        hitSlop={10}
        onPress={onDismiss}
        style={styles.dismiss}
      >
        <X size={16} color="rgba(255,255,255,0.85)" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    // Soft warm shadow that fits the orange brand without being heavy.
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  title: { color: "#fff", fontWeight: "800", fontSize: 14 },
  body: { color: "rgba(255,255,255,0.92)", fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  codePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderStyle: "dashed",
  },
  codeText: { color: "#fff", fontWeight: "800", letterSpacing: 1 },
  codeHint: { color: "rgba(255,255,255,0.8)", fontWeight: "600", fontSize: 11 },
  shopBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: "#fff",
  },
  shopBtnText: { color: colors.primary, fontWeight: "800", fontSize: 13 },
  dismiss: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default WelcomeCouponBanner;
