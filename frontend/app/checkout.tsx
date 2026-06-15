import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { ChevronLeft, CreditCard, Lock, Truck } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCart } from "@/src/contexts/CartContext";
import ShippingSelector, { ShippingOption } from "@/src/components/ShippingSelector";
import { useTranslation } from "@/src/i18n";
import { api, ORIGIN_URL } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

export default function Checkout() {
  const router = useRouter();
  const { cart, refresh } = useCart();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shipOpt, setShipOpt] = useState<ShippingOption | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("Auckland");
  const [postcode, setPostcode] = useState("");

  const submit = async () => {
    setErr("");
    if (!fullName || !phone || !line1 || !city || !postcode) {
      setErr(t("checkout.complete_shipping"));
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ url: string; session_id: string; order_id: string }>(
        "/checkout/session",
        {
          method: "POST",
          body: {
            address: {
              full_name: fullName,
              phone,
              line1,
              line2,
              city,
              region,
              postcode,
              country: "New Zealand",
            },
            origin_url: ORIGIN_URL,
            shipping_tier: shipOpt?.tier ?? null,
            shipping_courier_id: shipOpt?.courier_id ?? null,
            shipping_courier_name: shipOpt?.courier_name ?? null,
            // Override cart's shipping_nzd with the user's chosen tier (in NZD).
            // The server already has the buyer currency price; we send NZD because backend stores NZD.
            // Convert rate_in_currency back to NZD using fx if currency != NZD.
            shipping_cost_nzd: shipOpt?.free ? 0 : (shipOpt?.rate_in_currency ?? null),
          },
        },
      );
      const result = await WebBrowser.openAuthSessionAsync(res.url, `${ORIGIN_URL}/checkout/success`);
      // After the browser closes (success, cancel, or dismiss), navigate to status screen.
      if (result.type === "success" || result.type === "dismiss") {
        await refresh();
        router.replace({ pathname: "/checkout-status", params: { session_id: res.session_id } });
      }
    } catch (e: any) {
      setErr(e?.message || t("checkout.could_not_start"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable testID="checkout-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("checkout.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>{t("checkout.shipping_to")}</Text>

          <Field label={t("checkout.full_name")} testID="checkout-name" value={fullName} onChangeText={setFullName} />
          <Field
            label={t("checkout.phone")}
            testID="checkout-phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <Field label={t("checkout.address_line1")} testID="checkout-line1" value={line1} onChangeText={setLine1} />
          <Field
            label={t("checkout.address_line2")}
            testID="checkout-line2"
            value={line2}
            onChangeText={setLine2}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field label={t("checkout.city")} testID="checkout-city" value={city} onChangeText={setCity} />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t("checkout.postcode")}
                testID="checkout-postcode"
                value={postcode}
                onChangeText={setPostcode}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <Field label={t("checkout.region")} testID="checkout-region" value={region} onChangeText={setRegion} />

          <ShippingSelector
            country="NZ"
            currency="NZD"
            weightKg={Math.max(0.5, cart.items.reduce((a, it) => a + (it.quantity || 1), 0) * 0.5)}
            subtotal={cart.subtotal_nzd}
            onSelect={setShipOpt}
            selectedTier={shipOpt?.tier}
          />

          <View style={styles.summaryCard}>
            <View style={styles.summaryHead}>
              <Truck size={16} color={colors.primary} />
              <Text style={styles.summaryHeadText}>{t("checkout.order_summary")}</Text>
            </View>
            <Line label={t("checkout.items_subtotal", { count: cart.items.length })} value={formatNZD(cart.subtotal_nzd)} />
            <Line
              label={shipOpt ? `${shipOpt.label} shipping` : t("checkout.shipping_to_nz")}
              value={
                shipOpt
                  ? shipOpt.free
                    ? t("checkout.free")
                    : formatNZD(shipOpt.rate_in_currency)
                  : cart.shipping_nzd === 0
                  ? t("checkout.free")
                  : formatNZD(cart.shipping_nzd)
              }
              highlight={shipOpt?.free || cart.shipping_nzd === 0}
            />
            <View style={styles.lineDivider} />
            <Line
              label={t("checkout.total_nzd")}
              value={formatNZD(
                cart.subtotal_nzd +
                  (shipOpt ? (shipOpt.free ? 0 : shipOpt.rate_in_currency) : cart.shipping_nzd) -
                  (cart.discount_nzd || 0) -
                  (cart.points_discount_nzd || 0),
              )}
              bold
            />
          </View>

          {err ? <Text style={styles.error} testID="checkout-error">{err}</Text> : null}

          <Pressable
            testID="checkout-pay-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [
              styles.cta,
              pressed && { transform: [{ scale: 0.98 }] },
              busy && { opacity: 0.7 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <CreditCard size={18} color="#fff" />
                <Text style={styles.ctaText}>{t("checkout.pay", { amount: formatNZD(cart.total_nzd) })}</Text>
              </>
            )}
          </Pressable>

          <View style={styles.lockRow}>
            <Lock size={12} color={colors.textMuted} />
            <Text style={styles.lockText}>{t("checkout.secure_payment")}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  testID,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  testID: string;
  value: string;
  onChangeText: (s: string) => void;
  keyboardType?: "default" | "phone-pad" | "number-pad" | "email-address";
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType || "default"}
        style={styles.input}
        placeholderTextColor={colors.textFaint}
      />
    </View>
  );
}

function Line({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineBold]}>{label}</Text>
      <Text
        style={[
          styles.lineValue,
          bold && styles.lineBold,
          highlight && { color: colors.success, fontWeight: "800" },
        ]}
      >
        {value}
      </Text>
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
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginBottom: spacing.md, letterSpacing: -0.2 },
  label: { fontSize: 12, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
  },
  summaryCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  summaryHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  summaryHeadText: { fontSize: 12, fontWeight: "800", color: colors.text, letterSpacing: 0.5 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  lineLabel: { fontSize: 13, color: colors.textMuted },
  lineValue: { fontSize: 13, color: colors.text, fontWeight: "600" },
  lineBold: { fontSize: 16, fontWeight: "800", color: colors.text },
  lineDivider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.lg,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  lockRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, marginTop: spacing.md },
  lockText: { fontSize: 11, color: colors.textMuted },
});
