import { Ruler, X } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, radius, spacing } from "@/src/lib/theme";
import { chartsForCategory, SizeChart, SizeRow } from "@/src/lib/sizeCharts";

type Props = {
  visible: boolean;
  onClose: () => void;
  category?: string;
  subcategory?: string;
};

export default function SizeGuideModal({ visible, onClose, category, subcategory }: Props) {
  const charts = useMemo(() => {
    const list = chartsForCategory(category, subcategory);
    return list.length > 0 ? list : [];
  }, [category, subcategory]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active: SizeChart | null = useMemo(() => {
    if (charts.length === 0) return null;
    return charts.find((c) => c.key === activeKey) || charts[0];
  }, [charts, activeKey]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} testID="size-guide-modal">
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <View style={styles.headerIcon}>
                <Ruler size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Size guide</Text>
                <Text style={styles.subtitle}>NZ ↔ Indian conversion</Text>
              </View>
              <Pressable
                testID="size-guide-close"
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={10}
              >
                <X size={18} color={colors.text} />
              </Pressable>
            </View>

            {charts.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingTop: 12 }}
              >
                {charts.map((c) => {
                  const selected = active?.key === c.key;
                  return (
                    <Pressable
                      key={c.key}
                      testID={`size-guide-tab-${c.key}`}
                      onPress={() => setActiveKey(c.key)}
                      style={({ pressed }) => [
                        styles.tab,
                        selected && styles.tabActive,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <Text style={[styles.tabText, selected && styles.tabTextActive]}>
                        {c.title}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
            showsVerticalScrollIndicator={false}
          >
            {active ? (
              <ChartView chart={active} />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No size chart for this item</Text>
                <Text style={styles.emptySub}>
                  Sizing is per-seller. Please check the product description.
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ChartView({ chart }: { chart: SizeChart }) {
  return (
    <View testID={`size-chart-${chart.key}`}>
      <Text style={styles.chartTitle}>{chart.title}</Text>
      <Text style={styles.chartSub}>{chart.subtitle}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={{ marginTop: 12 }}
      >
        <View>
          <View style={[styles.row, styles.rowHeader]}>
            {chart.headers.map((h) => (
              <View
                key={String(h.key)}
                style={[styles.cell, h.key === "nz" && styles.cellKey]}
              >
                <Text style={styles.cellHeaderText}>{h.label}</Text>
              </View>
            ))}
          </View>
          {chart.rows.map((r, i) => (
            <View
              key={i}
              style={[styles.row, i % 2 === 1 && { backgroundColor: colors.surface }]}
            >
              {chart.headers.map((h) => (
                <View
                  key={String(h.key)}
                  style={[styles.cell, h.key === "nz" && styles.cellKey]}
                >
                  <Text
                    style={[styles.cellText, h.key === "nz" && styles.cellKeyText]}
                    numberOfLines={1}
                  >
                    {(r[h.key as keyof SizeRow] as string) || "—"}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {chart.notes?.length ? (
        <View style={styles.notes}>
          {chart.notes.map((n, i) => (
            <View key={i} style={styles.noteRow}>
              <View style={styles.noteDot} />
              <Text style={styles.noteText}>{n}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={styles.footnote}>
        Measurements are a guide. Indian-made garments often run 5–10% smaller than NZ retail
        equivalents — when in doubt, size up.
      </Text>
    </View>
  );
}

const CELL_W = 96;
const CELL_W_KEY = 88;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "85%",
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.text, borderColor: colors.text },
  tabText: { fontSize: 12, fontWeight: "700", color: colors.text },
  tabTextActive: { color: "#fff" },
  chartTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 4 },
  chartSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  row: { flexDirection: "row" },
  rowHeader: {
    backgroundColor: colors.text,
  },
  cell: {
    minWidth: CELL_W,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cellKey: { minWidth: CELL_W_KEY, backgroundColor: colors.primarySoft },
  cellHeaderText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  cellText: { color: colors.text, fontSize: 12 },
  cellKeyText: { fontWeight: "800" },
  notes: { marginTop: 14, gap: 6 },
  noteRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  noteDot: { width: 5, height: 5, borderRadius: 999, backgroundColor: colors.primary, marginTop: 7 },
  noteText: { fontSize: 12, color: colors.textMuted, flex: 1, lineHeight: 17 },
  footnote: { marginTop: 16, fontSize: 11, color: colors.textFaint, fontStyle: "italic" },
  empty: { padding: spacing.xl, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  emptySub: { fontSize: 12, color: colors.textMuted, textAlign: "center" },
});
