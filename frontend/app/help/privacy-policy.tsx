import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/lib/theme";

const SECTIONS: { h: string; b: string[] }[] = [
  { h: "1. Who we are", b: [
    "Allsale is operated by Allsale Ltd (NZ), connecting verified Indian sellers with buyers in New Zealand, Australia, the United States, the United Kingdom, Canada and India.",
    "Contact: support@allsale.co.nz",
  ]},
  { h: "2. Information we collect", b: [
    "Account info — name, email, password (hashed), phone (optional), country, profile photo (if you sign in with Google).",
    "Order info — shipping address, billing details, items purchased, payment method (we never store full card numbers; that's handled by Stripe).",
    "Device info — IP address, device type, browser, app version, approximate location (used for currency & shipping estimates).",
    "Usage info — pages viewed, items wishlisted, reviews left, chats with sellers.",
    "Photos & videos you upload — review photos, return evidence, profile picture (stored on Cloudinary).",
  ]},
  { h: "3. How we use your data", b: [
    "Process orders and arrange shipping via Shiprocket.",
    "Detect your country to show the right currency and shipping options.",
    "Send transactional emails (order confirmations, refund updates, returns).",
    "Detect fraud and abuse.",
    "Improve product recommendations (no AI training on personal data).",
  ]},
  { h: "4. Who we share with", b: [
    "Sellers — only the shipping address and order details for products you bought from them.",
    "Stripe — for processing payments (their privacy policy applies).",
    "Shiprocket — for shipping labels and tracking.",
    "Cloudinary — for image hosting.",
    "Government authorities — only when legally required.",
    "We do NOT sell your data to advertisers.",
  ]},
  { h: "5. Your rights", b: [
    "Access — request a copy of your data.",
    "Delete — close your account and we'll remove personal data within 30 days (some order records kept for tax/legal reasons).",
    "Correct — update your profile anytime from Account settings.",
    "Opt-out — turn off promotional emails from Notifications settings.",
    "Email support@allsale.co.nz to exercise any of these rights.",
  ]},
  { h: "6. Data retention", b: [
    "Account data — kept while your account is active and for 12 months after closure.",
    "Order records — 7 years (legal/tax requirement).",
    "Marketing data — deleted on opt-out.",
  ]},
  { h: "7. Cookies", b: [
    "We use essential cookies for login and cart. Analytics cookies are anonymised. No third-party ad cookies.",
  ]},
  { h: "8. Cross-border transfers", b: [
    "Your data may be processed in India (sellers), New Zealand (us), Singapore (Cloudinary CDN) and the US (Stripe). All transfers use industry-standard encryption (TLS 1.2+).",
  ]},
  { h: "9. Children", b: [
    "Allsale is not intended for users under 16. We don't knowingly collect data from minors.",
  ]},
  { h: "10. Updates", b: [
    "We'll notify you in-app when this policy changes materially. Continued use means acceptance.",
  ]},
];

export default function PrivacyPolicy() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.c} edges={["top"]}>
      <View style={s.h}>
        <Pressable onPress={() => router.back()} style={s.b}><ChevronLeft size={22} color={colors.text} /></Pressable>
        <Text style={s.t}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.sc}>
        <Text style={s.date}>Last updated: June 2026</Text>
        {SECTIONS.map((sec) => (
          <View key={sec.h} style={s.section}>
            <Text style={s.head}>{sec.h}</Text>
            {sec.b.map((b, i) => <Text key={i} style={s.body}>• {b}</Text>)}
          </View>
        ))}
        <Text style={s.foot}>Questions? Email support@allsale.co.nz</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  c: { flex: 1, backgroundColor: colors.bg },
  h: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  b: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  t: { flex: 1, textAlign: "center", fontWeight: "800", fontSize: 16, color: colors.text },
  sc: { padding: spacing.lg, gap: spacing.md },
  date: { color: colors.textMuted, fontSize: 12, fontStyle: "italic" },
  section: { gap: 6 },
  head: { fontWeight: "800", color: colors.text, fontSize: 15, marginTop: spacing.sm },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  foot: { color: colors.textMuted, fontSize: 12, marginTop: spacing.lg, textAlign: "center", paddingBottom: spacing.xl },
});
