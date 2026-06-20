/**
 * Buyer Contact Form — `POST /api/support/tickets`.
 *
 * Streamlined for buyers (the seller version at /seller/support/new is
 * more involved). We default category to "other" and pre-fill the email
 * from the signed-in user. Unauthenticated buyers see an inline sign-in
 * nudge but can still submit (the backend treats them as anonymous).
 */
import { useRouter } from "expo-router";
import { CheckCircle2, ChevronLeft, Send } from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "shipping", label: "Shipping" },
  { key: "returns", label: "Returns" },
  { key: "payments", label: "Payments" },
  { key: "account", label: "Account" },
  { key: "other", label: "Something else" },
];

export default function ContactSupportScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { user } = useAuth();

  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string } | null>(null);

  const canSubmit = useMemo(
    () => subject.trim().length >= 4 && body.trim().length >= 10 && !submitting,
    [subject, body, submitting]
  );

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    if (!user) {
      show({
        title: "Please sign in",
        body: "We need your account to track this conversation.",
        kind: "error",
      });
      router.push("/(auth)/welcome");
      return;
    }
    setSubmitting(true);
    try {
      const t = await api<{ id: string }>("/support/tickets", {
        method: "POST",
        body: {
          category,
          subject: subject.trim(),
          body: body.trim(),
          priority: "medium",
          order_id: orderId.trim() || undefined,
        },
      });
      setDone({ id: t.id });
    } catch (e: any) {
      show({
        title: "Couldn't send your message",
        body: e?.message || "Please try again.",
        kind: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, category, subject, body, orderId, user, router, show]);

  if (done) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.header}>
          <Pressable
            testID="contact-success-back"
            onPress={() => router.replace("/help")}
            style={styles.headerBtn}
          >
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Message sent</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <CheckCircle2 size={36} color={colors.primary} />
          </View>
          <Text style={styles.successTitle}>Thanks — we got it.</Text>
          <Text style={styles.successSub}>
            We&apos;ll reply to your account email within 1 business day.
            You can track this conversation in My tickets.
          </Text>
          <Pressable
            testID="contact-go-tickets"
            style={styles.primaryBtn}
            onPress={() => router.replace("/help/my-tickets")}
          >
            <Text style={styles.primaryBtnText}>View my tickets</Text>
          </Pressable>
          <Pressable
            testID="contact-back-home"
            style={styles.linkBtn}
            onPress={() => router.replace("/help")}
          >
            <Text style={styles.linkText}>Back to Help Center</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="contact-back"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Contact support</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.label}>What can we help with?</Text>
          <View style={styles.chipsRow}>
            {CATEGORIES.map((c) => {
              const active = category === c.key;
              return (
                <Pressable
                  key={c.key}
                  testID={`contact-cat-${c.key}`}
                  onPress={() => setCategory(c.key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Subject</Text>
          <TextInput
            testID="contact-subject"
            value={subject}
            onChangeText={setSubject}
            placeholder="Briefly, what is this about?"
            placeholderTextColor={colors.textMuted}
            maxLength={120}
            style={styles.input}
          />

          {category === "orders" || category === "shipping" || category === "returns" ? (
            <>
              <Text style={styles.label}>Order ID (optional)</Text>
              <TextInput
                testID="contact-order-id"
                value={orderId}
                onChangeText={setOrderId}
                placeholder="e.g. ord_a1b2c3d4"
                placeholderTextColor={colors.textMuted}
                maxLength={64}
                style={styles.input}
                autoCapitalize="none"
              />
            </>
          ) : null}

          <Text style={styles.label}>Message</Text>
          <TextInput
            testID="contact-body"
            value={body}
            onChangeText={setBody}
            placeholder="Tell us what happened — the more detail, the faster we can help."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            maxLength={2000}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.counter}>{body.length} / 2000</Text>

          {!user ? (
            <View style={styles.signinHint}>
              <Text style={styles.signinHintText}>
                You need to sign in so we can reply. We&apos;ll route you to
                login when you submit.
              </Text>
            </View>
          ) : null}

          <Pressable
            testID="contact-submit"
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.primaryBtn, !canSubmit && { opacity: 0.5 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Send size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Send message</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.footer}>
            Average first reply: under 24 h on weekdays.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "800",
    color: colors.text,
    fontSize: 16,
  },
  content: { padding: spacing.lg, gap: 12 },
  label: {
    fontWeight: "800",
    color: colors.text,
    fontSize: 13,
    marginTop: 4,
  },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  chipTextActive: { color: "#fff" },

  input: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  textarea: { minHeight: 140, paddingTop: 12 },
  counter: { color: colors.textFaint, fontSize: 11, textAlign: "right" },

  signinHint: {
    padding: 10,
    backgroundColor: "#FEF3C7",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  signinHintText: { color: "#92400E", fontSize: 12, lineHeight: 16 },

  primaryBtn: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  linkBtn: { padding: 12, alignItems: "center" },
  linkText: { color: colors.primary, fontWeight: "700" },

  footer: { color: colors.textFaint, fontSize: 11, textAlign: "center" },

  successWrap: { flex: 1, alignItems: "center", padding: spacing.xl, gap: 8 },
  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
    marginTop: 24, marginBottom: 8,
  },
  successTitle: { fontWeight: "800", color: colors.text, fontSize: 22 },
  successSub: {
    color: colors.textMuted, fontSize: 14, textAlign: "center",
    lineHeight: 20, paddingHorizontal: spacing.md,
  },
});
