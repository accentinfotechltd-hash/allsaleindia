import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@/src/lib/theme";

const SECTIONS: { h: string; b: string[] }[] = [
  { h: "1. Acceptance", b: [
    "By using Allsale (the mobile app or website), you agree to these Terms. If you don't agree, please don't use the platform.",
    "Allsale is operated by Allsale Ltd, registered in New Zealand. Contact: support@allsale.co.nz",
  ]},
  { h: "2. Eligibility", b: [
    "You must be 16+ to use Allsale.",
    "Buyer accounts are open to residents of NZ, AU, US, UK, CA and IN.",
    "Seller accounts are restricted to verified Indian businesses with valid GST and address proof.",
  ]},
  { h: "3. Our role", b: [
    "Allsale is a marketplace platform. We connect Indian sellers with global buyers, but we are NOT the seller of the products.",
    "Each seller is responsible for the accuracy of their listings, product quality, and after-sale support.",
    "Allsale collects payments on behalf of sellers and routes them after the return window closes (see Seller Policy).",
  ]},
  { h: "4. Pricing & currency", b: [
    "Product base prices are set in NZD (or INR for the seller). Prices in AUD/USD/GBP/CAD are auto-calculated using live FX rates (refreshed daily via Frankfurter API).",
    "Final price you pay = product + shipping + taxes (if any) + customs duties (for international orders).",
    "Any flash sale or coupon discount is shown clearly at checkout before you pay.",
  ]},
  { h: "5. Orders & payment", b: [
    "All payments are processed by Stripe in your local currency.",
    "Once paid, you receive an order confirmation. If we can't fulfill the order (out of stock etc.), we'll refund within 7 business days.",
    "Loyalty Points: 1 pt earned per $1 NZD spent · 100 pts = $1 NZD discount · 50% max redemption per order · 12-month expiry.",
  ]},
  { h: "6. Shipping & delivery", b: [
    "International shipping is handled by Shiprocket X. Estimated delivery: 7-21 days depending on region.",
    "Customs duties or import taxes (if any) are the buyer's responsibility unless explicitly marked DDP at checkout.",
    "If your order is delayed or lost, contact us within 30 days of the ship-out date for resolution.",
  ]},
  { h: "7. Returns & refunds", b: [
    "Returns are accepted within 14 days of delivery for genuine product issues (wrong item, damaged, not as described).",
    "Buyer chooses refund method: original payment OR store credit (Allsale Wallet).",
    "See Return Policy for full details.",
  ]},
  { h: "8. Prohibited behaviour", b: [
    "Fake reviews, fake referrals, abusing coupons/points, scraping, or attempting to defraud sellers or buyers — all may result in account termination.",
    "Reselling without seller permission, listing counterfeit products, or violating intellectual property rights.",
  ]},
  { h: "9. Liability", b: [
    "To the maximum extent permitted by law, Allsale's total liability for any claim is capped at the value of the order in question.",
    "We are not liable for indirect or consequential damages.",
    "Acts of God, war, customs delays beyond our control are excluded.",
  ]},
  { h: "10. Governing law", b: [
    "These Terms are governed by the laws of New Zealand. Disputes are subject to NZ courts.",
  ]},
  { h: "11. Changes", b: [
    "We may update these Terms occasionally. We'll notify you in-app for material changes. Continued use = acceptance.",
  ]},
];

export default function TermsConditions() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.c} edges={["top"]}>
      <View style={s.h}>
        <Pressable onPress={() => router.back()} style={s.b}><ChevronLeft size={22} color={colors.text} /></Pressable>
        <Text style={s.t}>Terms & Conditions</Text>
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
