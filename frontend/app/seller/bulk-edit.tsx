/**
 * Seller bulk-edit screen.
 *
 * Multi-select listings then apply one bulk operation:
 *   - Set price (flat NZD)
 *   - Adjust price by % (e.g. -10% sale)
 *   - Set stock count
 *   - Adjust stock by delta
 *   - Change category
 *   - Mark in-stock / out-of-stock
 *   - Delete
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  CheckSquare,
  ChevronLeft,
  Square,
  Trash2,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Listing = {
  id: string;
  name: string;
  image: string;
  category: string;
  price_nzd: number;
  stock_count: number;
  in_stock: boolean;
};

type Action =
  | "set_price"
  | "adjust_price_pct"
  | "set_stock"
  | "adjust_stock"
  | "set_category"
  | "set_in_stock"
  | "delete";

const ACTION_LABELS: { key: Action; label: string; hint: string }[] = [
  { key: "set_price", label: "Set price", hint: "Same NZD price for all selected" },
  { key: "adjust_price_pct", label: "Adjust price %", hint: "+/- percentage change" },
  { key: "set_stock", label: "Set stock", hint: "Same stock count for all" },
  { key: "adjust_stock", label: "Adjust stock", hint: "+/- delta from current" },
  { key: "set_category", label: "Change category", hint: "Move into another category" },
  { key: "set_in_stock", label: "Toggle availability", hint: "Mark as in/out of stock" },
  { key: "delete", label: "Delete", hint: "Permanently remove (cannot undo)" },
];

export default function BulkEditScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>("set_price");
  const [price, setPrice] = useState("");
  const [pct, setPct] = useState("");
  const [stock, setStock] = useState("");
  const [stockDelta, setStockDelta] = useState("");
  const [category, setCategory] = useState("");
  const [inStock, setInStock] = useState(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const l = await api<Listing[]>("/seller/products");
      setItems(l);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  const toggleOne = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const validate = (): { ok: true; payload: Record<string, any> } | { ok: false; msg: string } => {
    if (selected.size === 0) return { ok: false, msg: "Select at least one listing" };
    const ids = Array.from(selected);
    if (action === "set_price") {
      const n = parseFloat(price);
      if (!isFinite(n) || n <= 0) return { ok: false, msg: "Enter a valid price > 0" };
      return { ok: true, payload: { product_ids: ids, action, price_nzd: n } };
    }
    if (action === "adjust_price_pct") {
      const n = parseFloat(pct);
      if (!isFinite(n)) return { ok: false, msg: "Enter a percentage like -10 or 15" };
      if (n <= -100) return { ok: false, msg: "Percentage would zero/negate price" };
      return { ok: true, payload: { product_ids: ids, action, pct: n } };
    }
    if (action === "set_stock") {
      const n = parseInt(stock, 10);
      if (!isFinite(n) || n < 0) return { ok: false, msg: "Enter a stock count >= 0" };
      return { ok: true, payload: { product_ids: ids, action, stock_count: n } };
    }
    if (action === "adjust_stock") {
      const n = parseInt(stockDelta, 10);
      if (!isFinite(n)) return { ok: false, msg: "Enter a stock delta like -5 or +10" };
      return { ok: true, payload: { product_ids: ids, action, stock_delta: n } };
    }
    if (action === "set_category") {
      if (!category.trim()) return { ok: false, msg: "Enter a category name" };
      return { ok: true, payload: { product_ids: ids, action, category: category.trim() } };
    }
    if (action === "set_in_stock") {
      return { ok: true, payload: { product_ids: ids, action, in_stock: inStock } };
    }
    // delete
    return { ok: true, payload: { product_ids: ids, action } };
  };

  const confirm = useConfirm();
  const toast = useToast();

  const apply = async () => {
    const v = validate();
    if (!v.ok) {
      toast.show({ kind: "error", title: "Can't apply", body: v.msg });
      return;
    }
    const doIt = async () => {
      setWorking(true);
      try {
        const res = await api<{ matched: number; modified: number; deleted: number }>(
          "/seller/products/bulk",
          { method: "POST", body: v.payload },
        );
        toast.show({
          kind: "success",
          title: "Done",
          body: action === "delete"
            ? `${res.deleted} listing${res.deleted === 1 ? "" : "s"} deleted.`
            : `${res.modified} listing${res.modified === 1 ? "" : "s"} updated.`,
        });
        setSelected(new Set());
        setPrice(""); setPct(""); setStock(""); setStockDelta(""); setCategory("");
        await load();
      } catch (e: any) {
        toast.show({ kind: "error", title: "Couldn't apply", body: e?.message || "Please try again." });
      } finally {
        setWorking(false);
      }
    };
    if (action === "delete") {
      const ok = await confirm({
        title: "Delete listings?",
        message: `Permanently remove ${selected.size} listing${selected.size === 1 ? "" : "s"}? This cannot be undone.`,
        destructive: true,
        confirmLabel: "Delete",
      });
      if (ok) doIt();
    } else {
      doIt();
    }
  };

  const summaryText = useMemo(() => {
    if (selected.size === 0) return "0 selected";
    return `${selected.size} of ${items.length} selected`;
  }, [selected, items.length]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="bulk-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Bulk edit listings</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 260 }}
          ListHeaderComponent={
            <View>
              <View style={styles.selectAllRow}>
                <Pressable testID="bulk-select-all" onPress={toggleAll} style={styles.selectAllBtn}>
                  {allSelected ? (
                    <CheckSquare size={18} color={colors.primary} />
                  ) : (
                    <Square size={18} color={colors.textMuted} />
                  )}
                  <Text style={styles.selectAllText}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </Text>
                </Pressable>
                <Text style={styles.summaryText}>{summaryText}</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const isSel = selected.has(item.id);
            return (
              <Pressable
                testID={`bulk-row-${item.id}`}
                onPress={() => toggleOne(item.id)}
                style={[styles.row, isSel && styles.rowActive]}
              >
                {isSel ? (
                  <CheckSquare size={20} color={colors.primary} />
                ) : (
                  <Square size={20} color={colors.textFaint} />
                )}
                <Image source={{ uri: item.image }} style={styles.thumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                  <Text style={styles.itemMeta}>
                    {formatNZD(item.price_nzd)} · stock {item.stock_count}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No listings yet.</Text>
            </View>
          }
        />
      )}

      {/* Bottom action sheet */}
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <Text style={styles.sheetLabel}>Choose an action</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {ACTION_LABELS.map((a) => {
            const active = a.key === action;
            return (
              <Pressable
                key={a.key}
                testID={`bulk-action-${a.key}`}
                onPress={() => setAction(a.key)}
                style={[styles.chip, active && styles.chipActive, a.key === "delete" && active && styles.chipDanger]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Action input */}
        <View style={styles.inputWrap}>
          {action === "set_price" ? (
            <TextInput
              testID="bulk-input-price"
              value={price}
              onChangeText={(t) => setPrice(t.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              placeholder="e.g. 49.99"
              style={styles.input}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}
          {action === "adjust_price_pct" ? (
            <TextInput
              testID="bulk-input-pct"
              value={pct}
              onChangeText={(t) => setPct(t.replace(/[^0-9.\-]/g, ""))}
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. -10 for 10% off, 15 for +15%"
              style={styles.input}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}
          {action === "set_stock" ? (
            <TextInput
              testID="bulk-input-stock"
              value={stock}
              onChangeText={(t) => setStock(t.replace(/[^0-9]/g, ""))}
              keyboardType="numeric"
              placeholder="New total stock count"
              style={styles.input}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}
          {action === "adjust_stock" ? (
            <TextInput
              testID="bulk-input-stock-delta"
              value={stockDelta}
              onChangeText={(t) => setStockDelta(t.replace(/[^0-9\-]/g, ""))}
              keyboardType="numbers-and-punctuation"
              placeholder="+/- delta (e.g. -2 or 10)"
              style={styles.input}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}
          {action === "set_category" ? (
            <TextInput
              testID="bulk-input-category"
              value={category}
              onChangeText={setCategory}
              placeholder="e.g. Ethnic Fashion"
              style={styles.input}
              placeholderTextColor={colors.textFaint}
            />
          ) : null}
          {action === "set_in_stock" ? (
            <View style={styles.toggleRow}>
              <Pressable
                testID="bulk-instock-yes"
                onPress={() => setInStock(true)}
                style={[styles.toggleBtn, inStock && styles.toggleBtnOn]}
              >
                <Text style={[styles.toggleText, inStock && styles.toggleTextOn]}>In stock</Text>
              </Pressable>
              <Pressable
                testID="bulk-instock-no"
                onPress={() => setInStock(false)}
                style={[styles.toggleBtn, !inStock && styles.toggleBtnOn]}
              >
                <Text style={[styles.toggleText, !inStock && styles.toggleTextOn]}>Out of stock</Text>
              </Pressable>
            </View>
          ) : null}
          {action === "delete" ? (
            <View style={styles.deleteWarn}>
              <Trash2 size={14} color={colors.error} />
              <Text style={styles.deleteWarnText}>This will permanently delete selected listings.</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          testID="bulk-apply"
          onPress={apply}
          disabled={working || selected.size === 0}
          style={[
            styles.applyBtn,
            action === "delete" && styles.applyDanger,
            (working || selected.size === 0) && styles.applyDisabled,
          ]}
        >
          {working ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.applyText}>
              {action === "delete" ? `Delete ${selected.size}` : `Apply to ${selected.size}`}
            </Text>
          )}
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  selectAllRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm },
  selectAllBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  selectAllText: { fontWeight: "700", color: colors.text, fontSize: 13 },
  summaryText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", marginBottom: 8 },
  rowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  thumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surface },
  itemName: { fontSize: 13, color: colors.text, fontWeight: "600", lineHeight: 17 },
  itemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  empty: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 13 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 10 },
  sheetLabel: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 1, textTransform: "uppercase" },
  chipsRow: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipDanger: { backgroundColor: colors.error, borderColor: colors.error },
  chipText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  inputWrap: { },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.text, backgroundColor: "#fff" },
  toggleRow: { flexDirection: "row", gap: 10 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", backgroundColor: "#fff" },
  toggleBtnOn: { backgroundColor: colors.text, borderColor: colors.text },
  toggleText: { color: colors.text, fontWeight: "700" },
  toggleTextOn: { color: "#fff" },
  deleteWarn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: "#FEE2E2" },
  deleteWarnText: { color: "#7F1D1D", fontSize: 12, flex: 1, fontWeight: "600" },
  applyBtn: { height: 50, borderRadius: radius.pill, backgroundColor: colors.text, alignItems: "center", justifyContent: "center" },
  applyDanger: { backgroundColor: colors.error },
  applyDisabled: { opacity: 0.4 },
  applyText: { color: "#fff", fontSize: 15, fontWeight: "800", letterSpacing: 0.3 },
});
