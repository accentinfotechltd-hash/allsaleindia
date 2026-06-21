import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowRight, Globe2, ShieldCheck, Truck } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

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
  const [langOpen, setLangOpen] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.heroWrap}>
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
  heroWrap: { height: "55%", backgroundColor: colors.black },
  hero: { width: "100%", height: "100%" },
  gradient: { position: "absolute", inset: 0 },
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
  heroContent: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.xl },
  eyebrow: { color: "#FFF8E7", fontSize: 11, fontWeight: "800", letterSpacing: 2, marginBottom: 8 },
  heroTitle: { color: "#fff", fontSize: 32, fontWeight: "800", lineHeight: 38, letterSpacing: -0.8 },
  heroSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 12, lineHeight: 20 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, justifyContent: "space-between" },
  usp: { gap: 14 },
  bullet: { flexDirection: "row", alignItems: "center", gap: 12 },
  bulletIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.xl,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: spacing.md,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  secondaryCta: { alignItems: "center", paddingVertical: spacing.md, marginBottom: spacing.xs },
  secondaryText: { color: colors.textMuted, fontSize: 14 },
  secondaryLink: { color: colors.primary, fontWeight: "700" },
});
