import { useRouter } from "expo-router";
import { ChevronLeft, Plus, Power, Trash2, X, Zap } from "lucide-react-native";
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
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Sale = {
  id: string;
  product_id: string;
  sale_price_nzd: number;
  original_price_nzd: number;
  discount_pct: number;
  valid_from: string;
  valid_to: string;
  units_max: number;
  units_sold: number;
  featured: boolean;
  active: boolean;
};
type Product = { id: string; name: string; price_nzd: number };

export default function SellerFlashSales() {
  const { show } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sales, listings] = await Promise.all([
        api<Sale[]>("/seller/flash-sales"),
        api<Product[]>("/seller/products"),
      ]);
      setItems(sales || []);
      setProducts((listings || []).map((p: any) => ({ id: p.id, name: p.name, price_nzd: p.price_nzd })));
    } catch (e: any) {
      show({ title: "Couldn't load", message: e?.message || "Try again.", kind: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (s: Sale) => {
    try {
      await api(`/seller/flash-sales/${s.id}`, {
        method: "PATCH",
        body: { active: !s.active },
      });
      load();
    } catch (e: any) {
      show({ title: "Couldn't update", message: e?.message || "Try again.", kind: "error" });
    }
  };

  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (s: Sale) => {
    const ok = await confirm({
      title: "Delete flash sale?",
      message: "This cannot be undone.",
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api(`/seller/flash-sales/${s.id}`, { method: "DELETE" });
      toast.show({ kind: "success", title: "Flash sale deleted" });
      load();
    } catch (e: any) {
      toast.show({ kind: "error", title: "Couldn't delete", body: e?.message || "Try again." });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="seller-flash-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Flash Sales</Text>
        <Pressable
          onPress={() => setCreateOpen(true)}
          style={styles.createBtn}
          testID="seller-flash-new-btn"
        >
          <Plus size={16} color="#fff" />
          <Text style={styles.createBtnText}>New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#F97316" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Zap size={36} color="#F97316" fill="#F97316" />
          <Text style={styles.emptyTitle}>No flash sales yet</Text>
          <Text style={styles.emptySub}>
            Run time-boxed deals to drive urgency and clear inventory.
          </Text>
          <Pressable onPress={() => setCreateOpen(true)} style={styles.emptyCta} testID="seller-flash-empty-cta">
            <Plus size={16} color="#fff" />
            <Text style={styles.emptyCtaText}>Create your first sale</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((s) => {
            const pct = (s.units_sold / Math.max(1, s.units_max)) * 100;
            return (
              <View key={s.id} style={styles.card} testID={`flash-${s.id}`}>
                <View style={styles.cardHeader}>
                  <View style={styles.discountChip}>
                    <Text style={styles.discountText}>-{s.discount_pct}%</Text>
                  </View>
                  {s.featured ? (
                    <View style={styles.featuredChip}>
                      <Text style={styles.featuredText}>⭐ Featured</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => toggleActive(s)}
                    style={[styles.statusPill, s.active ? styles.statusOn : styles.statusOff]}
                    testID={`flash-toggle-${s.id}`}
                  >
                    <Power size={11} color={s.active ? colors.success : colors.textMuted} />
                    <Text style={[styles.statusText, { color: s.active ? colors.success : colors.textMuted }]}>
                      {s.active ? "Active" : "Paused"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => remove(s)} style={styles.delBtn} testID={`flash-delete-${s.id}`}>
                    <Trash2 size={14} color={colors.error} />
                  </Pressable>
                </View>

                <View style={styles.priceRow}>
                  <Text style={styles.sale}>{formatNZD(s.sale_price_nzd)}</Text>
                  <Text style={styles.original}>{formatNZD(s.original_price_nzd)}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.meta}>
                    Sold {s.units_sold}/{s.units_max}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.min(100, pct)}%` }]} />
                  </View>
                </View>

                <Text style={styles.dates}>
                  {new Date(s.valid_from).toLocaleString()} → {new Date(s.valid_to).toLocaleString()}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      <CreateModal
        visible={createOpen}
        products={products}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
    </SafeAreaView>
  );
}

function CreateModal({
  visible,
  products,
  onClose,
  onCreated,
}: {
  visible: boolean;
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [productId, setProductId] = useState<string>("");
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("1");
  const [unitsMax, setUnitsMax] = useState("50");
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setProductId(products[0]?.id || "");
      setPrice("");
      setDays("1");
      setUnitsMax("50");
      setFeatured(false);
    }
  }, [visible, products]);

  const submit = async () => {
    if (!productId) {
      show({ title: "Pick a product", message: "Select which product to put on sale.", kind: "error" });
      return;
    }
    const numPrice = parseFloat(price);
    const numDays = Math.max(1, Math.min(7, parseInt(days || "1", 10)));
    const numUnits = parseInt(unitsMax || "1", 10);
    if (!numPrice || numPrice <= 0) {
      show({ title: "Invalid price", message: "Sale price must be greater than 0.", kind: "error" });
      return;
    }
    if (numUnits < 1) {
      show({ title: "Invalid units", message: "Max units must be at least 1.", kind: "error" });
      return;
    }
    const from = new Date();
    const to = new Date(from.getTime() + numDays * 24 * 3600 * 1000);
    setBusy(true);
    try {
      await api("/seller/flash-sales", {
        method: "POST",
        body: {
          product_id: productId,
          sale_price_nzd: numPrice,
          valid_from: from.toISOString(),
          valid_to: to.toISOString(),
          units_max: numUnits,
          featured,
          active: true,
        },
      });
      onCreated();
    } catch (e: any) {
      show({ title: "Couldn't create", message: e?.message || "Try a different price/duration.", kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const picked = products.find((p) => p.id === productId);
  const original = picked?.price_nzd || 0;
  const numPrice = parseFloat(price);
  const discountPct =
    original > 0 && numPrice && numPrice < original
      ? Math.round((1 - numPrice / original) * 100)
      : 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New flash sale</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <X size={20} color={colors.text} />
            </Pressable>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <Text style={styles.label}>Product</Text>
              {products.length === 0 ? (
                <Text style={styles.helper}>You have no listings yet. Add one first.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {products.map((p) => {
                    const sel = productId === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setProductId(p.id)}
                        style={[styles.prodChip, sel && styles.prodChipSel]}
                        testID={`flash-prod-${p.id}`}
                      >
                        <Text style={[styles.prodChipText, sel && styles.prodChipTextSel]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={[styles.prodChipPrice, sel && { color: "#fff" }]}>
                          {formatNZD(p.price_nzd)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Text style={styles.label}>Sale price (NZD)</Text>
              <TextInput
                testID="flash-sale-price"
                value={price}
                onChangeText={setPrice}
                placeholder={original ? `Less than ${formatNZD(original)}` : "49.00"}
                keyboardType="numeric"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />
              {discountPct > 0 ? (
                <Text style={[styles.helper, discountPct < 10 && { color: colors.error }]}>
                  {discountPct < 10
                    ? `⚠️ Min discount is 10% (you're at ${discountPct}%)`
                    : `✓ ${discountPct}% off original price`}
                </Text>
              ) : null}

              <Text style={styles.label}>Duration (days, 1-7)</Text>
              <TextInput
                testID="flash-duration"
                value={days}
                onChangeText={setDays}
                keyboardType="numeric"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />

              <Text style={styles.label}>Max units to sell</Text>
              <TextInput
                testID="flash-units"
                value={unitsMax}
                onChangeText={setUnitsMax}
                keyboardType="numeric"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
              />

              <View style={styles.switchRow}>
                <View>
                  <Text style={styles.switchTitle}>Feature as Deal of the Day</Text>
                  <Text style={styles.switchSub}>Eligible for the home-screen hero banner</Text>
                </View>
                <Switch
                  value={featured}
                  onValueChange={setFeatured}
                  trackColor={{ true: "#F97316", false: colors.border }}
                />
              </View>

              <Pressable
                disabled={busy}
                onPress={submit}
                testID="flash-submit"
                style={({ pressed }) => [
                  styles.submit,
                  pressed && { transform: [{ scale: 0.98 }] },
                  busy && { opacity: 0.7 },
                ]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create flash sale</Text>}
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F97316", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  createBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  loading: { padding: spacing.xl, alignItems: "center" },
  empty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm, marginTop: 40 },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  emptySub: { color: colors.textMuted, textAlign: "center", paddingHorizontal: spacing.lg },
  emptyCta: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F97316", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, marginTop: spacing.md },
  emptyCtaText: { color: "#fff", fontWeight: "800" },
  list: { padding: spacing.lg, gap: spacing.md },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  discountChip: { backgroundColor: "#F97316", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  discountText: { color: "#fff", fontWeight: "800", fontSize: 11 },
  featuredChip: { backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#F97316", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  featuredText: { color: "#F97316", fontWeight: "800", fontSize: 10 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusOn: { backgroundColor: "#ECFDF5" },
  statusOff: { backgroundColor: colors.surfaceMuted },
  statusText: { fontSize: 11, fontWeight: "800" },
  delBtn: { padding: 4 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  sale: { fontSize: 18, fontWeight: "800", color: "#F97316" },
  original: { fontSize: 13, textDecorationLine: "line-through", color: colors.textMuted },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  meta: { color: colors.textMuted, fontSize: 11, fontWeight: "700", minWidth: 80 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#F97316" },
  dates: { color: colors.textFaint, fontSize: 11 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  closeBtn: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  label: { color: colors.text, fontWeight: "700", fontSize: 13 },
  helper: { color: colors.textMuted, fontSize: 11, marginTop: -4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", color: colors.text, fontSize: 15 },
  prodChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, maxWidth: 200 },
  prodChipSel: { backgroundColor: "#F97316" },
  prodChipText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  prodChipTextSel: { color: "#fff" },
  prodChipPrice: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  switchTitle: { fontWeight: "700", color: colors.text },
  switchSub: { color: colors.textMuted, fontSize: 12 },
  submit: { backgroundColor: "#F97316", paddingVertical: 14, borderRadius: radius.md, alignItems: "center", marginTop: spacing.md, marginBottom: spacing.xl },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
