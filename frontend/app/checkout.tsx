import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import {
  Bookmark,
  CheckSquare,
  ChevronLeft,
  CreditCard,
  Lock,
  Sparkles,
  Square,
  Truck,
} from "lucide-react-native";
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

import PointsRedeemInput from "@/src/components/PointsRedeemInput";
import PlacesAutocomplete, {
  ResolvedAddress,
} from "@/src/components/PlacesAutocomplete";
import SavedAddressesPicker, {
  SavedAddress,
} from "@/src/components/SavedAddressesPicker";
import ShippingSelector, { ShippingOption } from "@/src/components/ShippingSelector";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useCart } from "@/src/contexts/CartContext";
import { useTranslation } from "@/src/i18n";
import { api, ORIGIN_URL } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

// ISO-2 → long name expected by the checkout/session backend.
const ISO_TO_LONG_COUNTRY: Record<string, string> = {
  NZ: "New Zealand",
  AU: "Australia",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  IN: "India",
};

export default function Checkout() {
  const router = useRouter();
  const { cart, refresh } = useCart();
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shipOpt, setShipOpt] = useState<ShippingOption | null>(null);

  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(null);
  const [saveAddress, setSaveAddress] = useState(true);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("Auckland");
  const [postcode, setPostcode] = useState("");
  const [country, setCountry] = useState<string>("NZ");

  const onPickAddress = (a: SavedAddress | null) => {
    if (!a) {
      // Reset to fresh new-address state
      setSelectedAddrId(null);
      setFullName("");
      setPhone("");
      setLine1("");
      setLine2("");
      setCity("");
      setRegion("Auckland");
      setPostcode("");
      setCountry("NZ");
      setSaveAddress(true);
      return;
    }
    setSelectedAddrId(a.id);
    setFullName(a.full_name || "");
    setPhone(a.phone || "");
    setLine1(a.line1 || "");
    setLine2(a.line2 || "");
    setCity(a.city || "");
    setRegion(a.state || "");
    setPostcode(a.postal_code || "");
    setCountry((a.country || "NZ").toUpperCase().slice(0, 2));
    // Already saved — no need to re-save by default
    setSaveAddress(false);
  };

  const persistNewAddress = async () => {
    // Best-effort save — never block the order on a save failure.
    try {
      await api("/account/addresses", {
        method: "POST",
        body: {
          label: `${city || "My address"} · ${postcode}`.slice(0, 60),
          full_name: fullName,
          phone,
          line1,
          line2,
          city,
          state: region,
          postal_code: postcode,
          country: (country || "NZ").toUpperCase().slice(0, 2),
          is_default: false,
        },
      });
    } catch {
      // silent
    }
  };

  const submit = async () => {
    setErr("");
    if (!fullName || !phone || !line1 || !city || !postcode) {
      setErr(t("checkout.complete_shipping"));
      return;
    }
    setBusy(true);
    try {
      // If user typed a new address and opted to save it, persist before checkout.
      if (!selectedAddrId && saveAddress) {
        await persistNewAddress();
      }

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
              country:
                ISO_TO_LONG_COUNTRY[country?.toUpperCase() || "NZ"] || "New Zealand",
            },
            origin_url: ORIGIN_URL,
            shipping_tier: shipOpt?.tier ?? null,
            shipping_courier_id: shipOpt?.courier_id ?? null,
            shipping_courier_name: shipOpt?.courier_name ?? null,
            shipping_cost_nzd: shipOpt?.free
              ? 0
              : shipOpt?.rate_in_currency ?? null,
          },
        },
      );
      const result = await WebBrowser.openAuthSessionAsync(
        res.url,
        `${ORIGIN_URL}/checkout/success`,
      );
      if (result.type === "success" || result.type === "dismiss") {
        await refresh();
        router.replace({
          pathname: "/checkout-status",
          params: { session_id: res.session_id },
        });
      }
    } catch (e: any) {
      setErr(e?.message || t("checkout.could_not_start"));
      toast.show({
        title: "Couldn't start checkout",
        body: e?.message,
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const computedTotal =
    cart.subtotal_nzd +
    (shipOpt ? (shipOpt.free ? 0 : shipOpt.rate_in_currency) : cart.shipping_nzd) -
    (cart.discount_nzd || 0) -
    (cart.points_discount_nzd || 0) +
    (cart.gift_wrap_fee_nzd || 0);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="checkout-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
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
          contentContainerStyle={{
            padding: spacing.lg,
            paddingBottom: spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>{t("checkout.shipping_to")}</Text>

          <SavedAddressesPicker
            selectedId={selectedAddrId}
            onSelect={onPickAddress}
          />

          <Field
            label={t("checkout.full_name")}
            testID="checkout-name"
            value={fullName}
            onChangeText={setFullName}
          />
          <Field
            label={t("checkout.phone")}
            testID="checkout-phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <PlacesAutocomplete
            label={t("checkout.address_line1")}
            testID="checkout-line1"
            initialValue={line1}
            country={country}
            onChangeText={setLine1}
            onResolved={(addr: ResolvedAddress) => {
              setLine1(addr.line1 || addr.formatted);
              if (addr.line2) setLine2(addr.line2);
              if (addr.city) setCity(addr.city);
              if (addr.region) setRegion(addr.region);
              if (addr.postal_code) setPostcode(addr.postal_code);
              if (addr.country) {
                setCountry(addr.country.toUpperCase().slice(0, 2));
              }
              // User picked from autocomplete — treat as new address (not a
              // pre-saved one) so the "Save this address" toggle reappears.
              setSelectedAddrId(null);
            }}
          />
          <Field
            label={t("checkout.address_line2")}
            testID="checkout-line2"
            value={line2}
            onChangeText={setLine2}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field
                label={t("checkout.city")}
                testID="checkout-city"
                value={city}
                onChangeText={setCity}
              />
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
          <Field
            label={t("checkout.region")}
            testID="checkout-region"
            value={region}
            onChangeText={setRegion}
          />

          {!selectedAddrId ? (
            <Pressable
              testID="checkout-save-address-toggle"
              onPress={() => setSaveAddress((v) => !v)}
              style={styles.saveToggle}
            >
              {saveAddress ? (
                <CheckSquare size={18} color={colors.primary} />
              ) : (
                <Square size={18} color={colors.textMuted} />
              )}
              <Bookmark
                size={14}
                color={saveAddress ? colors.primary : colors.textMuted}
              />
              <Text
                style={[
                  styles.saveToggleText,
                  saveAddress && { color: colors.primary, fontWeight: "800" },
                ]}
              >
                Save this address for faster checkout next time
              </Text>
            </Pressable>
          ) : null}

          <ShippingSelector
            country="NZ"
            currency="NZD"
            weightKg={Math.max(
              0.5,
              cart.items.reduce((a, it) => a + (it.quantity || 1), 0) * 0.5,
            )}
            subtotal={cart.subtotal_nzd}
            onSelect={setShipOpt}
            selectedTier={shipOpt?.tier}
          />

          {/* Loyalty points redemption */}
          <View style={styles.pointsCard} testID="checkout-points-card">
            <View style={styles.pointsHead}>
              <Sparkles size={14} color="#7C3AED" />
              <Text style={styles.pointsHeadText}>Loyalty rewards</Text>
            </View>
            <PointsRedeemInput />
          </View>

          <View style={styles.summaryCard}>
            <View style={styles.summaryHead}>
              <Truck size={16} color={colors.primary} />
              <Text style={styles.summaryHeadText}>
                {t("checkout.order_summary")}
              </Text>
            </View>
            <Line
              label={t("checkout.items_subtotal", { count: cart.items.length })}
              value={formatNZD(cart.subtotal_nzd)}
            />
            <Line
              label={
                shipOpt
                  ? `${shipOpt.label} shipping`
                  : t("checkout.shipping_to_nz")
              }
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
            {(cart.discount_nzd || 0) > 0 ? (
              <Line
                label={
                  cart.coupon_code
                    ? `Coupon (${cart.coupon_code})`
                    : "Discount"
                }
                value={`-${formatNZD(cart.discount_nzd || 0)}`}
                highlight
              />
            ) : null}
            {(cart.points_discount_nzd || 0) > 0 ? (
              <Line
                label={`Loyalty points (-${cart.points_used} pts)`}
                value={`-${formatNZD(cart.points_discount_nzd || 0)}`}
                highlight
              />
            ) : null}
            {(cart.gift_wrap_fee_nzd || 0) > 0 ? (
              <Line
                label={`🎁 Gift wrap × ${cart.gift_wrap_count || 0}`}
                value={`+${formatNZD(cart.gift_wrap_fee_nzd || 0)}`}
              />
            ) : null}
            <View style={styles.lineDivider} />
            <Line
              label={t("checkout.total_nzd")}
              value={formatNZD(Math.max(0, computedTotal))}
              bold
            />
          </View>

          {err ? (
            <Text style={styles.error} testID="checkout-error">
              {err}
            </Text>
          ) : null}

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
                <Text style={styles.ctaText}>
                  {t("checkout.pay", {
                    amount: formatNZD(Math.max(0, computedTotal)),
                  })}
                </Text>
              </>
            )}
          </Pressable>

          <View style={styles.lockRow}>
            <Lock size={12} color={colors.textMuted} />
            <Text style={styles.lockText}>
              {t("checkout.secure_payment")}
            </Text>
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
    marginBottom: spacing.md,
    letterSpacing: -0.2,
  },
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
  saveToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    marginBottom: spacing.sm,
  },
  saveToggleText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "600",
    flex: 1,
  },
  pointsCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: "#FAF5FF",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#E9D5FF",
  },
  pointsHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  pointsHeadText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.5,
  },
  summaryCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  summaryHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  summaryHeadText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 0.5,
  },
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
  lockRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  lockText: { fontSize: 11, color: colors.textMuted },
});
