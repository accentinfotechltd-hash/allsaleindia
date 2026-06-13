import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Sparkles, X } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/contexts/AuthContext";
import { useCart } from "@/src/contexts/CartContext";
import { colors, radius, spacing } from "@/src/lib/theme";

type Balance = {
  balance: number;
  monetary_value_nzd: number;
  redeem_rate_per_nzd: number;
};

export default function PointsRedeemInput() {
  const { user } = useAuth();
  const { cart, refresh } = useCart();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const b = await api<Balance>("/points/balance");
      setBalance(b);
    } catch {
      setBalance(null);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load, cart.subtotal_nzd]);

  if (!user || !balance || balance.balance < 100) return null;
  if (cart.items.length === 0) return null;

  const applied = (cart.points_used || 0) > 0;
  const maxUsable = cart.points_max_usable || 0;
  const cashValue = (n: number) => `$${(n / balance.redeem_rate_per_nzd).toFixed(2)}`;

  const apply = async (raw: string) => {
    const n = parseInt(raw, 10);
    if (!n || n < 100) {
      Alert.alert("Min 100 points", "Use 100 pts or more (each 100 pts = $1).");
      return;
    }
    setBusy(true);
    try {
      await api("/cart/points", { method: "POST", body: { points: n } });
      await refresh();
      await load();
      setInput("");
    } catch (e: any) {
      Alert.alert("Couldn't apply points", e?.message || "Try a smaller amount.");
    } finally {
      setBusy(false);
    }
  };

  const onApplyMax = () => apply(String(maxUsable));

  const onRemove = async () => {
    setBusy(true);
    try {
      await api("/cart/points", { method: "DELETE" });
      await refresh();
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="points-redeem">
      {applied ? (
        <View style={styles.appliedRow} testID="points-applied-row">
          <Sparkles size={14} color="#7C3AED" />
          <View style={{ flex: 1 }}>
            <Text style={styles.appliedTitle}>
              Using {cart.points_used} pts · saving ${cart.points_discount_nzd.toFixed(2)}
            </Text>
            <Text style={styles.appliedSub}>
              {balance.balance} pts remaining after this order
            </Text>
          </View>
          <Pressable
            disabled={busy}
            onPress={onRemove}
            testID="points-remove-btn"
            style={styles.removeBtn}
          >
            <X size={14} color={colors.error} />
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <View style={styles.header}>
            <Sparkles size={14} color="#7C3AED" />
            <Text style={styles.headerText}>
              You have <Text style={styles.pts}>{balance.balance} pts</Text>{" "}
              <Text style={styles.equiv}>(≈ {cashValue(balance.balance)})</Text>
            </Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              testID="points-input"
              value={input}
              onChangeText={(v) => setInput(v.replace(/[^0-9]/g, ""))}
              placeholder={`Up to ${maxUsable.toLocaleString()}`}
              keyboardType="numeric"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
            />
            <Pressable
              testID="points-apply-btn"
              disabled={busy || !input || parseInt(input, 10) < 100}
              onPress={() => apply(input)}
              style={[styles.applyBtn, (busy || !input || parseInt(input, 10) < 100) && { opacity: 0.5 }]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.applyText}>Use</Text>
              )}
            </Pressable>
          </View>
          {maxUsable >= 100 ? (
            <Pressable
              testID="points-max-btn"
              onPress={onApplyMax}
              style={styles.maxBtn}
            >
              <Text style={styles.maxText}>
                Use max — {maxUsable} pts → save {cashValue(maxUsable)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  pts: { color: "#7C3AED", fontWeight: "800" },
  equiv: { color: colors.textFaint, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E9D5FF",
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: "#FAF5FF",
    marginTop: 4,
  },
  input: { flex: 1, paddingVertical: 8, color: colors.text, fontWeight: "700", fontSize: 14 },
  applyBtn: {
    backgroundColor: "#7C3AED",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  applyText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  maxBtn: { paddingVertical: 4, alignSelf: "flex-start" },
  maxText: { color: "#7C3AED", fontWeight: "700", fontSize: 11 },
  appliedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FAF5FF",
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: "#7C3AED",
  },
  appliedTitle: { fontWeight: "800", color: "#7C3AED", fontSize: 13 },
  appliedSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  removeBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  removeText: { color: colors.error, fontSize: 12, fontWeight: "700" },
});
