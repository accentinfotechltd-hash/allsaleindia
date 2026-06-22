import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowRight, Globe2, ShieldCheck, Truck } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { GoogleSignInButton } from "@/src/components/GoogleSignInButton";
import { LanguagePicker, LanguagePill } from "@/src/components/LanguagePicker";
import { useTranslation } from "@/src/i18n";
import { AppleSignInButton } from "@/src/components/AppleSignInButton";
import { SellOnAllsaleBanner } from "@/src/components/SellOnAllsaleBanner";
import { colors, radius, spacing } from "@/src/lib/theme";

const HERO_IMG =
  "https://images.unsplash.com/photo-1696887484490-715e7eb0e682?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwxfHxUYWolMjBNYWhhbHxlbnwwfHx8b3JhbmdlfDE3ODEzMjg3ODB8MA&ixlib=rb-4.1.0&q=85";

export default function Welcome() {
  const { t } = useTranslation();
  const router = useRouter();
  const { height: vh } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [langOpen, setLangOpen] = useState(false);
  // Compact hero: 42% of viewport, capped at 380px on big phones and 280px
  // floor on small phones — leaves enough room for the full body content
  // (USPs + CTAs + Sell banner) to sit above the Android nav bar.
  const heroHeight = Math.max(280, Math.min(380, Math.round(vh * 0.42)));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scroll,
          // Reserve room for the Android gesture-nav / 3-button bar so the
          // last CTA (Sell banner / Sign-in link) is never partially hidden.
          { paddingBottom: Math.max(insets.bottom + 12, spacing.lg) },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={[styles.heroWrap, { height: heroHeight }]}>
          <Image source={{ uri: HERO_IMG }} style={styles.hero} />
          <LinearGradient
            colors={["rgba(10,10,10,0)", "rgba(10,10,10,0.65)", "rgba(10,10,10,0.95)"]}
            style={styles.gradient}
          />
          <View style={styles.brandRow}>
            <View style={styles.brandPill}>
              <Image
                source={require("@/assets/images/allsale-logo.png")}
                style={styles.brandLogo}
                resizeMode="contain"
              />
            </View>
          </View>
          <View style={styles.langRow}>
            <LanguagePill onPress={() => setLangOpen(true)} />
          </View>
          <View style={styles.heroContent}>
            <Text style={styles.eyebrow}>{t("auth.welcome_eyebrow")}</Text>
            <Text style={styles.heroTitle}>{t("auth.welcome_hero_title")}</Text>
            <Text style={styles.heroSubtitle}>{t("auth.welcome_hero_subtitle")}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.usp}>
            <Bullet
              icon={<Globe2 size={18} color={colors.primary} />}
              text={t("auth.welcome_usp_sellers")}
            />
            <Bullet
              icon={<Truck size={18} color={colors.primary} />}
              text={t("auth.welcome_usp_shipping")}
            />
            <Bullet
              icon={<ShieldCheck size={18} color={colors.primary} />}
              text={t("auth.welcome_usp_payments")}
            />
          </View>

          <Pressable
            testID="welcome-get-started-btn"
            onPress={() => router.push("/(auth)/register")}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            <Text style={styles.ctaText}>{t("auth.welcome_cta")}</Text>
            <ArrowRight size={20} color="#fff" />
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>{t("auth.welcome_or")}</Text>
            <View style={styles.dividerLine} />
          </View>

          <GoogleSignInButton
            testID="welcome-google-btn"
            label={t("auth.welcome_continue_google")}
            redirectTo="/(tabs)/home"
          />

          <AppleSignInButton
            testID="welcome-apple-btn"
            redirectTo="/(tabs)/home"
          />

          <Pressable
            testID="welcome-signin-btn"
            onPress={() => router.push("/(auth)/login")}
            style={styles.secondaryCta}
          >
            <Text style={styles.secondaryText}>
              {t("auth.welcome_continue_signin")}{" "}
              <Text style={styles.secondaryLink}>{t("auth.welcome_sign_in")}</Text>
            </Text>
          </Pressable>

          <SellOnAllsaleBanner testID="welcome-sell-banner" />
        </View>
      </ScrollView>

      <LanguagePicker visible={langOpen} onClose={() => setLangOpen(false)} />
    </SafeAreaView>
  );
}

function Bullet({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={styles.bulletIcon}>{icon}</View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, paddingBottom: spacing.lg },
  heroWrap: { width: "100%", backgroundColor: colors.black, overflow: "hidden" },
  hero: { width: "100%", height: "100%" },
  gradient: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  brandRow: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandPill: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  brandLogo: {
    width: 95,
    height: 42,
  },
  langRow: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
  },
  brandDot: { width: 10, height: 10, backgroundColor: colors.primary, borderRadius: 999 },
  brandText: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.5 },
  heroContent: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  eyebrow: { color: "#FFF8E7", fontSize: 11, fontWeight: "800", letterSpacing: 2, marginBottom: 6 },
  heroTitle: { color: "#fff", fontSize: 26, fontWeight: "800", lineHeight: 32, letterSpacing: -0.6 },
  heroSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 13, marginTop: 8, lineHeight: 18 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  usp: { gap: 10 },
  bullet: { flexDirection: "row", alignItems: "center", gap: 12 },
  bulletIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  cta: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.sm,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: spacing.xs,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  secondaryCta: { alignItems: "center", paddingVertical: spacing.xs },
  secondaryText: { color: colors.textMuted, fontSize: 13 },
  secondaryLink: { color: colors.primary, fontWeight: "700" },
});
