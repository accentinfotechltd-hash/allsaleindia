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
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";
import { useToast } from "@/src/components/UiOverlayProvider";

const CATEGORIES: { value: string; tkey: string }[] = [
  { value: "payments", tkey: "cat_payments" },
  { value: "orders", tkey: "cat_orders" },
  { value: "kyc", tkey: "cat_kyc" },
  { value: "shipping", tkey: "cat_shipping" },
  { value: "listings", tkey: "cat_listings" },
  { value: "returns", tkey: "cat_returns" },
  { value: "account", tkey: "cat_account" },
  { value: "other", tkey: "cat_other" },
];

const PRIORITIES: { value: string; tkey: string; descKey: string; color: string }[] = [
  { value: "low", tkey: "pri_low", descKey: "pri_low_desc", color: "#6B7280" },
  { value: "medium", tkey: "pri_medium", descKey: "pri_medium_desc", color: "#0EA5E9" },
  { value: "high", tkey: "pri_high", descKey: "pri_high_desc", color: "#F59E0B" },
  { value: "urgent", tkey: "pri_urgent", descKey: "pri_urgent_desc", color: "#EF4444" },
];

export default function NewTicketScreen() {
  const toast = useToast();
  const { show } = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("payments");
  const [priority, setPriority] = useState("medium");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const pickAttachment = useCallback(async () => {
    if (attachments.length >= 4) {
      show({ title: t("seller_support_new.limit_reached"), body: t("seller_support_new.limit_reached_body"), kind: "error" });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show({ title: t("seller_support_new.permission_needed"), body: t("seller_support_new.permission_needed_body"), kind: "error" });
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
      show({ title: t("seller_support_new.upload_failed"), body: e?.message || t("seller_support_new.try_again"), kind: "error" });
    }
  }, [attachments.length, show, t]);

  const removeAttachment = (idx: number) => {
    setAttachments((cur) => cur.filter((_, i) => i !== idx));
  };

  const submit = useCallback(async () => {
    if (subject.trim().length < 4) {
      toast.show({ title: t("seller_support_new.subject_too_short"), body: t("seller_support_new.subject_too_short_body"), kind: "error" });
      return;
    }
    if (description.trim().length < 10) {
      show({ title: t("seller_support_new.need_more_detail"), body: t("seller_support_new.need_more_detail_body"), kind: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const tk = await api<{ id: string }>("/support/tickets", {
        method: "POST",
        body: {
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          attachments,
        },
      });
      router.replace(`/seller/support/${tk.id}`);
    } catch (e: any) {
      show({ title: t("seller_support_new.couldnt_raise"), body: e?.message || t("seller_support_new.please_try_again"), kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [subject, description, category, priority, attachments, router, show, toast, t]);

  const responseTime = priority === "urgent" ? t("seller_support_new.response_time_urgent")
    : priority === "high" ? t("seller_support_new.response_time_high")
    : t("seller_support_new.response_time_default");
  const priorityLabel = t(`seller_support_new.pri_${priority}`);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="new-ticket-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("seller_support_new.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.helpCard}>
            <CheckCircle2 size={16} color={colors.success} />
            <Text style={styles.helpText}>
              {t("seller_support_new.help_text", { time: responseTime, priority: priorityLabel.toLowerCase() })}
            </Text>
          </View>

          <Text style={styles.label}>{t("seller_support_new.subject_label")}</Text>
          <TextInput
            testID="ticket-subject"
            value={subject}
            onChangeText={setSubject}
            placeholder={t("seller_support_new.subject_placeholder")}
            placeholderTextColor={colors.textFaint}
            maxLength={140}
            style={styles.input}
          />

          <Text style={styles.label}>{t("seller_support_new.category_label")}</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c.value}
                testID={`cat-${c.value}`}
                onPress={() => setCategory(c.value)}
                style={[styles.chip, category === c.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, category === c.value && styles.chipTextActive]}>
                  {t(`seller_support_new.${c.tkey}`)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>{t("seller_support_new.priority_label")}</Text>
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
                  <Text style={styles.priorityLabel}>{t(`seller_support_new.${p.tkey}`)}</Text>
                  <Text style={styles.priorityDesc}>{t(`seller_support_new.${p.descKey}`)}</Text>
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

          <Text style={styles.label}>{t("seller_support_new.describe_label")}</Text>
          <TextInput
            testID="ticket-description"
            value={description}
            onChangeText={setDescription}
            placeholder={t("seller_support_new.describe_placeholder")}
            placeholderTextColor={colors.textFaint}
            multiline
            numberOfLines={6}
            maxLength={4000}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.counter}>{description.length}/4000</Text>

          <Text style={styles.label}>{t("seller_support_new.attachments_label")}</Text>
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
                <Text style={styles.attachAddText}>{t("seller_support_new.add_screenshot")}</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.warning}>
            <AlertTriangle size={14} color={colors.primaryDark} />
            <Text style={styles.warningText}>
              {t("seller_support_new.warning_text")}
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
              <Text style={styles.submitText}>{t("seller_support_new.submit_btn")}</Text>
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
