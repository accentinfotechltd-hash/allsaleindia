import { useRouter } from "expo-router";
import { ArrowRight, MessageCircle, Send, Sparkles, X } from "lucide-react-native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Props = {
  sellerId: string;
  sellerName?: string | null;
  productId: string;
  productName?: string | null;
};

const QUICK_PROMPTS = [
  "Is this item still in stock?",
  "How long will shipping take to my country?",
  "Do you offer any discount on bulk orders?",
  "Can you share more pictures or a video?",
  "Is the size true to fit?",
];

/**
 * "Ask seller a question" button + bottom-sheet composer. Tapping the
 * pill opens a modal with quick prompts and a free-form textarea. Submitting
 * calls `POST /chat/conversations` with the product attached, then routes
 * straight into the conversation thread `/chat/{id}`.
 *
 * Idempotent: backend reuses the existing (buyer, seller, product) conv if
 * one already exists.
 */
export default function AskSellerButton({
  sellerId,
  sellerName,
  productId,
  productName,
}: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const handleOpen = () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    setOpen(true);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setText("");
  };

  const send = async () => {
    const body = text.trim();
    if (!body) {
      show({ title: "Type a question first", kind: "error" });
      return;
    }
    if (body.length < 4) {
      show({ title: "Question too short", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const conv = await api<{ id: string }>("/chat/conversations", {
        method: "POST",
        body: {
          seller_id: sellerId,
          product_id: productId,
          body,
        },
      });
      setOpen(false);
      setText("");
      router.push(`/chat/${conv.id}`);
    } catch (e: any) {
      show({
        title: "Couldn't send",
        body: e?.message || "Try again in a moment",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const partnerLabel = sellerName || "the seller";

  return (
    <>
      <Pressable
        testID="ask-seller-btn"
        onPress={handleOpen}
        style={({ pressed }) => [
          styles.pill,
          pressed && { opacity: 0.8 },
        ]}
      >
        <MessageCircle size={13} color={colors.primary} />
        <Text style={styles.pillText}>Ask {partnerLabel} a question</Text>
        <ArrowRight size={12} color={colors.primary} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.scrim}
        >
          <Pressable style={{ flex: 1 }} onPress={close} />
          <View style={styles.sheet} testID="ask-seller-sheet">
            <View style={styles.handle} />
            <View style={styles.headRow}>
              <Text style={styles.title} numberOfLines={1}>
                Ask {partnerLabel}
              </Text>
              <Pressable
                onPress={close}
                style={styles.closeBtn}
                testID="ask-seller-close"
                hitSlop={8}
              >
                <X size={18} color={colors.textMuted} />
              </Pressable>
            </View>
            {productName ? (
              <Text style={styles.productLine} numberOfLines={2}>
                About: <Text style={{ fontWeight: "800" }}>{productName}</Text>
              </Text>
            ) : null}

            <View style={styles.promptsHead}>
              <Sparkles size={13} color={colors.primary} />
              <Text style={styles.promptsTitle}>Quick prompts</Text>
            </View>
            <View style={styles.promptsWrap}>
              {QUICK_PROMPTS.map((p) => (
                <Pressable
                  key={p}
                  testID={`ask-seller-prompt-${p.slice(0, 12).replace(/\s+/g, "-")}`}
                  onPress={() => setText(p)}
                  style={({ pressed }) => [
                    styles.prompt,
                    pressed && { backgroundColor: "#FFEDD5" },
                  ]}
                >
                  <Text style={styles.promptText} numberOfLines={2}>
                    {p}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              testID="ask-seller-input"
              value={text}
              onChangeText={setText}
              placeholder={`Hi! I have a question about this product…`}
              placeholderTextColor={colors.textFaint}
              multiline
              numberOfLines={4}
              style={styles.input}
              maxLength={600}
            />
            <Text style={styles.counter}>{text.length}/600</Text>

            <Pressable
              testID="ask-seller-send-btn"
              disabled={busy || text.trim().length < 4}
              onPress={send}
              style={[
                styles.sendBtn,
                (busy || text.trim().length < 4) && { opacity: 0.55 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Send size={16} color="#fff" />
                  <Text style={styles.sendText}>Send question</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.helper}>
              You'll continue the conversation in your inbox.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 6,
  },
  pillText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 11,
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
  headRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  title: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 17 },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  productLine: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  promptsHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 8,
  },
  promptsTitle: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.5,
  },
  promptsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: spacing.md,
  },
  prompt: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FFF7ED",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FED7AA",
    maxWidth: "100%",
  },
  promptText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "600",
  },
  input: {
    minHeight: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
    textAlignVertical: "top",
  },
  counter: {
    alignSelf: "flex-end",
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  sendText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  helper: {
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 8,
  },
});
