import { useRouter } from "expo-router";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type ConnectStatus = {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements: { currently_due?: string[]; past_due?: string[] } | null;
  account_id: string | null;
};

/**
 * Seller Stripe Connect onboarding screen.
 *
 * Flow:
 *   1. Calls GET /seller/stripe/connect/status to detect current state
 *   2. If not connected → "Connect Stripe" button → POST onboard → opens Stripe-hosted onboarding URL
 *   3. If connected but onboarding incomplete → "Continue setup" reopens onboarding link
 *   4. If fully active → green badge + "Open Stripe Dashboard" (login-link)
 */
export default function StripeConnectScreen() {
  const router = useRouter();
  const { show } = useToast();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<ConnectStatus>("/seller/stripe/connect/status");
      setStatus(d);
    } catch (e: any) {
      show({
        title: "Couldn't load Stripe status",
        message: e?.message,
        kind: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    load();
  }, [load]);

  const openOnboarding = async () => {
    setActing(true);
    try {
      const d = await api<{ url: string }>("/seller/stripe/connect/onboard", {
        method: "POST",
        body: {},
      });
      if (Platform.OS === "web") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).location.href = d.url;
      } else {
        await Linking.openURL(d.url);
      }
    } catch (e: any) {
      show({
        title: "Couldn't start Stripe onboarding",
        message: e?.message,
        kind: "error",
      });
    } finally {
      setActing(false);
    }
  };

  const openDashboard = async () => {
    setActing(true);
    try {
      const d = await api<{ url: string }>("/seller/stripe/connect/login-link", {
        method: "POST",
        body: {},
      });
      if (Platform.OS === "web") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).open?.(d.url, "_blank");
      } else {
        await Linking.openURL(d.url);
      }
    } catch (e: any) {
      show({
        title: "Couldn't open Stripe dashboard",
        message: e?.message,
        kind: "error",
      });
    } finally {
      setActing(false);
    }
  };

  const renderStateCard = () => {
    if (!status) return null;
    if (!status.connected) {
      return (
        <View style={[styles.stateCard, styles.stateMuted]}>
          <Banknote size={28} color={colors.textMuted} />
          <Text style={styles.stateTitle}>Get paid via Stripe</Text>
          <Text style={styles.stateBody}>
            Set up your payout account so we can release your earnings after each
            order&apos;s 14-day return window closes.
          </Text>
        </View>
      );
    }
    if (status.charges_enabled && status.payouts_enabled) {
      return (
        <View style={[styles.stateCard, styles.stateOk]}>
          <CheckCircle2 size={28} color="#16a34a" />
          <Text style={styles.stateTitle}>Stripe is active</Text>
          <Text style={styles.stateBody}>
            Your payouts are enabled. We&apos;ll route your share of each sale to
            your bank automatically.
          </Text>
        </View>
      );
    }
    const due = status.requirements?.currently_due || [];
    return (
      <View style={[styles.stateCard, styles.stateWarn]}>
        <AlertTriangle size={28} color="#b45309" />
        <Text style={styles.stateTitle}>Finish your setup</Text>
        <Text style={styles.stateBody}>
          {status.details_submitted
            ? "Stripe needs a few more details before payouts can be enabled."
            : "You started onboarding but didn't finish — tap below to continue."}
        </Text>
        {due.length > 0 && (
          <View style={styles.dueWrap}>
            {due.slice(0, 5).map((d) => (
              <View key={d} style={styles.duePill}>
                <Text style={styles.duePillText}>{d.replace(/_/g, " ")}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          testID="stripe-connect-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Payouts &amp; bank</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {renderStateCard()}

            <View style={styles.actions}>
              {!status?.connected ? (
                <Pressable
                  testID="stripe-connect-start"
                  onPress={openOnboarding}
                  disabled={acting}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.85 },
                    acting && { opacity: 0.7 },
                  ]}
                >
                  {acting ? (
                    <Loader2 size={18} color="#fff" />
                  ) : (
                    <Banknote size={18} color="#fff" />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {acting ? "Starting…" : "Connect Stripe"}
                  </Text>
                </Pressable>
              ) : !(status.charges_enabled && status.payouts_enabled) ? (
                <Pressable
                  testID="stripe-connect-continue"
                  onPress={openOnboarding}
                  disabled={acting}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.85 },
                    acting && { opacity: 0.7 },
                  ]}
                >
                  <ExternalLink size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {acting ? "Loading…" : "Continue setup"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  testID="stripe-connect-dashboard"
                  onPress={openDashboard}
                  disabled={acting}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.85 },
                    acting && { opacity: 0.7 },
                  ]}
                >
                  <ExternalLink size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {acting ? "Opening…" : "Open Stripe Dashboard"}
                  </Text>
                </Pressable>
              )}

              <Pressable
                testID="stripe-connect-refresh"
                onPress={load}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.secondaryBtnText}>Refresh status</Text>
              </Pressable>
            </View>

            <View style={styles.infoCard}>
              <ShieldCheck size={18} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.infoTitle}>How payouts work</Text>
                <Text style={styles.infoBody}>
                  After each order delivers, we hold the buyer&apos;s payment in
                  escrow for 14 days (the return window). Once the window closes
                  with no return, we release your earnings — automatically — to
                  your Stripe-linked bank account every Tuesday.
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <Banknote size={18} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.infoTitle}>Fees</Text>
                <Text style={styles.infoBody}>
                  Allsale&apos;s marketplace commission is 12% of the product
                  price (excluding shipping). Stripe&apos;s standard processing
                  fee is paid by Allsale — never deducted from your payout.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  center: { padding: spacing.xl, alignItems: "center" },

  stateCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 10,
    alignItems: "flex-start",
    borderWidth: 1,
  },
  stateMuted: { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" },
  stateOk: { backgroundColor: "#dcfce7", borderColor: "#bbf7d0" },
  stateWarn: { backgroundColor: "#fef3c7", borderColor: "#fde68a" },
  stateTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  stateBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  dueWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  duePill: {
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  duePillText: { fontSize: 11, fontWeight: "700", color: "#92400e" },

  actions: { marginTop: spacing.lg, gap: 10 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondaryBtn: {
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.text, fontSize: 14, fontWeight: "700" },

  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff",
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  infoTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  infoBody: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginTop: 4 },
});
