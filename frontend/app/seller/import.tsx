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
  title: string;
  blurb: string;
  emoji: string;
}[] = [
  {
    key: "amazon",
    title: "Amazon Seller Central",
    blurb: "Upload the .xlsx/.xlsm catalog template you use for Amazon India.",
    emoji: "📦",
  },
  {
    key: "flipkart",
    title: "Flipkart Seller Hub",
    blurb: "Upload the .xls catalog file you downloaded from Flipkart.",
    emoji: "🛍️",
  },
  {
    key: "csv",
    title: "Your own CSV",
    blurb: "A simple CSV with sku, name, price, image. We handle the rest.",
    emoji: "📄",
  },
];

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export default function SellerImportScreen() {
  const router = useRouter();
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
        title: "Couldn't read your catalog",
        body: e?.message || "Try again with a different file.",
        kind: "error",
      });
    } finally {
      setUploading(false);
    }
  }, [source, show]);

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
        title: "Couldn't publish listings",
        body: e?.message || "Try again.",
        kind: "error",
      });
    } finally {
      setCommitting(false);
    }
  }, [preview, rowDecisions, marginInput, enrichAi, show]);

  // ---- Renderers per step ----
  const renderStep0 = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Where&apos;s your catalog coming from?</Text>
      <Text style={styles.sub}>
        Bring your existing listings from Amazon or Flipkart and we&apos;ll have them
        live in minutes — no re-typing required.
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
            <Text style={styles.sourceTitle}>{o.title}</Text>
            <Text style={styles.sourceBlurb}>{o.blurb}</Text>
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
        <Text style={styles.primaryBtnText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );

  const renderStep1 = () => (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Upload your catalog file</Text>
      <Text style={styles.sub}>
        Drag the file your marketplace gave you. We accept .xlsx, .xlsm, .xls
        and .csv up to 25 MB.
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
            <Text style={styles.dropzoneTitle}>Tap to pick a file</Text>
            <Text style={styles.dropzoneSub}>
              Source: {SOURCE_OPTIONS.find((s) => s.key === source)?.title}
            </Text>
          </>
        )}
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => setStep(0)}>
        <Text style={styles.linkBtnText}>← Pick a different source</Text>
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
            <Text style={styles.statLabel}>found</Text>
          </View>
          <View style={[styles.statTile, styles.statTileGood]}>
            <Text style={[styles.statNum, { color: "#16a34a" }]}>
              {preview.ready_count}
            </Text>
            <Text style={styles.statLabel}>ready</Text>
          </View>
          {preview.needs_attention_count > 0 ? (
            <View style={[styles.statTile, styles.statTileWarn]}>
              <Text style={[styles.statNum, { color: "#ea580c" }]}>
                {preview.needs_attention_count}
              </Text>
              <Text style={styles.statLabel}>need fix</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.fxLine}>
          FX 1 NZD = ₹{preview.fx_inr_to_nzd.toFixed(2)} · source:{" "}
          {preview.source}
          {preview.sheet_name ? ` · sheet: ${preview.sheet_name}` : ""}
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
                  {p.category || "— uncategorised —"}
                  {p.subcategory ? ` · ${p.subcategory}` : ""}
                  {p.brand ? ` · ${p.brand}` : ""}
                </Text>
                <Text style={styles.rowPrice}>
                  {p.price_nzd != null ? formatNZD(p.price_nzd) : "no price"}
                  {p.price_inr ? `  (₹${p.price_inr.toFixed(0)})` : ""}
                  {`  · stock ${p.stock_count}`}
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
      <Text style={styles.h1}>Last touches</Text>
      <Text style={styles.sub}>
        Selected <Text style={{ fontWeight: "800" }}>{selectedCount}</Text>{" "}
        product{selectedCount === 1 ? "" : "s"} to publish.
      </Text>

      <View style={styles.settingCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.settingTitle}>Markup on NZD price (%)</Text>
          <Text style={styles.settingHelp}>
            Apply across all imported items to cover shipping &amp; profit.
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
            <Sparkles size={14} color={colors.primary} /> AI clean-up (Claude
            Sonnet 4.5)
          </Text>
          <Text style={styles.settingHelp}>
            Translates Hindi/Hinglish descriptions to English and rewrites long
            blurbs into clean 5-bullet feature lists.
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
            Publish {selectedCount} listing{selectedCount === 1 ? "" : "s"}
          </Text>
        )}
      </Pressable>
      <Pressable style={styles.linkBtn} onPress={() => setStep(2)}>
        <Text style={styles.linkBtnText}>← Back to selection</Text>
      </Pressable>
    </ScrollView>
  );

  const renderStep4 = () => (
    <ScrollView contentContainerStyle={[styles.content, { alignItems: "center" }]}>
      <PartyPopper size={48} color={colors.primary} style={{ marginTop: 24 }} />
      <Text style={[styles.h1, { textAlign: "center" }]}>
        {result?.created || 0} listings live!
      </Text>
      <Text style={styles.sub}>
        We created {result?.created || 0} new listings
        {(result?.updated || 0) > 0
          ? `, updated ${result?.updated} existing`
          : ""}
        {(result?.skipped || 0) > 0 ? `, skipped ${result?.skipped}` : ""}.
      </Text>
      {(result?.failed || 0) > 0 ? (
        <View style={styles.warningBanner}>
          <TriangleAlert size={14} color="#ea580c" />
          <Text style={styles.warningText}>
            {result?.failed} row{(result?.failed || 0) === 1 ? "" : "s"} failed.
            Check the seller dashboard for details.
          </Text>
        </View>
      ) : null}
      <Pressable
        style={[styles.primaryBtn, { marginTop: 24 }]}
        onPress={() => router.replace("/seller/dashboard")}
      >
        <Text style={styles.primaryBtnText}>Go to my dashboard</Text>
      </Pressable>
      <Pressable
        style={styles.linkBtn}
        onPress={() => {
          setStep(0);
          setPreview(null);
          setResult(null);
        }}
      >
        <Text style={styles.linkBtnText}>Import another catalog</Text>
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
        <Text style={styles.headerTitle}>Import catalog</Text>
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
              {selectedCount} selected
            </Text>
            <Pressable
              style={[styles.primaryBtn, selectedCount === 0 && { opacity: 0.5 }]}
              disabled={selectedCount === 0}
              onPress={() => setStep(3)}
              testID="import-to-settings"
            >
              <Text style={styles.primaryBtnText}>Next</Text>
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
