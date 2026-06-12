/**
 * SizeGuideModal — bottom-sheet showing country-wise size conversion
 * tables for a product's category, plus a "Find my size" recommender
 * that asks the backend for a best-fit match given body measurements.
 *
 * Pulls every chart from `GET /api/size-guide?category=…` so the data
 * stays in sync with the backend (which we can update without shipping
 * a new mobile build).
 */
import { Ruler, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useRegion } from "@/src/contexts/RegionContext";
import { BodyFigure, GarmentDiagram } from "@/src/components/SizeGuideFigures";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type ColumnDef = { key: string; label: string };
type Row = Record<string, string>;
type Table = {
  id: string;
  label: string;
  kind: "apparel" | "shoes" | "kids" | "heritage" | "jewelry";
  columns: ColumnDef[];
  extra_columns: ColumnDef[];
  product_columns?: ColumnDef[];
  rows: Row[];
  note?: string;
  gender_hint?: "women" | "men";
};
type GuideResponse = { countries: string[]; categories: Table[] };

type Props = {
  visible: boolean;
  onClose: () => void;
  category?: string;
  subcategory?: string;
  gender?: "women" | "men";
};

export default function SizeGuideModal({ visible, onClose, category, gender }: Props) {
  const { country } = useRegion();
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState<GuideResponse | null>(null);
  const [activeTabId, setActiveTabId] = useState<string>("");

  useEffect(() => {
    if (!visible || !category) return;
    setLoading(true);
    const q = new URLSearchParams({ category });
    if (gender) q.append("gender", gender);
    api<GuideResponse>(`/size-guide?${q.toString()}`, { auth: false })
      .then((data) => {
        setGuide(data);
        setActiveTabId(data.categories[0]?.id || "");
      })
      .catch(() => setGuide(null))
      .finally(() => setLoading(false));
  }, [visible, category, gender]);

  const activeTable = useMemo(
    () => guide?.categories.find((c) => c.id === activeTabId) || null,
    [guide, activeTabId],
  );

  const buyerCountry = (country || "NZ").toUpperCase();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="size-guide-modal"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ruler size={18} color={colors.text} />
              <Text style={styles.title}>Size guide</Text>
              <View style={styles.countryPill}>
                <Text style={styles.countryPillText}>You · {buyerCountry}</Text>
              </View>
            </View>
            <Pressable
              testID="size-guide-close"
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
            >
              <X size={20} color={colors.text} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loader}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : !guide || guide.categories.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No size chart for this category yet. Check the product description for
                measurements.
              </Text>
            </View>
          ) : (
            <>
              {/* Tabs */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsRow}
              >
                {guide.categories.map((t) => {
                  const active = t.id === activeTabId;
                  return (
                    <Pressable
                      key={t.id}
                      testID={`size-guide-tab-${t.id}`}
                      onPress={() => setActiveTabId(t.id)}
                      style={[styles.tab, active && styles.tabActive]}
                    >
                      <Text style={[styles.tabText, active && styles.tabTextActive]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  testID="size-guide-tab-find"
                  onPress={() => setActiveTabId("__find__")}
                  style={[styles.tab, activeTabId === "__find__" && styles.tabActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeTabId === "__find__" && styles.tabTextActive,
                    ]}
                  >
                    Find my size
                  </Text>
                </Pressable>
              </ScrollView>

              {activeTabId === "__find__" ? (
                <FindMySize
                  defaultKind={
                    guide.categories[0]?.kind === "shoes"
                      ? "shoes"
                      : guide.categories[0]?.kind === "kids"
                      ? "kids"
                      : "apparel"
                  }
                  gender={gender || guide.categories[0]?.gender_hint}
                  buyerCountry={buyerCountry}
                />
              ) : activeTable ? (
                <SizeTable table={activeTable} buyerCountry={buyerCountry} />
              ) : null}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SizeTable({ table, buyerCountry }: { table: Table; buyerCountry: string }) {
  const [unit, setUnit] = useState<"cm" | "in">("cm");
  const hasProductCols = !!(table.product_columns && table.product_columns.length > 0);
  const [chartMode, setChartMode] = useState<"body" | "product">("body");

  const baseCols: ColumnDef[] = useMemo(
    () => [
      { key: "label", label: "Size" },
      ...table.columns.filter((c) => c.key !== "label"),
      ...(chartMode === "product" && hasProductCols
        ? (table.product_columns as ColumnDef[])
        : table.extra_columns),
    ],
    [table, chartMode, hasProductCols],
  );

  // Re-label and convert cm/inch values on the fly.
  const cols: ColumnDef[] = useMemo(
    () =>
      baseCols.map((c) => {
        if (unit === "in" && c.label.includes("(cm)")) {
          return { ...c, label: c.label.replace("(cm)", "(in)") };
        }
        return c;
      }),
    [baseCols, unit],
  );

  function fmt(val: string | undefined, key: string): string {
    if (val == null || val === "") return "—";
    if (unit !== "in") return val;
    // Convert ranges or single numbers from cm → inches when the column is *_cm.
    if (!key.endsWith("_cm") && !key.includes("foot_cm")) return val;
    const conv = (n: number) => (n * 0.3937).toFixed(1).replace(/\.0$/, "");
    if (val.includes("-")) {
      const [lo, hi] = val.split("-").map((s) => parseFloat(s));
      if (!isNaN(lo) && !isNaN(hi)) return `${conv(lo)}-${conv(hi)}`;
    }
    const n = parseFloat(val);
    if (!isNaN(n)) return conv(n);
    return val;
  }

  return (
    <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
      {/* IN/CM + Body/Product toggles */}
      <View style={styles.toggleBar}>
        {hasProductCols ? (
          <View style={styles.segmented}>
            <Pressable
              testID="chart-body"
              onPress={() => setChartMode("body")}
              style={[styles.segment, chartMode === "body" && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, chartMode === "body" && styles.segmentTextActive]}>
                Body chart
              </Text>
            </Pressable>
            <Pressable
              testID="chart-product"
              onPress={() => setChartMode("product")}
              style={[styles.segment, chartMode === "product" && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, chartMode === "product" && styles.segmentTextActive]}>
                Product chart
              </Text>
            </Pressable>
          </View>
        ) : <View />}
        <View style={styles.unitPill}>
          <Pressable
            testID="unit-cm"
            onPress={() => setUnit("cm")}
            style={[styles.unitSeg, unit === "cm" && styles.unitSegActive]}
          >
            <Text style={[styles.unitText, unit === "cm" && styles.unitTextActive]}>CM</Text>
          </Pressable>
          <Pressable
            testID="unit-in"
            onPress={() => setUnit("in")}
            style={[styles.unitSeg, unit === "in" && styles.unitSegActive]}
          >
            <Text style={[styles.unitText, unit === "in" && styles.unitTextActive]}>IN</Text>
          </Pressable>
        </View>
      </View>

      {/* Product-chart garment diagram (top, when applicable) */}
      {chartMode === "product" && hasProductCols ? (
        <GarmentDiagram
          values={{
            shoulder: fmt(table.rows[Math.floor(table.rows.length / 2)]?.g_shoulder_cm, "g_shoulder_cm"),
            chest: fmt(table.rows[Math.floor(table.rows.length / 2)]?.g_chest_cm, "g_chest_cm"),
            length: fmt(table.rows[Math.floor(table.rows.length / 2)]?.g_length_cm, "g_length_cm"),
            sleeve: fmt(table.rows[Math.floor(table.rows.length / 2)]?.g_sleeve_cm, "g_sleeve_cm"),
          }}
        />
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.row, styles.headerRow]}>
            {cols.map((c) => (
              <Text
                key={c.key}
                style={[
                  styles.cell,
                  styles.cellHeader,
                  c.key === buyerCountry && styles.cellHeaderHighlight,
                ]}
              >
                {c.label}
              </Text>
            ))}
          </View>
          {table.rows.map((row, i) => (
            <View
              key={`${row.label}-${i}`}
              style={[styles.row, i % 2 === 0 ? styles.rowAlt : null]}
              testID={`size-row-${row.label}`}
            >
              {cols.map((c) => (
                <Text
                  key={c.key}
                  style={[
                    styles.cell,
                    c.key === "label" && styles.cellLabel,
                    c.key === buyerCountry && styles.cellHighlight,
                  ]}
                >
                  {fmt(row[c.key], c.key)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {table.note ? <Text style={styles.note}>{table.note}</Text> : null}
    </ScrollView>
  );
}

function FindMySize({
  defaultKind,
  gender,
  buyerCountry,
}: {
  defaultKind: "apparel" | "shoes" | "kids";
  gender?: "women" | "men";
  buyerCountry: string;
}) {
  const [bust, setBust] = useState("");
  const [waist, setWaist] = useState("");
  const [hip, setHip] = useState("");
  const [chest, setChest] = useState("");
  const [foot, setFoot] = useState("");
  const [height, setHeight] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Row | null | undefined>(undefined);

  const submit = useCallback(async () => {
    setLoading(true);
    setResult(undefined);
    const q = new URLSearchParams({ kind: defaultKind });
    if (gender) q.append("gender", gender);
    if (bust) q.append("bust_cm", bust);
    if (chest) q.append("chest_cm", chest);
    if (waist) q.append("waist_cm", waist);
    if (hip) q.append("hip_cm", hip);
    if (foot) q.append("foot_cm", foot);
    if (height) q.append("height_cm", height);
    try {
      const r = await api<{ match: Row | null }>(`/size-guide/recommend?${q.toString()}`, {
        auth: false,
      });
      setResult(r.match);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [defaultKind, gender, bust, chest, waist, hip, foot, height]);

  return (
    <ScrollView
      style={{ maxHeight: 440 }}
      contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: spacing.md }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.findIntro}>
        Tell us your measurements (cm). We&apos;ll match the size most likely to fit you.
      </Text>

      <BodyFigure
        kind={defaultKind}
        gender={gender}
        values={{
          bust: bust || undefined,
          chest: chest || undefined,
          waist: waist || undefined,
          hip: hip || undefined,
          height: height || undefined,
        }}
      />

      {defaultKind === "apparel" ? (
        <>
          {gender === "men" ? (
            <Measure label="Chest" value={chest} onChange={setChest} testID="m-chest" />
          ) : (
            <Measure label="Bust" value={bust} onChange={setBust} testID="m-bust" />
          )}
          <Measure label="Waist" value={waist} onChange={setWaist} testID="m-waist" />
          {gender !== "men" ? (
            <Measure label="Hip" value={hip} onChange={setHip} testID="m-hip" />
          ) : null}
        </>
      ) : null}
      {defaultKind === "shoes" ? (
        <Measure label="Foot length" value={foot} onChange={setFoot} testID="m-foot" />
      ) : null}
      {defaultKind === "kids" ? (
        <Measure label="Height" value={height} onChange={setHeight} testID="m-height" />
      ) : null}

      <Pressable
        testID="size-guide-recommend-btn"
        onPress={submit}
        disabled={loading}
        style={({ pressed }) => [
          styles.recommendBtn,
          loading && { opacity: 0.5 },
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.recommendBtnText}>Find my size</Text>
        )}
      </Pressable>

      {result === null ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultMiss}>
            Couldn&apos;t match — try adding more measurements or check the chart.
          </Text>
        </View>
      ) : result ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultLabel}>Your recommended size · {buyerCountry}</Text>
          <Text style={styles.resultSize}>{result[buyerCountry] || result.label}</Text>
          <Text style={styles.resultEq}>Label on tag: {result.label}</Text>
          <View style={styles.resultGrid}>
            {["US", "UK", "EU", "AU", "NZ", "CA", "IN"].map((c) =>
              result[c] ? (
                <View
                  key={c}
                  style={[
                    styles.resultChip,
                    c === buyerCountry && styles.resultChipActive,
                  ]}
                >
                  <Text style={styles.resultChipKey}>{c}</Text>
                  <Text style={styles.resultChipValue}>{result[c]}</Text>
                </View>
              ) : null,
            )}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Measure({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  testID?: string;
}) {
  return (
    <View style={styles.measureRow}>
      <Text style={styles.measureLabel}>{label}</Text>
      <View style={styles.measureInputWrap}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ""))}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.textFaint}
          style={styles.measureInput}
        />
        <Text style={styles.measureUnit}>cm</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  countryPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countryPillText: { fontSize: 11, color: colors.primary, fontWeight: "800", letterSpacing: 0.5 },
  closeBtn: { padding: 4, borderRadius: 999 },
  loader: { paddingVertical: 60, alignItems: "center" },
  empty: { paddingVertical: 40, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  tabsRow: { flexDirection: "row", gap: 8, paddingVertical: 4, marginBottom: spacing.sm },
  tab: {
    minHeight: 34,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.text, borderColor: colors.text },
  tabText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#fff" },
  row: { flexDirection: "row" },
  headerRow: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
  },
  rowAlt: { backgroundColor: "#fafafa" },
  cell: {
    minWidth: 78,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 12.5,
    color: colors.text,
    textAlign: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cellHeader: { fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
  cellHeaderHighlight: { color: colors.primary, backgroundColor: colors.primarySoft },
  cellLabel: { fontWeight: "800" },
  cellHighlight: { backgroundColor: "#FEF3E7", color: colors.text, fontWeight: "700" },
  note: {
    marginTop: spacing.md,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
    lineHeight: 17,
  },
  findIntro: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  measureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  measureLabel: { fontSize: 14, fontWeight: "700", color: colors.text },
  measureInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    width: 120,
  },
  measureInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.text },
  measureUnit: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  recommendBtn: {
    marginTop: spacing.md,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  recommendBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  resultBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  resultLabel: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 1 },
  resultSize: {
    fontSize: 38,
    fontWeight: "900",
    color: colors.success,
    letterSpacing: -1,
    marginVertical: 4,
  },
  resultEq: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginBottom: 6 },
  resultGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  resultChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  resultChipActive: { borderColor: colors.success, backgroundColor: colors.successSoft },
  resultChipKey: { fontSize: 10, color: colors.textMuted, fontWeight: "800" },
  resultChipValue: { fontSize: 12, color: colors.text, fontWeight: "700" },
  resultMiss: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  toggleBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
    gap: 8,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  segmentActive: { backgroundColor: colors.text },
  segmentText: { fontSize: 12, fontWeight: "700", color: colors.text },
  segmentTextActive: { color: "#fff" },
  unitPill: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unitSeg: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, minWidth: 40, alignItems: "center" },
  unitSegActive: { backgroundColor: colors.primary },
  unitText: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
  unitTextActive: { color: "#fff" },
});
