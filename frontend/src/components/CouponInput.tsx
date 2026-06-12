import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CheckCircle2, Tag, X, XCircle, Copy } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { useCart } from "@/src/contexts/CartContext";
import { colors, radius, spacing } from "@/src/lib/theme";

type ActiveCoupon = {
  code: string;
  description: string;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  min_order_nzd: number;
  max_discount_nzd?: number | null;
  scope?: string;
  owner_name?: string | null;
  valid_to?: string | null;
};

export default function CouponInput() {
  const { cart, applyCoupon, removeCoupon } = useCart();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [active, setActive] = useState<ActiveCoupon[]>([]);
  const [loadingActive, setLoadingActive] = useState(false);

  const applied = !!cart.coupon_code;

  const loadActive = useCallback(async () => {
    setLoadingActive(true);
    try {
      const list = await api<ActiveCoupon[]>("/coupons/active");
      setActive(list || []);
    } catch {
      setActive([]);
    } finally {
      setLoadingActive(false);
    }
  }, []);

  useEffect(() => {
    if (browseOpen) loadActive();
  }, [browseOpen, loadActive]);

  const onApply = async (raw: string) => {
    const clean = raw.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    try {
      await applyCoupon(clean);
      setCode("");
      setBrowseOpen(false);
    } catch (e: any) {
      Alert.alert("Coupon not applied", e?.message || "Try a different code.");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeCoupon();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="coupon-input">
      {applied ? (
        <View style={styles.appliedRow} testID="coupon-applied-row">
          <View style={styles.appliedLeft}>
            <CheckCircle2 size={16} color={colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.appliedCode}>{cart.coupon_code}</Text>
              <Text style={styles.appliedLabel}>
                {cart.coupon_label || "Coupon applied"}
              </Text>
            </View>
          </View>
          <Pressable
            testID="coupon-remove-btn"
            disabled={busy}
            onPress={onRemove}
            style={styles.removeBtn}
          >
            <X size={14} color={colors.error} />
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <Tag size={16} color={colors.primary} />
          <TextInput
            testID="coupon-code-input"
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            placeholder="Enter coupon code"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
            onSubmitEditing={() => onApply(code)}
          />
          <Pressable
            testID="coupon-apply-btn"
            disabled={busy || code.trim().length < 2}
            onPress={() => onApply(code)}
            style={({ pressed }) => [
              styles.applyBtn,
              (busy || code.trim().length < 2) && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.applyBtnText}>Apply</Text>
            )}
          </Pressable>
        </View>
      )}

      {!applied ? (
        <Pressable
          testID="coupon-browse-btn"
          onPress={() => setBrowseOpen(true)}
          style={styles.browseLink}
        >
          <Text style={styles.browseLinkText}>See available offers ›</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={browseOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setBrowseOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Available offers</Text>
              <Pressable onPress={() => setBrowseOpen(false)} style={styles.closeBtn}>
                <X size={20} color={colors.text} />
              </Pressable>
            </View>

            {loadingActive ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : active.length === 0 ? (
              <View style={styles.empty}>
                <XCircle size={32} color={colors.textFaint} />
                <Text style={styles.emptyText}>
                  No active offers right now. Check back soon! 💫
                </Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 480 }}
                contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
              >
                {active.map((c) => (
                  <View key={c.code} style={styles.couponCard} testID={`coupon-card-${c.code}`}>
                    <View style={styles.couponLeft}>
                      <Tag size={18} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <View style={styles.codeRow}>
                          <Text style={styles.couponCode}>{c.code}</Text>
                          {c.type === "free_shipping" ? (
                            <View style={styles.tagFree}>
                              <Text style={styles.tagFreeText}>FREE SHIP</Text>
                            </View>
                          ) : (
                            <View style={styles.tagDisc}>
                              <Text style={styles.tagDiscText}>
                                {c.type === "percent"
                                  ? `${c.value}% OFF`
                                  : `$${c.value.toFixed(0)} OFF`}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.couponDesc} numberOfLines={2}>
                          {c.description}
                        </Text>
                        {c.min_order_nzd > 0 ? (
                          <Text style={styles.minOrder}>
                            Min spend ${c.min_order_nzd.toFixed(0)}
                          </Text>
                        ) : null}
                        {c.owner_name ? (
                          <Text style={styles.ownerText}>by {c.owner_name}</Text>
                        ) : null}
                      </View>
                    </View>
                    <Pressable
                      testID={`coupon-apply-${c.code}`}
                      onPress={() => onApply(c.code)}
                      style={({ pressed }) => [
                        styles.cardApply,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={styles.cardApplyText}>Apply</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  applyBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  applyBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  appliedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#ECFDF5",
    borderRadius: radius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: "#10B981",
  },
  appliedLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
  },
  appliedCode: { fontWeight: "800", color: colors.text, fontSize: 13, letterSpacing: 1 },
  appliedLabel: { color: colors.success, fontSize: 12, fontWeight: "700" },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeText: { color: colors.error, fontSize: 12, fontWeight: "700" },
  browseLink: { paddingVertical: 2, alignSelf: "flex-start" },
  browseLinkText: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: { padding: spacing.xl, alignItems: "center" },
  empty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  couponCard: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  couponLeft: { flex: 1, flexDirection: "row", gap: 8 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  couponCode: { fontWeight: "800", color: colors.text, fontSize: 15, letterSpacing: 1 },
  tagDisc: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagDiscText: { color: colors.primary, fontWeight: "800", fontSize: 10 },
  tagFree: {
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tagFreeText: { color: "#0369A1", fontWeight: "800", fontSize: 10 },
  couponDesc: { color: colors.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
  minOrder: { color: colors.textMuted, fontSize: 11, marginTop: 4, fontWeight: "600" },
  ownerText: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  cardApply: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  cardApplyText: { color: "#fff", fontWeight: "800", fontSize: 12 },
});
