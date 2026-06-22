/**
 * Smart-link landing page for ambassador codes.
 *
 * Route: /a/{code}
 *
 * - When the visitor arrived via a B2C link → big "Shop now" CTA (auto-applies code at cart).
 * - When the visitor arrived via a B2B link → big "Sell on Allsale" CTA (auto-applies code at seller signup).
 * - When the ambassador has BOTH codes, we surface a secondary card so they
 *   can switch audiences (e.g., a shopper who landed on the seller link can
 *   still pick "I'd rather shop").
 *
 * This unifies the ambassador's shareable surface to a single link they can
 * post anywhere, instead of having to choose between two codes per audience.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowRight, ShoppingBag, Store } from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTranslation } from "@/src/i18n";
import { resolveCode, ResolveCodeResponse } from "@/src/lib/ambassadors";
import { api } from "@/src/lib/api";
import { captureRefFromResolved } from "@/src/lib/ref";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function AmbassadorSmartLink() {
  const { code: rawCode } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const code = (typeof rawCode === "string" ? rawCode : "").toUpperCase().trim();

  const [resolved, setResolved] = useState<ResolveCodeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!code) {
      setError("missing");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await resolveCode(code);
        if (!active) return;
        setResolved(r);
        // Fire-and-forget impression beacon for ambassador-dashboard analytics.
        // Pass UTM params + referrer so the dashboard can show which channel
        // (Instagram / WhatsApp / DM / …) drove this click.
        const sourceBody: Record<string, string> = {};
        try {
          if (typeof window !== "undefined" && window.location) {
            const q = new URLSearchParams(window.location.search);
            const utmSource = q.get("utm_source");
            const utmMedium = q.get("utm_medium");
            const utmCampaign = q.get("utm_campaign");
            if (utmSource) sourceBody.utm_source = utmSource;
            if (utmMedium) sourceBody.utm_medium = utmMedium;
            if (utmCampaign) sourceBody.utm_campaign = utmCampaign;
            const ref = (document?.referrer || "").trim();
            if (ref) sourceBody.referrer = ref;
          }
        } catch {
          /* no-op — beacon is fire-and-forget */
        }
        api(`/ambassadors/track-visit/${encodeURIComponent(r.code)}`, {
          method: "POST",
          auth: false,
          body: sourceBody,
        }).catch(() => { /* analytics are best-effort */ });
        // Persist to the canonical `allsale_ref_v1` storage so the cart
        // auto-apply (CartContext.maybeAutoApplyRef) and seller-signup
        // pre-fill both pick it up. 90-day TTL.
        try {
          await captureRefFromResolved({
            code: r.code,
            name: r.name,
            program: r.program,
            primary_platform: r.primary_platform,
          });
        } catch {
          /* storage may be unavailable in private mode — non-fatal */
        }
      } catch (e: any) {
        if (active) setError(e?.message || "not_found");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [code]);

  const onShop = async () => {
    router.replace("/(tabs)/home");
  };

  const onSell = async () => {
    // Forward the ambassador code so the seller signup form can auto-fill
    // the referral input and credit the ambassador with the recruitment.
    const refCode = resolved?.code || code;
    router.replace(`/seller/welcome?ref=${encodeURIComponent(refCode)}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !resolved) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Code not found</Text>
          <Text style={styles.errorBody}>
            {code
              ? `“${code}” isn’t an active Allsale ambassador code.`
              : "No code provided."}
          </Text>
          <Pressable
            onPress={() => router.replace("/(tabs)/home")}
            style={({ pressed }) => [
              styles.primaryCta,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryCtaText}>Continue to Allsale</Text>
            <ArrowRight size={16} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isB2C = resolved.type === "b2c";
  const primaryAction = isB2C
    ? { label: "Shop now", subtitle: `Get 5% off your first order with ${resolved.name}'s code`, onPress: onShop, Icon: ShoppingBag, accent: colors.primary }
    : { label: "Sell on Allsale", subtitle: `Get 3 months Pro free when ${resolved.name} brings your business in`, onPress: onSell, Icon: Store, accent: "#2563EB" };

  const hasSecondary = !!resolved.counterpart_code;
  const secondaryAction = !hasSecondary
    ? null
    : isB2C
      ? { label: "Or… own a business in India? Sell on Allsale", onPress: onSell, Icon: Store }
      : { label: "Or… just want to shop? Browse Allsale", onPress: onShop, Icon: ShoppingBag };

  const platformName = (() => {
    switch ((resolved.primary_platform || "").toLowerCase()) {
      case "instagram": return "Instagram";
      case "tiktok": return "TikTok";
      case "youtube": return "YouTube";
      case "facebook": return "Facebook";
      default: return null;
    }
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>INVITED BY</Text>
          <Text style={styles.heroName}>{resolved.name}</Text>
          {platformName ? (
            <Text style={styles.heroPlatform}>via {platformName}</Text>
          ) : null}
          <View style={styles.codePill}>
            <Text style={styles.codePillLabel}>
              {isB2C ? "CUSTOMER CODE" : "SELLER-RECRUIT CODE"}
            </Text>
            <Text style={styles.codePillValue}>{resolved.code}</Text>
          </View>
        </View>

        <Pressable
          testID="smartlink-primary-cta"
          onPress={primaryAction.onPress}
          style={({ pressed }) => [
            styles.primaryCard,
            { backgroundColor: primaryAction.accent },
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <View style={styles.primaryCardIcon}>
            <primaryAction.Icon size={28} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.primaryCardTitle}>{primaryAction.label}</Text>
            <Text style={styles.primaryCardSubtitle}>{primaryAction.subtitle}</Text>
          </View>
          <ArrowRight size={20} color="#fff" />
        </Pressable>

        {secondaryAction ? (
          <Pressable
            testID="smartlink-secondary-cta"
            onPress={secondaryAction.onPress}
            style={({ pressed }) => [
              styles.secondaryCard,
              pressed && { opacity: 0.85 },
            ]}
          >
            <secondaryAction.Icon size={16} color={colors.primary} />
            <Text style={styles.secondaryCardText}>{secondaryAction.label}</Text>
            <ArrowRight size={14} color={colors.primary} />
          </Pressable>
        ) : null}

        <View style={styles.tipBox}>
          <Text style={styles.tipText}>
            🇮🇳 <Text style={styles.tipBold}>Allsale</Text> connects Indian
            sellers with NZ + global shoppers. Quality goods, transparent
            pricing, and door-to-door delivery.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorBox: {
    flex: 1,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  errorTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  errorBody: { fontSize: 14, color: colors.textMuted, textAlign: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md },
  hero: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: 6,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 1.5,
  },
  heroName: { fontSize: 28, fontWeight: "900", color: colors.text },
  heroPlatform: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  codePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 4,
  },
  codePillLabel: { fontSize: 10, fontWeight: "800", color: colors.primary, letterSpacing: 0.5 },
  codePillValue: { fontSize: 13, fontWeight: "900", color: colors.text, letterSpacing: 1 },
  primaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  primaryCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryCardTitle: { color: "#fff", fontWeight: "900", fontSize: 18 },
  primaryCardSubtitle: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 2, lineHeight: 16 },
  secondaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  secondaryCardText: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.text },
  tipBox: {
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  tipText: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  tipBold: { fontWeight: "800", color: colors.text },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    marginTop: spacing.md,
  },
  primaryCtaText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
