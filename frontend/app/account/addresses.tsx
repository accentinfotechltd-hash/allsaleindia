import { useRouter } from "expo-router";
import {
  Check,
  ChevronLeft,
  MapPin,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { colors, radius, spacing } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

type Address = {
  id: string;
  label: string;
  full_name: string;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code: string;
  country: string;
  is_default: boolean;
};

const EMPTY: Omit<Address, "id" | "is_default"> = {
  label: "",
  full_name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "NZ",
};

export default function AddressesScreen() {
  const router = useRouter();
  const { show } = useToast();
  const confirm = useConfirm();

  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<Address | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ addresses: Address[] }>("/account/addresses");
      setItems(data.addresses || []);
    } catch (e: any) {
      show({ title: e?.message || "Failed to load addresses", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setCreateOpen(true);
  };

  const openEdit = (a: Address) => {
    setEditing(a);
    setForm({
      label: a.label,
      full_name: a.full_name,
      phone: a.phone || "",
      line1: a.line1,
      line2: a.line2 || "",
      city: a.city,
      state: a.state || "",
      postal_code: a.postal_code,
      country: a.country,
    });
    setCreateOpen(true);
  };

  const onSave = async () => {
    if (!form.label.trim() || !form.full_name.trim() || !form.line1.trim() ||
        !form.city.trim() || !form.postal_code.trim() || !form.country.trim()) {
      show({ title: "Fill all required fields", kind: "error" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        country: form.country.toUpperCase().slice(0, 2),
      };
      if (editing) {
        await api(`/account/addresses/${editing.id}`, {
          method: "PATCH",
          body,
        });
      } else {
        await api(`/account/addresses`, { method: "POST", body });
      }
      setCreateOpen(false);
      setEditing(null);
      show({
        title: editing ? "Address updated" : "Address saved",
        kind: "success",
      });
      await load();
    } catch (e: any) {
      show({ title: e?.message || "Save failed", kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  const onSetDefault = async (a: Address) => {
    if (a.is_default) return;
    try {
      await api(`/account/addresses/${a.id}/default`, { method: "POST" });
      show({ title: `${a.label} set as default`, kind: "success" });
      await load();
    } catch {
      show({ title: "Could not set default", kind: "error" });
    }
  };

  const onDelete = async (a: Address) => {
    const ok = await confirm({
      title: `Delete "${a.label}"?`,
      message: a.is_default
        ? "This is your default address. Another will be promoted automatically."
        : "This address will be permanently removed.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/account/addresses/${a.id}`, { method: "DELETE" });
      show({ title: "Address removed", kind: "success" });
      await load();
    } catch {
      show({ title: "Delete failed", kind: "error" });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Saved addresses</Text>
        <Pressable onPress={openCreate} style={styles.headerBtn} testID="addr-add-btn">
          <Plus size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <MapPin size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No saved addresses yet</Text>
            <Text style={styles.emptyBody}>
              Add up to 25 addresses for faster checkout.
            </Text>
            <Pressable onPress={openCreate} style={styles.emptyCta}>
              <Plus size={16} color="#fff" />
              <Text style={styles.emptyCtaText}>Add first address</Text>
            </Pressable>
          </View>
        ) : (
          items.map((a) => (
            <View
              key={a.id}
              style={[styles.card, a.is_default && styles.cardDefault]}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardLabel}>{a.label}</Text>
                {a.is_default && (
                  <View style={styles.defaultChip}>
                    <Star size={11} color="#92400E" />
                    <Text style={styles.defaultChipText}>DEFAULT</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardName}>{a.full_name}</Text>
              <Text style={styles.cardLine}>{a.line1}</Text>
              {!!a.line2 && <Text style={styles.cardLine}>{a.line2}</Text>}
              <Text style={styles.cardLine}>
                {a.city}
                {a.state ? `, ${a.state}` : ""} {a.postal_code} · {a.country}
              </Text>
              {!!a.phone && <Text style={styles.cardPhone}>{a.phone}</Text>}

              <View style={styles.cardActions}>
                {!a.is_default && (
                  <Pressable
                    onPress={() => onSetDefault(a)}
                    style={styles.actionBtn}
                  >
                    <Check size={14} color={colors.text} />
                    <Text style={styles.actionBtnText}>Set default</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => openEdit(a)} style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => onDelete(a)}
                  style={[styles.actionBtn, styles.actionDanger]}
                >
                  <Trash2 size={14} color="#DC2626" />
                  <Text
                    style={[styles.actionBtnText, { color: "#DC2626" }]}
                  >
                    Delete
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
        <View style={{ height: 64 }} />
      </ScrollView>

      {/* CREATE/EDIT MODAL */}
      <Modal
        visible={createOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateOpen(false)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {editing ? "Edit address" : "New address"}
              </Text>
              <Pressable onPress={() => setCreateOpen(false)}>
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 520 }}>
              <FormField
                label="Label *"
                value={form.label}
                onChange={(v) => setForm({ ...form, label: v })}
                placeholder="Home / Work / Mum"
              />
              <FormField
                label="Full name *"
                value={form.full_name}
                onChange={(v) => setForm({ ...form, full_name: v })}
              />
              <FormField
                label="Phone"
                value={form.phone || ""}
                onChange={(v) => setForm({ ...form, phone: v })}
                keyboardType="phone-pad"
              />
              <FormField
                label="Address line 1 *"
                value={form.line1}
                onChange={(v) => setForm({ ...form, line1: v })}
              />
              <FormField
                label="Address line 2"
                value={form.line2 || ""}
                onChange={(v) => setForm({ ...form, line2: v })}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 2 }}>
                  <FormField
                    label="City *"
                    value={form.city}
                    onChange={(v) => setForm({ ...form, city: v })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField
                    label="State"
                    value={form.state || ""}
                    onChange={(v) => setForm({ ...form, state: v })}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 2 }}>
                  <FormField
                    label="Postal code *"
                    value={form.postal_code}
                    onChange={(v) => setForm({ ...form, postal_code: v })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField
                    label="Country *"
                    value={form.country}
                    onChange={(v) =>
                      setForm({ ...form, country: v.toUpperCase().slice(0, 2) })
                    }
                    placeholder="NZ"
                  />
                </View>
              </View>
            </ScrollView>

            <Pressable
              onPress={onSave}
              disabled={saving}
              style={[styles.saveBtn, saving && { opacity: 0.5 }]}
              testID="addr-save-btn"
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {editing ? "Save changes" : "Add address"}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "phone-pad" | "email-address";
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType || "default"}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  scroll: { padding: spacing.md },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.md, marginTop: 32 },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  emptyBody: { color: colors.textMuted, textAlign: "center", fontSize: 13 },
  emptyCta: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999, marginTop: spacing.sm,
  },
  emptyCtaText: { color: "#fff", fontWeight: "700" },
  card: {
    backgroundColor: "#fff", borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardDefault: { borderColor: "#FCD34D", backgroundColor: "#FFFBEB" },
  cardHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  cardLabel: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 14 },
  cardName: { color: colors.text, fontWeight: "700", fontSize: 13, marginTop: 4 },
  cardLine: { color: colors.text, fontSize: 13, lineHeight: 18 },
  cardPhone: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  defaultChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  defaultChipText: { color: "#92400E", fontWeight: "800", fontSize: 9, letterSpacing: 0.3 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: colors.border,
  },
  actionDanger: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  actionBtnText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.lg, maxHeight: "92%",
  },
  modalHead: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 16 },
  fieldLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700", marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff",
    color: colors.text, fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.md,
    alignItems: "center", marginTop: spacing.md,
  },
  saveBtnText: { color: "#fff", fontWeight: "800" },
});
