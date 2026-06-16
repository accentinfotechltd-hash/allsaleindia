import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Status = "loading" | "success" | "error" | "needs_token";

/**
 * Email verification landing page.
 *
 * Reached by the user tapping the link in the verification email:
 *   /verify-email?token=<jwt>
 *
 * Calls `POST /api/auth/verify-email` with the token and refreshes the
 * AuthContext so `user.email_verified` flips to true in real time.
 */
export default function VerifyEmail() {
  const router = useRouter();
  const { refresh } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();
  const tokenFromUrl = useMemo(
    () => (typeof params.token === "string" ? params.token.trim() : ""),
    [params.token]
  );

  const [status, setStatus] = useState<Status>(
    tokenFromUrl ? "loading" : "needs_token"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [email, setEmail] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!tokenFromUrl) return;
    (async () => {
      try {
        const res = await api<{
          ok: boolean;
          email?: string;
          email_verified?: boolean;
        }>("/auth/verify-email", {
          method: "POST",
          auth: false,
          body: { token: tokenFromUrl },
        });
        if (cancelled) return;
        setEmail(res.email);
        setStatus("success");
        // Refresh AuthContext so /auth/me re-fetches with email_verified=true.
        refresh().catch(() => {});
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(
          e?.message || "This link is invalid or has expired (links are valid for 24 hours)."
        );
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenFromUrl, refresh]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.center}>
        {status === "loading" ? (
          <>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.title}>Verifying your email…</Text>
            <Text style={styles.subtitle}>Hold tight, this takes a second.</Text>
          </>
        ) : status === "success" ? (
          <>
            <View style={[styles.iconBubble, styles.successBubble]}>
              <CheckCircle2 size={36} color="#16a34a" />
            </View>
            <Text style={styles.title} testID="verify-success-title">
              Email verified
            </Text>
            <Text style={styles.subtitle}>
              {email
                ? `${email} is now confirmed. You’re all set!`
                : "Your email is now confirmed. You’re all set!"}
            </Text>
            <Pressable
              testID="verify-continue-btn"
              onPress={() => router.replace("/(tabs)/account")}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Continue</Text>
            </Pressable>
          </>
        ) : status === "needs_token" ? (
          <>
            <View style={styles.iconBubble}>
              <MailCheck size={32} color={colors.primary} />
            </View>
            <Text style={styles.title}>Verify your email</Text>
            <Text style={styles.subtitle}>
              Open the verification link we sent to your inbox to confirm this
              email. If you don’t have a link yet, head to your account to
              resend one.
            </Text>
            <Pressable
              testID="verify-go-account-btn"
              onPress={() => router.replace("/(tabs)/account")}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Go to my account</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={[styles.iconBubble, styles.errorBubble]}>
              <XCircle size={36} color={colors.error} />
            </View>
            <Text style={styles.title} testID="verify-error-title">
              Couldn’t verify
            </Text>
            <Text style={styles.subtitle}>{errorMsg}</Text>
            <Pressable
              testID="verify-retry-btn"
              onPress={() => router.replace("/(tabs)/account")}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Back to account</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  iconBubble: {
    width: 80,
    height: 80,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  successBubble: { backgroundColor: "#dcfce7" },
  errorBubble: { backgroundColor: "#fee2e2" },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 12,
    marginBottom: spacing.xl,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 480,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.pill,
    minWidth: 240,
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
