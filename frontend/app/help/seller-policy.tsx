import { useRouter } from "expo-router";
import { ChevronLeft, Shield } from "lucide-react-native";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/lib/theme";

const SECTIONS: { h: string; b: string[] }[] = [
  { h: "1. Eligibility", b: [
    "Sellers must be registered Indian businesses with valid GST and PAN.",
    "Verification includes: business name, GSTIN, address proof, bank account, owner KYC.",
    "We may reject or pause an account at any time for fraud, IP infringement, or repeated quality issues.",
  ]},
  { h: "2. Payment hold — IMPORTANT", b: [
    "Allsale collects the full order amount from the buyer at checkout via Stripe.",
    "Your earnings are HELD in escrow until the return window closes (typically 14 days after delivery).",
    "After the return window, your earnings are released to your Shiprocket payout wallet (or bank if configured).",
    "This protects buyers from non-delivery and protects sellers from chargebacks after dispatch.",
  ]},
  { h: "3. When you DON'T get paid", b: [
    "Order cancelled by buyer before dispatch — 100% refund to buyer, no payout to seller.",
    "Order cancelled by you (out of stock etc.) — 100% refund to buyer, plus a 5% inconvenience fee may apply.",
    "Order lost in transit — Shiprocket insurance kicks in; you still get paid once insurance settles.",
    "Buyer returns the item with valid reason (wrong/damaged/not as described) — full refund to buyer, you don't get paid for that item.",
    "Buyer returns with invalid reason — payout proceeds normally after Allsale review.",
    "Chargeback raised by buyer — payment frozen until resolution. If you win the dispute, payout resumes.",
  ]},
  { h: "4. Marketplace commission", b: [
    "Allsale takes 12% commission on the product price (excluding shipping).",
    "Shiprocket shipping cost is passed through at actual cost.",
    "Payment processor fee (Stripe ~2.9%) is borne by Allsale.",
  ]},
  { h: "5. Listing standards", b: [
    "Photos must be your own or licensed. No watermarks of competitors.",
    "Descriptions must be accurate. Misleading listings (wrong material, wrong size, fake brand) are grounds for delisting.",
    "Prohibited categories: counterfeits, weapons, drugs, hazardous materials, restricted exports.",
  ]},
  { h: "6. Fulfilment timelines", b: [
    "You must dispatch within 2 business days of receiving the order.",
    "Repeated delays (>3 in 30 days) may result in account suspension.",
    "Use the Bulk Upload feature to keep inventory accurate.",
  ]},
  { h: "7. Returns handling", b: [
    "You'll receive a notification when a buyer requests a return.",
    "You have 48 hours to approve or dispute the return.",
    "Disputes go to Allsale review — we'll evaluate evidence (photos/videos) and decide within 5 business days.",
  ]},
  { h: "8. Cancellation handling", b: [
    "Buyer can cancel for free until the order is marked 'shipped'.",
    "After dispatch, cancellation is treated as a return.",
    "You can refuse a return only with clear evidence (e.g. wrong item claimed but tracking shows correct item delivered).",
  ]},
  { h: "9. Payouts schedule", b: [
    "Payouts process every Tuesday for orders whose return window has closed.",
    "Minimum payout: ₹1,000.",
    "Failed payouts (wrong bank details) retry the next cycle. No fees.",
  ]},
  { h: "10. Termination", b: [
    "You can leave anytime — your pending orders complete, your final payout processes 14 days after the last delivery.",
    "We may terminate immediately for fraud, IP violations, or repeated quality complaints.",
  ]},
];

export default function SellerPolicy() {
  const router = useRouter();
  return (
    <SafeAreaView style={s.c} edges={["top"]}>
      <View style={s.h}>
        <Pressable onPress={() => router.back()} style={s.b}><ChevronLeft size={22} color={colors.text} /></Pressable>
        <Text style={s.t}>Seller Policy</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={s.sc}>
        <View style={s.intro}>
          <Shield size={20} color={colors.primary} />
          <Text style={s.introText}>Built on trust. Your earnings are protected and released after every buyer's return window closes — automatically.</Text>
        </View>
        <Text style={s.date}>Last updated: June 2026</Text>
        {SECTIONS.map((sec) => (
          <View key={sec.h} style={s.section}>
            <Text style={s.head}>{sec.h}</Text>
            {sec.b.map((b, i) => <Text key={i} style={s.body}>• {b}</Text>)}
          </View>
        ))}
        <Text style={s.foot}>Questions? Email sellers@allsale.co.nz</Text>
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
  intro: { flexDirection: "row", gap: 10, padding: spacing.md, backgroundColor: colors.primarySoft, borderRadius: radius.md, alignItems: "center" },
  introText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  date: { color: colors.textMuted, fontSize: 12, fontStyle: "italic" },
  section: { gap: 6 },
  head: { fontWeight: "800", color: colors.text, fontSize: 15, marginTop: spacing.sm },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  foot: { color: colors.textMuted, fontSize: 12, marginTop: spacing.lg, textAlign: "center", paddingBottom: spacing.xl },
});
