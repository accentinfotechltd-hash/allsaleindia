/**
 * Delivery rating sheet — buyer rates the SHIPPING experience after a
 * delivered order (separate from product reviews, which rate the item
 * itself).
 *
 * Triggered from /orders for any row with status='delivered'. POSTs to
 * `/orders/{id}/delivery-rating` which increments per-seller aggregates
 * powering the "Ships well" badge on PDPs.
 */
import { Star } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function DeliveryRatingSheet({
  visible,
  orderId,
  initialStars = 0,
  initialComment = "",
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  orderId: string;
  initialStars?: number;
  initialComment?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const toast = useToast();
  const [stars, setStars] = useState(initialStars);
  const [comment, setComment] = useState(initialComment);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (stars < 1 || submitting) return;
    setSubmitting(true);
    try {
      await api(`/orders/${orderId}/delivery-rating`, {
        method: "POST",
        body: { stars, comment: comment.trim() },
      });
      toast.show({
        title: "Thanks for rating!",
        body: "Your feedback helps sellers improve shipping.",
        kind: "success",
      });
      onSubmitted?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't submit";
      toast.show({ title: msg, kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const promptCopy =
    stars === 0
      ? "How was the delivery experience?"
      : stars >= 4
      ? "Glad it arrived in great shape!"
      : stars === 3
      ? "Got it — what could've been better?"
      : "Sorry that wasn't great. Tell us what went wrong.";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={["bottom"]}>
            <View style={styles.handle} />
            <Text style={styles.title}>Rate this delivery</Text>
            <Text style={styles.subtitle}>{promptCopy}</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Pressable
                  key={s}
                  testID={`delivery-star-${s}`}
                  onPress={() => setStars(s)}
                  hitSlop={6}
                  style={styles.starBtn}
                >
                  <Star
                    size={36}
                    color={s <= stars ? "#F59E0B" : colors.border}
                    fill={s <= stars ? "#F59E0B" : "transparent"}
                  />
                </Pressable>
              ))}
            </View>

            <TextInput
              testID="delivery-comment"
              value={comment}
              onChangeText={setComment}
              placeholder="Anything to add about packaging or speed? (optional)"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={300}
              style={styles.input}
            />
            <Text style={styles.counter}>{comment.length} / 300</Text>

            <View style={styles.footer}>
              <Pressable onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="delivery-rating-submit"
                disabled={stars < 1 || submitting}
                onPress={submit}
                style={[
                  styles.submitBtn,
                  (stars < 1 || submitting) && styles.submitBtnDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitText}>
                    Submit rating
                  </Text>
                )}
              </Pressable>
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  starsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  starBtn: { paddingVertical: 4 },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: "top",
  },
  counter: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "600",
    alignSelf: "flex-end",
    marginTop: 4,
  },
  footer: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  cancelText: { color: colors.text, fontWeight: "700", fontSize: 14 },
  submitBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
