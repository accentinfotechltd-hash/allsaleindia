import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  CloudUpload,
  FileSpreadsheet,
  PartyPopper,
  Sparkles,
  TriangleAlert,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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

import { ORIGIN_URL, api, getAuthToken } from "@/src/lib/api";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

// ---------------------------------------------------------------------------
// Types — match backend response shapes
// ---------------------------------------------------------------------------
type ImportSource = "amazon" | "flipkart" | "csv" | "unknown";

type Issue = {
  severity: "error" | "warning" | "info";
  field?: string | null;
  message: string;
};

type MappedProduct = {
  sku?: string | null;
  name: string;
  description: string;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  price_inr?: number | null;
  price_nzd?: number | null;
  mrp_inr?: number | null;
  stock_count: number;
  image?: string | null;
  images: string[];
  bullets: string[];
  hsn_code?: string | null;
  ean_upc?: string | null;
  country_of_origin?: string | null;
};

type PreviewRow = {
  row_index: number;
  product: MappedProduct;
  issues: Issue[];
  ready: boolean;
};

type PreviewResponse = {
  preview_token: string;
  source: ImportSource;
  sheet_name?: string | null;
  filename?: string | null;
  total_rows: number;
  ready_count: number;
  needs_attention_count: number;
  fx_inr_to_nzd: number;
  warnings: string[];
  rows: PreviewRow[];
  expires_at: string;
};

type CommitResponse = {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failed_details: { row_index: number; error: string }[];
};

const SOURCE_OPTIONS: {
  key: "amazon" | "flipkart" | "csv";
  titleKey: string;
  blurbKey: string;
  emoji: string;
}[] = [
  { key: "amazon", titleKey: "seller_import.source_amazon_title", blurbKey: "seller_import.source_amazon_blurb", emoji: "📦" },
  { key: "flipkart", titleKey: "seller_import.source_flipkart_title", blurbKey: "seller_import.source_flipkart_blurb", emoji: "🛍️" },
  { key: "csv", titleKey: "seller_import.source_csv_title", blurbKey: "seller_import.source_csv_blurb", emoji: "📄" },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function SellerImportScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { show } = useToast();

  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [source, setSource] = useState<"amazon" | "flipkart" | "csv">("amazon");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [rowDecisions, setRowDecisions] = useState<Record<number, boolean>>({});
  const [marginInput, setMarginInput] = useState("15");
  const [enrichAi, setEnrichAi] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);

  // ---- File pick + upload ----
  const pickAndUpload = useCallback(async () => {
    try {
      setUploading(true);
      const pick = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.ms-excel",
          "application/vnd.ms-excel.sheet.macroEnabled.12",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/csv",
          "*/*",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (pick.canceled || !pick.assets?.[0]) {
        setUploading(false);
        return;
      }
      const asset = pick.assets[0];
      const token = await getAuthToken();

      const formData = new FormData();
      if (Platform.OS === "web") {
        // On web Expo gives us a File via asset.file
        const file = (asset as any).file as File | undefined;
        if (file) {
          formData.append("file", file, asset.name || "catalog.xlsx");
        } else {
          // Fallback: fetch the URI into a Blob
          const resp = await fetch(asset.uri);
          const blob = await resp.blob();
          formData.append("file", blob, asset.name || "catalog.xlsx");
        }
      } else {
        // Native: pass as { uri, name, type } object
        formData.append("file", {
          uri: asset.uri,
          name: asset.name || "catalog.xlsx",
          type: asset.mimeType || "application/octet-stream",
        } as any);
      }
      formData.append("source_hint", source);

      const resp = await fetch(`${ORIGIN_URL}/api/seller/import/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData as any,
      });
      const text = await resp.text();
      if (!resp.ok) {
        let detail = text;
        try {
          detail = JSON.parse(text).detail || text;
        } catch {
          /* ignore */
        }
        throw new Error(detail || `HTTP ${resp.status}`);
      }
      const data = JSON.parse(text) as PreviewResponse;
      setPreview(data);
      // default: publish every "ready" row
      const decisions: Record<number, boolean> = {};
      for (const r of data.rows) decisions[r.row_index] = r.ready;
      setRowDecisions(decisions);
      setStep(2);
    } catch (e: any) {
      show({
        title: t("seller_import.couldnt_read"),
        body: e?.message || t("seller_import.couldnt_read_body"),
        kind: "error",
      });
    } finally {
      setUploading(false);
    }
  }, [source, show, t]);

  const toggleRow = useCallback((row_index: number) => {
    setRowDecisions((prev) => ({ ...prev, [row_index]: !prev[row_index] }));
  }, []);

  const selectedCount = useMemo(
    () => Object.values(rowDecisions).filter(Boolean).length,
    [rowDecisions]
  );

  // ---- Commit ----
  const commit = useCallback(async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const margin = Math.max(0, Math.min(parseFloat(marginInput) || 0, 200));
      const resp = await api<CommitResponse>("/seller/import/commit", {
        method: "POST",
        body: {
          preview_token: preview.preview_token,
          rows: preview.rows.map((r) => ({
            row_index: r.row_index,
            publish: !!rowDecisions[r.row_index],
          })),
          margin_pct: margin,
          enrich_with_ai: enrichAi,
        },
      });
      setResult(resp);
      setStep(4);
    } catch (e: any) {
      show({
        title: t("seller_import.couldnt_publish"),
        body: e?.message || t("seller_import.try_again"),
        kind: "error",
      });
    } finally {
      setCommitting(false);
    }
  }, [preview, rowDecisions, marginInput, enrichAi, show, t]);

  // ---- Renderers per step ----
  const renderStep0 = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{t("seller_import.step0_h1")}</Text>
      <Text style={styles.sub}>
        {t("seller_import.step0_sub")}
      </Text>
      {SOURCE_OPTIONS.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => setSource(o.key)}
          style={[
            styles.sourceCard,
            source === o.key && styles.sourceCardActive,
          ]}
          testID={`source-${o.key}`}
        >
          <Text style={styles.sourceEmoji}>{o.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.sourceTitle}>{t(o.titleKey)}</Text>
            <Text style={styles.sourceBlurb}>{t(o.blurbKey)}</Text>
          </View>
          {source === o.key ? (
            <CheckCircle2 size={20} color={colors.primary} />
          ) : null}
        </Pressable>
      ))}
      <Pressable
        style={styles.primaryBtn}
        onPress={() => setStep(1)}
        testID="import-continue-source"
      >
        <Text style={styles.primaryBtnText}>{t("seller_import.continue_btn")}</Text>
      </Pressable>
    </ScrollView>
  );

  const renderStep1 = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{t("seller_import.step1_h1")}</Text>
      <Text style={styles.sub}>
        {t("seller_import.step1_sub")}
      </Text>
      <Pressable
        style={styles.dropzone}
        onPress={pickAndUpload}
        disabled={uploading}
        testID="import-pick-file"
      >
        {uploading ? (
          <ActivityIndicator color={colors.primary} size="large" />
        ) : (
          <>
            <CloudUpload size={36} color={colors.primary} />
            <Text style={styles.dropzoneTitle}>{t("seller_import.pick_file")}</Text>
            <Text style={styles.dropzoneSub}>
              {t("seller_import.source_prefix", { title: t(SOURCE_OPTIONS.find((s) => s.key === source)?.titleKey || "") })}
            </Text>
          </>
        )}
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => setStep(0)}>
        <Text style={styles.linkBtnText}>{t("seller_import.pick_different_source")}</Text>
      </Pressable>
    </ScrollView>
  );

  const renderStep2 = () => {
    if (!preview) return null;
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statsRow}>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>{preview.total_rows}</Text>
            <Text style={styles.statLabel}>{t("seller_import.stat_found")}</Text>
          </View>
          <View style={[styles.statTile, styles.statTileGood]}>
            <Text style={[styles.statNum, { color: "#16a34a" }]}>
              {preview.ready_count}
            </Text>
            <Text style={styles.statLabel}>{t("seller_import.stat_ready")}</Text>
          </View>
          {preview.needs_attention_count > 0 ? (
            <View style={[styles.statTile, styles.statTileWarn]}>
              <Text style={[styles.statNum, { color: "#ea580c" }]}>
                {preview.needs_attention_count}
              </Text>
              <Text style={styles.statLabel}>{t("seller_import.stat_need_fix")}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.fxLine}>
          {t("seller_import.fx_line", { rate: preview.fx_inr_to_nzd.toFixed(2), source: preview.source })}
          {preview.sheet_name ? t("seller_import.fx_line_sheet_suffix", { sheet: preview.sheet_name }) : ""}
        </Text>

        {preview.warnings.map((w) => (
          <View key={w} style={styles.warningBanner}>
            <TriangleAlert size={14} color="#ea580c" />
            <Text style={styles.warningText}>{w}</Text>
          </View>
        ))}

        {preview.rows.map((r) => {
          const selected = !!rowDecisions[r.row_index];
          const p = r.product;
          const hasError = r.issues.some((i) => i.severity === "error");
          return (
            <Pressable
              key={r.row_index}
              onPress={() => toggleRow(r.row_index)}
              style={[
                styles.rowCard,
                selected && styles.rowCardSelected,
                hasError && styles.rowCardError,
              ]}
              testID={`import-row-${r.row_index}`}
            >
              {p.image ? (
                <Image source={{ uri: p.image }} style={styles.rowThumb} />
              ) : (
                <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
                  <FileSpreadsheet size={20} color={colors.textMuted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {p.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {p.category || t("seller_import.uncategorised")}
                  {p.subcategory ? ` · ${p.subcategory}` : ""}
                  {p.brand ? ` · ${p.brand}` : ""}
                </Text>
                <Text style={styles.rowPrice}>
                  {p.price_nzd != null ? formatNZD(p.price_nzd) : t("seller_import.no_price")}
                  {p.price_inr ? `  (₹${p.price_inr.toFixed(0)})` : ""}
                  {`  · ${t("seller_import.stock_prefix", { count: p.stock_count })}`}
                </Text>
                {r.issues.length > 0 ? (
                  <View style={styles.issueList}>
                    {r.issues.slice(0, 2).map((i, k) => (
                      <Text
                        key={k}
                        style={[
                          styles.issueText,
                          i.severity === "error" && { color: colors.error },
                          i.severity === "warning" && { color: "#ea580c" },
                        ]}
                      >
                        {i.severity === "error" ? "✕" : "⚠"} {i.message}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={styles.rowCheckbox}>
                <View
                  style={[
                    styles.checkboxBox,
                    selected && {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  {selected ? <CheckCircle2 size={16} color="#fff" /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>
    );
  };

  const renderStep3 = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.h1}>{t("seller_import.step3_h1")}</Text>
      <Text style={styles.sub}>
        {t(selectedCount === 1 ? "seller_import.selected_one" : "seller_import.selected_other", { n: selectedCount })}
      </Text>

      <View style={styles.settingCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingTitle}>{t("seller_import.margin_label")}</Text>
          <Text style={styles.settingHelp}>
            {t("seller_import.margin_help")}
          </Text>
        </View>
        <TextInput
          value={marginInput}
          onChangeText={setMarginInput}
          keyboardType="numeric"
          style={styles.marginInput}
          maxLength={5}
          testID="import-margin-input"
        />
        <Text style={styles.marginSuffix}>%</Text>
      </View>

      <View style={styles.settingCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingTitle}>
            <Sparkles size={14} color={colors.primary} /> {t("seller_import.ai_label")}
          </Text>
          <Text style={styles.settingHelp}>
            {t("seller_import.ai_help")}
          </Text>
        </View>
        <Switch
          value={enrichAi}
          onValueChange={setEnrichAi}
          trackColor={{ true: colors.primary, false: colors.border }}
          testID="import-ai-switch"
        />
      </View>

      <Pressable
        style={[styles.primaryBtn, selectedCount === 0 && { opacity: 0.5 }]}
        disabled={selectedCount === 0 || committing}
        onPress={commit}
        testID="import-commit"
      >
        {committing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {t(selectedCount === 1 ? "seller_import.publish_one" : "seller_import.publish_other", { n: selectedCount })}
          </Text>
        )}
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => setStep(2)}>
        <Text style={styles.linkBtnText}>{t("seller_import.back_to_selection")}</Text>
      </Pressable>
    </ScrollView>
  );

  const renderStep4 = () => (
    <ScrollView contentContainerStyle={[styles.content, { alignItems: "center" }]}>
      <PartyPopper size={48} color={colors.primary} style={{ marginTop: 24 }} />
      <Text style={[styles.h1, { textAlign: "center" }]}>
        {t("seller_import.step4_listings_live", { n: result?.created || 0 })}
      </Text>
      <Text style={styles.sub}>
        {t("seller_import.step4_summary_a", { n: result?.created || 0 })}
        {(result?.updated || 0) > 0
          ? t("seller_import.step4_summary_updated", { u: result?.updated })
          : ""}
        {(result?.skipped || 0) > 0 ? t("seller_import.step4_summary_skipped", { s: result?.skipped }) : ""}
        {t("seller_import.step4_summary_dot")}
      </Text>
      {(result?.failed || 0) > 0 ? (
        <View style={styles.warningBanner}>
          <TriangleAlert size={14} color="#ea580c" />
          <Text style={styles.warningText}>
            {t((result?.failed || 0) === 1 ? "seller_import.step4_failed_one" : "seller_import.step4_failed_other", { n: result?.failed })}
          </Text>
        </View>
      ) : null}
      <Pressable
        style={[styles.primaryBtn, { marginTop: 24 }]}
        onPress={() => router.replace("/seller/dashboard")}
      >
        <Text style={styles.primaryBtnText}>{t("seller_import.go_dashboard")}</Text>
      </Pressable>
      <Pressable
        style={styles.linkBtn}
        onPress={() => {
          setStep(0);
          setPreview(null);
          setResult(null);
        }}
      >
        <Text style={styles.linkBtnText}>{t("seller_import.import_another")}</Text>
      </Pressable>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 0 ? router.back() : setStep((s) => (s - 1) as any))}
          style={styles.backBtn}
          testID="import-back"
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("seller_import.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / 4) * 100}%` }]} />
      </View>

      {step === 0 ? renderStep0() : null}
      {step === 1 ? renderStep1() : null}
      {step === 2 ? (
        <>
          {renderStep2()}
          <View style={styles.bottomBar}>
            <Text style={styles.bottomBarText}>
              {t("seller_import.bottom_selected", { n: selectedCount })}
            </Text>
            <Pressable
              style={[styles.primaryBtn, selectedCount === 0 && { opacity: 0.5 }]}
              disabled={selectedCount === 0}
              onPress={() => setStep(3)}
              testID="import-to-settings"
            >
              <Text style={styles.primaryBtnText}>{t("seller_import.next_btn")}</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      {step === 3 ? renderStep3() : null}
      {step === 4 ? renderStep4() : null}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
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
  backBtn: {
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
  progressTrack: {
    height: 3,
    backgroundColor: colors.border,
  },
  progressFill: { height: 3, backgroundColor: colors.primary },

  content: { padding: spacing.lg, gap: 14 },
  h1: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 8 },
  sub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },

  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  sourceCardActive: { borderColor: colors.primary, backgroundColor: "#FFF7ED" },
  sourceEmoji: { fontSize: 28 },
  sourceTitle: { fontWeight: "800", color: colors.text, fontSize: 15 },
  sourceBlurb: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  dropzone: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.primary,
    backgroundColor: "#FFF7ED",
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: 12,
    minHeight: 200,
    justifyContent: "center",
  },
  dropzoneTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  dropzoneSub: { color: colors.textMuted, fontSize: 13 },

  statsRow: { flexDirection: "row", gap: 10 },
  statTile: {
    flex: 1,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  statTileGood: { backgroundColor: "#DCFCE7", borderColor: "#86EFAC" },
  statTileWarn: { backgroundColor: "#FFEDD5", borderColor: "#FDBA74" },
  statNum: { fontSize: 22, fontWeight: "900", color: colors.text },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

  fxLine: { color: colors.textFaint, fontSize: 11, marginTop: -4 },

  warningBanner: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    backgroundColor: "#FFF7ED",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FDBA74",
    alignItems: "flex-start",
  },
  warningText: { color: "#9a3412", fontSize: 12, flex: 1, lineHeight: 16 },

  rowCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowCardSelected: { borderColor: colors.primary, backgroundColor: "#FFF7ED" },
  rowCardError: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  rowThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  rowThumbEmpty: { alignItems: "center", justifyContent: "center" },
  rowName: { fontWeight: "700", color: colors.text, fontSize: 13 },
  rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  rowPrice: { color: colors.text, fontWeight: "700", fontSize: 12, marginTop: 4 },
  issueList: { marginTop: 4, gap: 2 },
  issueText: { fontSize: 11, lineHeight: 14 },
  rowCheckbox: { justifyContent: "center" },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  settingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  settingHelp: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  marginInput: {
    width: 64,
    textAlign: "right",
    fontWeight: "800",
    fontSize: 18,
    color: colors.text,
    padding: 4,
  },
  marginSuffix: { fontWeight: "800", color: colors.text },

  primaryBtn: {
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  linkBtn: { padding: 12, alignItems: "center" },
  linkBtnText: { color: colors.primary, fontWeight: "700" },

  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomBarText: { flex: 1, fontWeight: "700", color: colors.text },
});
