/**
 * SSO landing page — accepts ?token=... from Seawind's allsale.co.nz classifieds
 * site, exchanges it for an Allsale JWT, and redirects to the destination.
 *
 * Usage: https://shop.allsale.co.nz/sso?token=<JWT>&next=/(tabs)/home
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { ShieldCheck } from "lucide-react-native";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { api, setToken } from "@/src/lib/api";
import { colors, spacing } from "@/src/lib/theme";

type SsoResponse = {
  user: { id: string; email: string; full_name?: string };
  access_token: string;
};

export default function SsoBridge() {
  const router = useRouter();
  const { token, next } = useLocalSearchParams<{ token?: string; next?: string }>();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<"validating" | "ok" | "error">("validating");
  const [err, setErr] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    // StrictMode-safe — only run once
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      if (!token || typeof token !== "string") {
        setErr("Missing SSO token");
        setStatus("error");
        return;
      }
      try {
        const res = await api<SsoResponse>("/auth/sso/callback", {
          method: "POST",
          auth: false,
          body: { token },
        });
        await setToken(res.access_token);
        await refresh();
        setStatus("ok");
        const dest =
          typeof next === "string" && next.startsWith("/") ? next : "/(tabs)/home";
        // Tiny delay so users see the success flash
        setTimeout(() => router.replace(dest as any), 400);
      } catch (e: any) {
        setErr(e?.message || "Sign-in via Allsale classifieds failed");
        setStatus("error");
      }
    })();
  }, [token, next, router, refresh]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <ShieldCheck size={36} color={colors.primary} />
        </View>
        <Text style={styles.title}>Signing you in…</Text>
        {status === "validating" && (
          <>
            <Text style={styles.subtitle}>
              Verifying your Allsale classifieds session
            </Text>
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
          </>
        )}
        {status === "ok" && (
          <Text style={[styles.subtitle, { color: "#10b981" }]}>
            ✓ Signed in — redirecting…
          </Text>
        )}
        {status === "error" && (
          <>
            <Text style={[styles.subtitle, { color: "#dc2626" }]}>{err}</Text>
            <Text
              style={styles.linkText}
              onPress={() => router.replace("/(auth)/login")}
            >
              Sign in manually instead →
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: "#fff",
    padding: spacing.lg,
    borderRadius: 16,
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#ede9fe",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, textAlign: "center" },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  linkText: {
    color: colors.primary,
    fontWeight: "700",
    marginTop: spacing.md,
    fontSize: 14,
  },
});
