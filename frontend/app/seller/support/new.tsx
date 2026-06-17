import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Image as ImageIcon,
  Send,
  X,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
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

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";
import { useToast } from "@/src/components/UiOverlayProvider";

const CATEGORIES = [
  { value: "payments", label: "Payments / Payouts" },
  { value: "orders", label: "Orders" },
  { value: "kyc", label: "KYC / Verification" },
  { value: "shipping", label: "Shipping" },
  { value: "listings", label: "Listings" },
  { value: "returns", label: "Returns" },
  { value: "account", label: "Account access" },
  { value: "other", label: "Other" },
];

const PRIORITIES = [
  { value: "low", label: "Low", desc: "General question", color: "#6B7280" },
  { value: "medium", label: "Medium", desc: "Affects part of my store", color: "#0EA5E9" },
  { value: "high", label: "High", desc: "Blocking my work today", color: "#F59E0B" },
  { value: "urgent", label: "Urgent", desc: "Critical, losing money", color: "#EF4444" },
];

export default function NewTicketScreen() {
  const toast = useToast();
  const { show } = useToast();
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("payments");
  const [priority, setPriority] = useState("medium");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const pickAttachment = useCallback(async () => {
    if (attachments.length >= 4) {
      show({ title: "Limit reached", message: "You can attach up to 4 screenshots.", kind: "error" });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show({ title: "Permission needed", message: "We need access to your photos to attach screenshots.", kind: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType || "image/jpeg";
    const dataUri = `data:${mime};base64,${result.assets[0].base64}`;
    try {
      const up = await api<{ url: string }>("/uploads/image", {
        method: "POST",
        body: { data: dataUri, folder: "allsale/support" },
      });
      setAttachments((cur) => [...cur, up.url]);
    } catch (e: any) {
      show({ title: "Upload failed", message: e?.message || "Try again.", kind: "error" });
    }
  }, [attachments.length]);

  const removeAttachment = (idx: number) => {
    setAttachments((cur) => cur.filter((_, i) => i !== idx));
  };

  const submit = useCallback(async () => {
    if (subject.trim().length < 4) {
      toast.show({ title: "Subject too short", body: "Please give your ticket a clear subject (4+ chars).", kind: "error" });
      return;
    }
    if (description.trim().length < 10) {
      show({ title: "Need more detail", message: "Please describe the issue with at least 10 characters.", kind: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const t = await api<{ id: string }>("/support/tickets", {
        method: "POST",
        body: {
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          attachments,
        },
      });
      router.replace(`/seller/support/${t.id}`);
    } catch (e: any) {
      show({ title: "Could not raise ticket", message: e?.message || "Please try again.", kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [subject, description, category, priority, attachments, router]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="new-ticket-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Raise a ticket</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.helpCard}>
            <CheckCircle2 size={16} color={colors.success} />
            <Text style={styles.helpText}>
              We respond within {priority === "urgent" ? "4 hours" : priority === "high" ? "24 hours" : "2 business days"} for {priority} priority tickets.
            </Text>
          </View>

          <Text style={styles.label}>Subject</Text>
          <TextInput
            testID="ticket-subject"
            value={subject}
            onChangeText={setSubject}
            placeholder="One-line summary of the issue"
            placeholderTextColor={colors.textFaint}
            maxLength={140}
            style={styles.input}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.value}
                testID={`cat-${c.value}`}
                onPress={() => setCategory(c.value)}
                style={[styles.chip, category === c.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, category === c.value && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Priority</Text>
          <View style={{ gap: 8 }}>
            {PRIORITIES.map((p) => (
              <Pressable
                key={p.value}
                testID={`pri-${p.value}`}
                onPress={() => setPriority(p.value)}
                style={[
                  styles.priorityCard,
                  priority === p.value && {
                    borderColor: p.color,
                    backgroundColor: `${p.color}10`,
                  },
                ]}
              >
                <View style={[styles.priorityDot, { backgroundColor: p.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.priorityLabel}>{p.label}</Text>
                  <Text style={styles.priorityDesc}>{p.desc}</Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    priority === p.value && { borderColor: p.color, backgroundColor: p.color },
                  ]}
                />
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Describe the issue</Text>
          <TextInput
            testID="ticket-description"
            value={description}
            onChangeText={setDescription}
            placeholder="Steps to reproduce, order/payout IDs, expected vs actual…"
            placeholderTextColor={colors.textFaint}
            multiline
            numberOfLines={6}
            maxLength={4000}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.counter}>{description.length}/4000</Text>

          <Text style={styles.label}>Attachments (up to 4)</Text>
          <View style={styles.attachRow}>
            {attachments.map((url, idx) => (
              <View key={idx} style={styles.attachThumb}>
                <Image source={{ uri: url }} style={styles.attachImg} />
                <Pressable
                  testID={`attach-remove-${idx}`}
                  onPress={() => removeAttachment(idx)}
                  style={styles.attachRemove}
                >
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
            {attachments.length < 4 ? (
              <Pressable
                testID="ticket-add-attachment"
                onPress={pickAttachment}
                style={styles.attachAdd}
              >
                <ImageIcon size={20} color={colors.primary} />
                <Text style={styles.attachAddText}>Add screenshot</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.warning}>
            <AlertTriangle size={14} color={colors.primaryDark} />
            <Text style={styles.warningText}>
              Don&apos;t share passwords, card numbers, or buyer&apos;s personal info.
            </Text>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <SafeAreaView edges={["bottom"]} style={styles.submitBar}>
        <Pressable
          testID="ticket-submit"
          disabled={submitting}
          onPress={submit}
          style={({ pressed }) => [
            styles.submitBtn,
            submitting && { opacity: 0.6 },
            pressed && !submitting && { transform: [{ scale: 0.98 }] },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Send size={18} color="#fff" />
              <Text style={styles.submitText}>Submit ticket</Text>
            </>
          )}
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  scroll: { padding: spacing.lg, gap: 6 },
  helpCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
    marginBottom: spacing.md,
  },
  helpText: { fontSize: 12.5, color: "#065F46", flex: 1, fontWeight: "600" },
  label: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textarea: { minHeight: 140, textAlignVertical: "top" },
  counter: { fontSize: 11, color: colors.textFaint, textAlign: "right", marginTop: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontSize: 12.5, fontWeight: "700", color: colors.textMuted },
  chipTextActive: { color: colors.primaryDark },
  priorityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  priorityDot: { width: 10, height: 10, borderRadius: 999 },
  priorityLabel: { fontSize: 14, fontWeight: "800", color: colors.text },
  priorityDesc: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 999, borderWidth: 2, borderColor: colors.border },
  attachRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  attachThumb: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  attachImg: { width: "100%", height: "100%" },
  attachRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  attachAdd: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  attachAddText: { fontSize: 10, fontWeight: "700", color: colors.primary },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    marginTop: spacing.md,
  },
  warningText: { fontSize: 11.5, color: colors.primaryDark, flex: 1, fontWeight: "600" },
  submitBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
