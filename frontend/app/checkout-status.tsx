import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, Clock, XCircle } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCart } from "@/src/contexts/CartContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Status = {
  session_id: string;
  order_id: string;
  payment_status: string; // paid | unpaid | initiated
  status: string;
  amount_total: number;
  currency: string;
};

const MAX_POLLS = 8;
const POLL_MS = 2000;

export default function CheckoutStatus() {
  const { session_id } = useLocalSearchParams<{ session_id: string }>();
  const router = useRouter();
  const { refresh } = useCart();
  const [status, setStatus] = useState<Status | null>(null);
  const [tries, setTries] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async (count: number) => {
      if (cancelled || !session_id) return;
      try {
        const s = await api<Status>(`/checkout/status/${session_id}`);
        if (cancelled) return;
        setStatus(s);
        setTries(count);
        if (s.payment_status === "paid") {
          await refresh();
          return;
        }
        if (count >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
      } catch {
        if (count >= MAX_POLLS) {
          setTimedOut(true);
          return;
        }
      }
      timer.current = setTimeout(() => poll(count + 1), POLL_MS);
    };
    poll(1);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [session_id, refresh]);

  const isPaid = status?.payment_status === "paid";
  const isUnpaid = !isPaid && (timedOut || status?.status === "expired");

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        {isPaid ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.successSoft }]}>
              <CheckCircle2 size={44} color={colors.success} strokeWidth={2} />
            </View>
            <Text style={styles.title} testID="checkout-success-title">Payment successful</Text>
            <Text style={styles.subtitle}>
              Your order is confirmed and on its way from India to your NZ doorstep.
            </Text>
            <Pressable
              testID="checkout-view-order-btn"
              onPress={() => router.replace(`/order/${status?.order_id}`)}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>View order</Text>
            </Pressable>
            <Pressable
              testID="checkout-continue-shopping-btn"
              onPress={() => router.replace("/(tabs)/home")}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryText}>Continue shopping</Text>
            </Pressable>
          </>
        ) : isUnpaid ? (
          <>
            <View style={[styles.iconCircle, { backgroundColor: "#FEE2E2" }]}>
              <XCircle size={44} color={colors.error} strokeWidth={2} />
            </View>
            <Text style={styles.title}>Payment not completed</Text>
            <Text style={styles.subtitle}>
              We didn&apos;t receive a payment confirmation. Your cart is still saved — try again whenever you&apos;re ready.
            </Text>
            <Pressable
              testID="checkout-retry-btn"
              onPress={() => router.replace("/(tabs)/cart")}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Back to cart</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.surface }]}>
              <Clock size={44} color={colors.textMuted} strokeWidth={2} />
            </View>
            <Text style={styles.title}>Confirming payment…</Text>
            <Text style={styles.subtitle}>Please wait while we verify your payment with Stripe.</Text>
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            <Text style={styles.pollText}>Attempt {tries} of {MAX_POLLS}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.5, textAlign: "center" },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: spacing.sm, textAlign: "center", lineHeight: 20 },
  pollText: { fontSize: 12, color: colors.textFaint, marginTop: spacing.md },
  cta: {
    backgroundColor: colors.primary,
    height: 52,
    paddingHorizontal: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: { marginTop: spacing.md, padding: spacing.sm },
  secondaryText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
});
