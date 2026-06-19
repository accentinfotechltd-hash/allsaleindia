import { Gift, GiftIcon, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCart } from "@/src/contexts/CartContext";
import { useToast } from "@/src/components/UiOverlayProvider";
import { colors, radius, spacing } from "@/src/lib/theme";

type Props = {
  productId: string;
  giftWrap: boolean;
  giftMessage?: string | null;
};

/**
 * Per-line gift-wrap toggle button + composer sheet.
 *
 * Renders a compact "🎁 Gift wrap (+$5)" pill on cart cards. Tapping it
 * opens a bottom-sheet with:
 *   • a Switch for the gift-wrap toggle,
 *   • a 240-char message field that's only enabled when the switch is on,
 *   • Save / Cancel buttons.
 *
 * State is persisted via the existing `setGiftWrap()` helper on the cart
 * context (which PATCHes `/cart/{productId}/gift`).
 */
export default function GiftWrapToggle({
  productId,
  giftWrap,
  giftMessage,
}: Props) {
  const { setGiftWrap } = useCart();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localWrap, setLocalWrap] = useState(giftWrap);
  const [localMsg, setLocalMsg] = useState(giftMessage || "");

  const openSheet = () => {
    setLocalWrap(giftWrap);
    setLocalMsg(giftMessage || "");
    setOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await setGiftWrap(productId, localWrap, localMsg.trim() || undefined);
      show({
        title: localWrap ? "Gift wrap added" : "Gift wrap removed",
        body: localWrap ? "+$5 NZD per wrapped item" : undefined,
        kind: "success",
      });
      setOpen(false);
    } catch (e: any) {
      show({
        title: "Couldn't update gift wrap",
        body: e?.message,
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        testID={`gift-wrap-pill-${productId}`}
        onPress={openSheet}
        style={({ pressed }) => [
          styles.pill,
          giftWrap && styles.pillActive,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Gift
          size={12}
          color={giftWrap ? "#fff" : colors.primary}
        />
        <Text
          style={[styles.pillText, giftWrap && { color: "#fff" }]}
          numberOfLines={1}
        >
          {giftWrap ? "Gift wrap ✓" : "Gift wrap +$5"}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => !busy && setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.scrim}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => !busy && setOpen(false)}
          />
          <View style={styles.sheet} testID="gift-wrap-sheet">
            <View style={styles.handle} />
            <View style={styles.headRow}>
              <GiftIcon size={18} color={colors.primary} />
              <Text style={styles.title}>Gift wrap this item</Text>
              <Pressable
                onPress={() => !busy && setOpen(false)}
                hitSlop={8}
                testID="gift-wrap-close"
              >
                <X size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  Premium gift wrap & ribbon
                </Text>
                <Text style={styles.rowBody}>
                  Beautifully wrapped before dispatch. Adds <Text style={styles.bold}>$5 NZD</Text> per wrapped item.
                </Text>
              </View>
              <Switch
                testID="gift-wrap-switch"
                value={localWrap}
                onValueChange={setLocalWrap}
                trackColor={{ false: "#E5E7EB", true: colors.primary }}
                thumbColor={"#fff"}
              />
            </View>

            <View
              style={[
                styles.msgWrap,
                !localWrap && { opacity: 0.5 },
              ]}
              pointerEvents={localWrap ? "auto" : "none"}
            >
              <Text style={styles.label}>Gift message (optional)</Text>
              <TextInput
                testID="gift-wrap-message"
                value={localMsg}
                onChangeText={(v) => setLocalMsg(v.slice(0, 240))}
                multiline
                placeholder="Happy birthday! Hope you love this."
                placeholderTextColor={colors.textFaint}
                style={styles.msgInput}
                maxLength={240}
                editable={localWrap}
              />
              <Text style={styles.counter}>{localMsg.length}/240</Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                onPress={() => setOpen(false)}
                disabled={busy}
                style={[styles.btn, styles.btnSecondary]}
                testID="gift-wrap-cancel"
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                disabled={busy}
                style={[styles.btn, styles.btnPrimary, busy && { opacity: 0.6 }]}
                testID="gift-wrap-save"
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 10,
    letterSpacing: 0.2,
  },

  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.md,
  },
  title: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 16 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowTitle: { fontWeight: "800", color: colors.text, fontSize: 13 },
  rowBody: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 16 },
  bold: { fontWeight: "800", color: colors.text },

  msgWrap: { marginTop: spacing.md },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  msgInput: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
    backgroundColor: "#fff",
    textAlignVertical: "top",
  },
  counter: {
    alignSelf: "flex-end",
    fontSize: 10,
    color: colors.textFaint,
    marginTop: 2,
  },

  actionsRow: { flexDirection: "row", gap: 10, marginTop: spacing.lg },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  btnSecondary: { backgroundColor: colors.surface },
  btnSecondaryText: { color: colors.text, fontWeight: "800", fontSize: 14 },
});
