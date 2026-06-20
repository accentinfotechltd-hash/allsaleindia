import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Power, Tag, Trash2, X } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

type Coupon = {
  id: string;
  code: string;
  description: string;
  type: "percent" | "fixed" | "free_shipping";
  value: number;
  min_order_nzd: number;
  max_discount_nzd?: number | null;
  used_count: number;
  usage_limit_total?: number | null;
  per_user_limit: number;
  scope: string;
  active: boolean;
  created_at?: string;
};

const TYPES: { key: Coupon["type"]; tkey: string }[] = [
  { key: "percent", tkey: "type_percent" },
  { key: "fixed", tkey: "type_fixed" },
  { key: "free_shipping", tkey: "type_free_shipping" },
];

export default function SellerCoupons() {
  const { show } = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api<Coupon[]>("/seller/coupons");
      setItems(list || []);
    } catch (e: any) {
      show({ title: t("seller_coupons.couldnt_load"), body: e?.message || t("seller_coupons.try_later"), kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [show, t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (c: Coupon) => {
    try {
      await api(`/seller/coupons/${c.id}`, {
        method: "PATCH",
        body: { active: !c.active },
      });
      load();
    } catch (e: any) {
      show({ title: t("seller_coupons.couldnt_update"), body: e?.message || t("seller_coupons.try_again"), kind: "error" });
    }
  };

  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (c: Coupon) => {
    const ok = await confirm({
      title: t("seller_coupons.delete_coupon_title"),
      message: t("seller_coupons.delete_coupon_msg", { code: c.code }),
      destructive: true,
      confirmLabel: t("seller_coupons.delete_btn"),
    });
    if (!ok) return;
    try {
      await api(`/seller/coupons/${c.id}`, { method: "DELETE" });
      toast.show({ kind: "success", title: t("seller_coupons.coupon_deleted") });
      load();
    } catch (e: any) {
      toast.show({ kind: "error", title: t("seller_coupons.couldnt_delete"), body: e?.message || t("seller_coupons.try_again") });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          testID="seller-coupons-back"
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("seller_coupons.title")}</Text>
        <Pressable
          onPress={() => setCreateOpen(true)}
          style={styles.createBtn}
          testID="seller-coupons-new-btn"
        >
          <Plus size={16} color="#fff" />
          <Text style={styles.createBtnText}>{t("seller_coupons.new_btn")}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Tag size={36} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>{t("seller_coupons.no_coupons")}</Text>
          <Text style={styles.emptySub}>
            {t("seller_coupons.no_coupons_body")}
          </Text>
          <Pressable
            onPress={() => setCreateOpen(true)}
            style={styles.emptyCta}
            testID="seller-coupons-empty-cta"
          >
            <Plus size={16} color="#fff" />
            <Text style={styles.emptyCtaText}>{t("seller_coupons.create_first")}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((c) => (
            <View key={c.id} style={styles.card} testID={`coupon-${c.code}`}>
              <View style={styles.cardHeader}>
                <View style={styles.codeWrap}>
                  <Tag size={14} color={colors.primary} />
                  <Text style={styles.code}>{c.code}</Text>
                </View>
                <View style={styles.actionsHeader}>
                  <Pressable
                    onPress={() => toggleActive(c)}
                    style={[
                      styles.statusPill,
                      c.active ? styles.statusOn : styles.statusOff,
                    ]}
                    testID={`coupon-toggle-${c.code}`}
                  >
                    <Power size={11} color={c.active ? colors.success : colors.textMuted} />
                    <Text
                      style={[
                        styles.statusText,
                        c.active ? { color: colors.success } : { color: colors.textMuted },
                      ]}
                    >
                      {c.active ? t("seller_coupons.status_active") : t("seller_coupons.status_paused")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => remove(c)}
                    style={styles.deleteBtn}
                    testID={`coupon-delete-${c.code}`}
                  >
                    <Trash2 size={14} color={colors.error} />
                  </Pressable>
                </View>
              </View>

              <Text style={styles.cardDesc}>{c.description}</Text>

              <View style={styles.metaRow}>
                <View style={styles.tagOuter}>
                  <Text style={styles.tagText}>
                    {c.type === "percent"
                      ? t("seller_coupons.pct_off", { value: c.value })
                      : c.type === "fixed"
                        ? t("seller_coupons.amount_off", { value: c.value.toFixed(0) })
                        : t("seller_coupons.type_free_shipping")}
                  </Text>
                </View>
                {c.min_order_nzd > 0 ? (
                  <Text style={styles.meta}>{t("seller_coupons.min_spend", { amount: c.min_order_nzd.toFixed(0) })}</Text>
                ) : null}
                <Text style={styles.meta}>
                  {c.usage_limit_total
                    ? t("seller_coupons.used_limit", { count: c.used_count, limit: c.usage_limit_total })
                    : t("seller_coupons.used_count", { count: c.used_count })}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <CreateCouponModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
    </SafeAreaView>
  );
}

function CreateCouponModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { show } = useToast();
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<Coupon["type"]>("percent");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setCode("");
      setDescription("");
      setType("percent");
      setValue("");
      setMinOrder("");
      setUsageLimit("");
      setActive(true);
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 3) {
      show({ title: t("seller_coupons.code_too_short"), body: t("seller_coupons.code_too_short_body"), kind: "error" });
      return;
    }
    if (description.trim().length < 3) {
      show({ title: t("seller_coupons.add_desc_title"), body: t("seller_coupons.add_desc_body"), kind: "error" });
      return;
    }
    const numVal = type === "free_shipping" ? 0 : parseFloat(value || "0");
    if (type === "percent" && !(numVal > 0 && numVal <= 90)) {
      show({ title: t("seller_coupons.invalid_value"), body: t("seller_coupons.percent_range"), kind: "error" });
      return;
    }
    if (type === "fixed" && numVal <= 0) {
      show({ title: t("seller_coupons.invalid_value"), body: t("seller_coupons.amount_positive"), kind: "error" });
      return;
    }
    setBusy(true);
    try {
      await api("/seller/coupons", {
        method: "POST",
        body: {
          code: trimmed,
          description: description.trim(),
          type,
          value: numVal,
          min_order_nzd: parseFloat(minOrder || "0") || 0,
          usage_limit_total: usageLimit ? parseInt(usageLimit, 10) : null,
          per_user_limit: 1,
          scope: "seller",
          active,
        },
      });
      onCreated();
    } catch (e: any) {
      show({ title: t("seller_coupons.couldnt_create"), body: e?.message || t("seller_coupons.try_again"), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("seller_coupons.modal_title")}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <Field label={t("seller_coupons.field_code")}>
                <TextInput
                  testID="new-coupon-code"
                  value={code}
                  onChangeText={(v) => setCode(v.toUpperCase())}
                  placeholder={t("seller_coupons.placeholder_code")}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                />
              </Field>
              <Field label={t("seller_coupons.field_desc")}>
                <TextInput
                  testID="new-coupon-desc"
                  value={description}
                  onChangeText={setDescription}
                  placeholder={t("seller_coupons.placeholder_desc")}
                  placeholderTextColor={colors.textFaint}
                  multiline
                  style={[styles.input, { minHeight: 60, paddingTop: 10 }]}
                  maxLength={160}
                />
              </Field>

              <Field label={t("seller_coupons.field_type")}>
                <View style={styles.typeRow}>
                  {TYPES.map((typ) => {
                    const sel = type === typ.key;
                    return (
                      <Pressable
                        key={typ.key}
                        onPress={() => setType(typ.key)}
                        style={[styles.typeChip, sel && styles.typeChipSel]}
                        testID={`new-coupon-type-${typ.key}`}
                      >
                        <Text style={[styles.typeText, sel && styles.typeTextSel]}>
                          {t(`seller_coupons.${typ.tkey}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              {type !== "free_shipping" ? (
                <Field
                  label={type === "percent" ? t("seller_coupons.field_percent") : t("seller_coupons.field_amount")}
                >
                  <TextInput
                    testID="new-coupon-value"
                    value={value}
                    onChangeText={setValue}
                    placeholder={type === "percent" ? "10" : "15"}
                    keyboardType="numeric"
                    placeholderTextColor={colors.textFaint}
                    style={styles.input}
                  />
                </Field>
              ) : null}

              <Field label={t("seller_coupons.field_min_spend")}>
                <TextInput
                  testID="new-coupon-min"
                  value={minOrder}
                  onChangeText={setMinOrder}
                  placeholder="50"
                  keyboardType="numeric"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                />
              </Field>

              <Field label={t("seller_coupons.field_total_uses")}>
                <TextInput
                  testID="new-coupon-limit"
                  value={usageLimit}
                  onChangeText={setUsageLimit}
                  placeholder="100"
                  keyboardType="numeric"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                />
              </Field>

              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.switchTitle}>{t("seller_coupons.field_active")}</Text>
                  <Text style={styles.switchSub}>
                    {t("seller_coupons.field_active_sub")}
                  </Text>
                </View>
                <Switch
                  value={active}
                  onValueChange={setActive}
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              </View>

              <Pressable
                disabled={busy}
                onPress={submit}
                testID="new-coupon-submit"
                style={({ pressed }) => [
                  styles.submit,
                  pressed && { transform: [{ scale: 0.98 }] },
                  busy && { opacity: 0.7 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>{t("seller_coupons.create_btn")}</Text>
                )}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "800", color: colors.text },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  createBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  loading: { padding: spacing.xl, alignItems: "center" },
  empty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm, marginTop: 40 },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  emptySub: { color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  emptyCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: spacing.md,
  },
  emptyCtaText: { color: "#fff", fontWeight: "800" },
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  code: { fontWeight: "800", color: colors.text, fontSize: 15, letterSpacing: 1 },
  actionsHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusOn: { backgroundColor: "#ECFDF5" },
  statusOff: { backgroundColor: colors.surfaceMuted },
  statusText: { fontSize: 11, fontWeight: "800" },
  deleteBtn: { padding: 4 },
  cardDesc: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  tagOuter: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  meta: { color: colors.textFaint, fontSize: 11 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    color: colors.text,
    fontWeight: "700",
    marginBottom: 6,
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.text,
    fontSize: 15,
  },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: "transparent",
  },
  typeChipSel: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  typeText: { color: colors.textMuted, fontWeight: "700" },
  typeTextSel: { color: colors.primary },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  switchTitle: { fontWeight: "700", color: colors.text },
  switchSub: { color: colors.textMuted, fontSize: 12 },
  submit: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
