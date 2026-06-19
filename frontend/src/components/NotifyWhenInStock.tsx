import { useRouter } from "expo-router";
import { Bell, BellRing, Check, Loader } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Props = { productId: string };

/**
 * "Notify me when back in stock" button — only mounted on out-of-stock
 * product pages. Backed by `/api/products/{id}/notify-when-in-stock`.
 *
 *  • GET on mount → reflect current opt-in state
 *  • POST  → opt in (idempotent)
 *  • DELETE → opt out
 *
 *  Auth-aware: if the buyer isn't signed in, tapping the button routes them
 *  to /(auth)/login first.
 */
export default function NotifyWhenInStock({ productId }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { show } = useToast();
  const [watching, setWatching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const resp = await api<{ watching: boolean }>(
        `/products/${productId}/notify-when-in-stock`,
      );
      setWatching(!!resp.watching);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user, productId]);

  useEffect(() => {
    load();
  }, [load]);

  const onPress = async () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    setBusy(true);
    try {
      if (watching) {
        await api(`/products/${productId}/notify-when-in-stock`, {
          method: "DELETE",
        });
        setWatching(false);
        show({ title: "Removed from your watch list", kind: "success" });
      } else {
        await api(`/products/${productId}/notify-when-in-stock`, {
          method: "POST",
          body: {},
        });
        setWatching(true);
        show({
          title: "We'll let you know!",
          body: "You'll get an email + push the moment it's back in stock.",
          kind: "success",
        });
      }
    } catch (e: any) {
      show({
        title: e?.message || "Couldn't update",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.btn, styles.loading]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.btnText}>Checking…</Text>
      </View>
    );
  }

  return (
    <Pressable
      testID="notify-when-in-stock-btn"
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.btn,
        watching && styles.btnActive,
        pressed && { opacity: 0.85 },
        busy && { opacity: 0.6 },
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={watching ? "#fff" : colors.primary}
        />
      ) : watching ? (
        <BellRing size={15} color="#fff" />
      ) : (
        <Bell size={15} color={colors.primary} />
      )}
      <Text
        style={[
          styles.btnText,
          watching && { color: "#fff" },
        ]}
      >
        {watching ? "We'll let you know ✓" : "Notify me when back in stock"}
      </Text>
      {watching ? (
        <Check size={14} color="#fff" style={{ marginLeft: 4 }} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FFF7ED",
    borderWidth: 1.5,
    borderColor: colors.primary,
    marginTop: spacing.sm,
  },
  btnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  btnText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  loading: { opacity: 0.7 },
});
