import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowRight, Globe2, ShieldCheck, Truck } from "lucide-react-native";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GoogleSignInButton } from "@/src/components/GoogleSignInButton";
import { colors, radius, spacing } from "@/src/lib/theme";

const HERO_IMG =
  "https://images.unsplash.com/photo-1717585679395-bbe39b5fb6bc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDF8MHwxfHNlYXJjaHwzfHxpbmRpYW4lMjBldGhuaWMlMjB3ZWFyJTIwZmFzaGlvbnxlbnwwfHx8fDE3ODExMzIyNjl8MA&ixlib=rb-4.1.0&q=85";

export default function Welcome() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.heroWrap}>
        <Image source={{ uri: HERO_IMG }} style={styles.hero} />
        <LinearGradient
          colors={["rgba(10,10,10,0)", "rgba(10,10,10,0.65)", "rgba(10,10,10,0.95)"]}
          style={styles.gradient}
        />
        <View style={styles.brandRow}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>allsale</Text>
        </View>
        <View style={styles.heroContent}>
          <Text style={styles.eyebrow}>INDIA → NEW ZEALAND</Text>
          <Text style={styles.heroTitle}>
            Authentic India,{"\n"}delivered to your door.
          </Text>
          <Text style={styles.heroSubtitle}>
            Sarees, brass, spices and more from trusted Indian artisans — shipped fast to NZ.
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.usp}>
          <Bullet icon={<Globe2 size={18} color={colors.primary} />} text="Direct from Indian sellers" />
          <Bullet icon={<Truck size={18} color={colors.primary} />} text="Shipping to NZ in 7-14 days" />
          <Bullet icon={<ShieldCheck size={18} color={colors.primary} />} text="Secure payments in NZD" />
        </View>

        <Pressable
          testID="welcome-get-started-btn"
          onPress={() => router.push("/(auth)/register")}
          style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Text style={styles.ctaText}>Get started with email</Text>
          <ArrowRight size={20} color="#fff" />
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <GoogleSignInButton
          testID="welcome-google-btn"
          label="Continue with Google"
          redirectTo="/(tabs)/home"
        />

        <Pressable
          testID="welcome-signin-btn"
          onPress={() => router.push("/(auth)/login")}
          style={styles.secondaryCta}
        >
          <Text style={styles.secondaryText}>
            Already shopping with us? <Text style={styles.secondaryLink}>Sign in</Text>
          </Text>
        </Pressable>
      </View>
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
  brandDot: { width: 10, height: 10, backgroundColor: colors.primary, borderRadius: 999 },
  brandText: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.5 },
  heroContent: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.xl },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginBottom: 8 },
  heroTitle: { color: "#fff", fontSize: 32, fontWeight: "800", lineHeight: 38, letterSpacing: -0.8 },
  heroSubtitle: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 12, lineHeight: 20 },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl, justifyContent: "space-between" },
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
  secondaryCta: { alignItems: "center", paddingVertical: spacing.lg, marginBottom: spacing.sm },
  secondaryText: { color: colors.textMuted, fontSize: 14 },
  secondaryLink: { color: colors.primary, fontWeight: "700" },
});
