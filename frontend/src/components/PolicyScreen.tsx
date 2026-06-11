import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/lib/theme";

export type PolicySection = {
  heading: string;
  body?: string;
  bullets?: string[];
};

type Props = {
  title: string;
  intro?: string;
  effective?: string;
  sections: PolicySection[];
  testID?: string;
};

export default function PolicyScreen({ title, intro, effective, sections, testID }: Props) {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container} edges={["top"]} testID={testID}>
      <View style={styles.topBar}>
        <Pressable
          testID="policy-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hero}>{title}</Text>
        {effective ? <Text style={styles.eff}>{effective}</Text> : null}
        {intro ? <Text style={styles.intro}>{intro}</Text> : null}

        {sections.map((s, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.h2}>{s.heading}</Text>
            {s.body ? <Text style={styles.body}>{s.body}</Text> : null}
            {s.bullets?.map((b, j) => (
              <View key={j} style={styles.bulletRow}>
                <View style={styles.bulletDot} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>Need help?</Text>
          <Text style={styles.footerText}>
            Email support@allsale.co.nz — we usually reply within 24 hours.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: { fontSize: 16, fontWeight: "800", color: colors.text, flex: 1, textAlign: "center" },
  hero: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.6 },
  eff: { fontSize: 11, color: colors.textFaint, marginTop: 4, fontWeight: "700", letterSpacing: 0.5 },
  intro: { fontSize: 14, color: colors.textMuted, marginTop: spacing.md, lineHeight: 20 },
  section: { marginTop: spacing.xl },
  h2: { fontSize: 16, fontWeight: "800", color: colors.text, marginBottom: 8, letterSpacing: -0.2 },
  body: { fontSize: 13, color: colors.textMuted, lineHeight: 20 },
  bulletRow: { flexDirection: "row", gap: 10, marginTop: 8, alignItems: "flex-start" },
  bulletDot: { width: 6, height: 6, borderRadius: 999, backgroundColor: colors.primary, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 20 },
  footerCard: {
    marginTop: spacing.xxl,
    padding: spacing.lg,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
  },
  footerTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  footerText: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});
