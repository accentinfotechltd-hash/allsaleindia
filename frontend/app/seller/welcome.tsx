import { useRouter } from "expo-router";
import { ChevronLeft, FileCheck, Globe2, ShieldCheck, Store } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function SellerWelcome() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();

  const continueLabel = user
    ? user.is_seller
      ? t("seller_welcome.cta_open_dashboard")
      : t("seller_welcome.cta_continue_as", { name: user.full_name.split(" ")[0] })
    : t("seller_welcome.cta_create_account");

  const onContinue = () => {
    if (!user) router.push("/seller/signup");
    else if (user.is_seller) router.push("/seller/dashboard");
    else router.push("/seller/upgrade");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable testID="seller-welcome-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.brand}>{t("seller_welcome.brand")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroIcon}>
          <Store size={28} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t("seller_welcome.title")}</Text>
        <Text style={styles.subtitle}>
          {t("seller_welcome.subtitle")}
        </Text>

        <View style={styles.requirements}>
          <Text style={styles.sectionTitle}>{t("seller_welcome.youll_need")}</Text>
          <Row
            icon={<Globe2 size={16} color={colors.primary} />}
            title={t("seller_welcome.req1_title")}
            body={t("seller_welcome.req1_body")}
          />
          <Row
            icon={<FileCheck size={16} color={colors.primary} />}
            title={t("seller_welcome.req2_title")}
            body={t("seller_welcome.req2_body")}
          />
          <Row
            icon={<ShieldCheck size={16} color={colors.primary} />}
            title={t("seller_welcome.req3_title")}
            body={t("seller_welcome.req3_body")}
          />
        </View>

        <View style={styles.policy}>
          <Text style={styles.policyTitle}>{t("seller_welcome.policy_title")}</Text>
          <Text style={styles.policyText}>
            {t("seller_welcome.policy_text")}
          </Text>
        </View>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.bottomBar}>
        <Pressable
          testID="seller-welcome-continue-btn"
          onPress={onContinue}
          style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Text style={styles.ctaText}>{continueLabel}</Text>
        </Pressable>
        {!user ? (
          <Pressable
            testID="seller-welcome-login-link"
            onPress={() => router.push("/(auth)/login")}
            style={styles.secondaryLink}
          >
            <Text style={styles.secondaryText}>
              {t("seller_welcome.already_have_account")}<Text style={styles.linkText}>{t("seller_welcome.sign_in")}</Text>
            </Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Row({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 16, fontWeight: "800", color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 140 },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  title: { fontSize: 30, fontWeight: "800", color: colors.text, letterSpacing: -0.8, lineHeight: 36, marginTop: spacing.lg },
  subtitle: { fontSize: 15, color: colors.textMuted, lineHeight: 22, marginTop: spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: spacing.md, letterSpacing: 0.5 },
  requirements: { marginTop: spacing.xl, gap: spacing.md },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  rowBody: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  policy: { marginTop: spacing.xl, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg },
  policyTitle: { fontSize: 13, fontWeight: "800", color: colors.text },
  policyText: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 18 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryLink: { alignItems: "center", paddingVertical: spacing.md },
  secondaryText: { color: colors.textMuted, fontSize: 13 },
  linkText: { color: colors.primary, fontWeight: "700" },
});
