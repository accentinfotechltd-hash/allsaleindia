import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  CloudUpload,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  RotateCcw,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ORIGIN_URL, getAuthToken } from "@/src/lib/api";
import { colors, formatNZD, radius, shadow, spacing } from "@/src/lib/theme";
import { useToast } from "@/src/components/UiOverlayProvider";

type PreviewRow = {
  row_number: number;
  mode: "create" | "update";
  ok: boolean;
  errors: string[];
  data: {
    product_id?: string | null;
    name: string;
    description: string;
    category: string;
    price_nzd: number | null;
    stock_count: number | null;
    images: string[];
    sizes: string[];
    colors: string[];
    shipping_days_min: number;
    shipping_days_max: number;
  };
};

type PreviewResponse = {
  total: number;
  valid: number;
  errors: number;
  will_create: number;
  will_update: number;
  rows: PreviewRow[];
};

type ImportResult = {
  created: number;
  updated: number;
  total_attempted: number;
  errors: { row_number: number; errors: string[] }[];
};

export default function BulkUploadScreen() {
  const { show } = useToast();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [zipUploading, setZipUploading] = useState(false);
  const [imagesMap, setImagesMap] = useState<Record<string, string> | null>(null);
  const [imagesZipSummary, setImagesZipSummary] = useState<{
    uploaded: number;
    skipped: number;
    provider: string;
    name: string;
  } | null>(null);

  const reset = useCallback(() => {
    setFileName(null);
    setPreview(null);
    setResult(null);
    setShowAll(false);
    setImagesMap(null);
    setImagesZipSummary(null);
  }, []);

  const downloadFile = useCallback(
    async (path: string, suggestedName: string) => {
      try {
        const token = await getAuthToken();
        const url = `${ORIGIN_URL}/api${path}`;
        if (Platform.OS === "web") {
          // Use fetch + blob + a synthetic <a download>.
          const res = await fetch(url, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const blobUrl = (globalThis as any).URL.createObjectURL(blob);
          const a = (globalThis as any).document.createElement("a");
          a.href = blobUrl;
          a.download = suggestedName;
          a.click();
          (globalThis as any).URL.revokeObjectURL(blobUrl);
          return;
        }
        const dest = `${FileSystem.cacheDirectory}${suggestedName}`;
        const dl = FileSystem.createDownloadResumable(
          url,
          dest,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
        );
        const r = await dl.downloadAsync();
        if (!r?.uri) throw new Error("Download failed");
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(r.uri, {
            mimeType: suggestedName.endsWith(".xlsx")
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : "text/csv",
            dialogTitle: suggestedName,
            UTI: suggestedName.endsWith(".xlsx") ? "com.microsoft.excel.xlsx" : "public.comma-separated-values-text",
          });
        } else {
          show({ title: "Downloaded", message: `Saved to ${r.uri}`, kind: "error" });
        }
      } catch (e: any) {
        show({ title: "Download failed", message: e?.message || "Could not download file.", kind: "error" });
      }
    },
    [],
  );

  const pickAndUploadZip = useCallback(async () => {
    setZipUploading(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed", "*/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      const token = await getAuthToken();
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob =
          (asset as any).file ||
          (await (await fetch(asset.uri)).blob());
        form.append("file", blob, asset.name);
      } else {
        form.append("file", {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "application/zip",
        } as any);
      }
      const r = await fetch(`${ORIGIN_URL}/api/seller/bulk/images-zip`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const text = await r.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!r.ok) {
        const detail =
          (data && data.detail) || r.statusText || "Upload failed";
        throw new Error(
          typeof detail === "string" ? detail : JSON.stringify(detail),
        );
      }
      setImagesMap(data.mapping || {});
      setImagesZipSummary({
        uploaded: data.uploaded || 0,
        skipped: (data.skipped || []).length,
        provider: data.provider || "passthrough",
        name: asset.name,
      });
    } catch (e: any) {
      show({ title: "ZIP upload failed", message: e?.message || "Please check your ZIP.", kind: "error" });
    } finally {
      setZipUploading(false);
    }
  }, []);

  const pickAndPreview = useCallback(async () => {
    setPicking(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/octet-stream",
          "*/*",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setFileName(asset.name);
      setResult(null);
      setShowAll(false);
      setUploading(true);
      const token = await getAuthToken();
      const form = new FormData();
      if (Platform.OS === "web") {
        // On web, asset.file is a Blob.
        const blob =
          (asset as any).file ||
          (await (await fetch(asset.uri)).blob());
        form.append("file", blob, asset.name);
      } else {
        form.append("file", {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "text/csv",
        } as any);
      }
      if (imagesMap && Object.keys(imagesMap).length > 0) {
        form.append("images_map", JSON.stringify(imagesMap));
      }
      const r = await fetch(`${ORIGIN_URL}/api/seller/bulk/preview`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const text = await r.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!r.ok) {
        const detail =
          (data && data.detail) || r.statusText || "Upload failed";
        throw new Error(
          typeof detail === "string" ? detail : JSON.stringify(detail),
        );
      }
      setPreview(data as PreviewResponse);
    } catch (e: any) {
      show({ title: "Could not read file", message: e?.message || "Please check your file.", kind: "error" });
      setFileName(null);
    } finally {
      setUploading(false);
      setPicking(false);
    }
  }, [imagesMap]);

  const commitImport = useCallback(async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.ok).map((r) => r.data);
    if (validRows.length === 0) {
      show({ title: "Nothing to import", message: "All rows have errors. Please fix and try again.", kind: "error" });
      return;
    }
    setImporting(true);
    try {
      const token = await getAuthToken();
      const r = await fetch(`${ORIGIN_URL}/api/seller/bulk/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rows: validRows }),
      });
      const text = await r.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!r.ok) {
        const detail =
          (data && data.detail) || r.statusText || "Import failed";
        throw new Error(
          typeof detail === "string" ? detail : JSON.stringify(detail),
        );
      }
      setResult(data as ImportResult);
      setPreview(null);
    } catch (e: any) {
      show({ title: "Import failed", message: e?.message || "Please try again.", kind: "error" });
    } finally {
      setImporting(false);
    }
  }, [preview]);

  const visibleRows = preview
    ? showAll
      ? preview.rows
      : preview.rows.slice(0, 25)
    : [];
  const hiddenCount = preview ? preview.rows.length - visibleRows.length : 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="bulk-upload-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Bulk upload</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        {/* INTRO */}
        {!preview && !result ? (
          <>
            <View style={styles.heroCard}>
              <CloudUpload size={28} color={colors.primary} />
              <Text style={styles.heroTitle}>Add or edit many listings at once</Text>
              <Text style={styles.heroBody}>
                Perfect for big catalogs. Download the template, fill in your products in
                Excel / Google Sheets, then upload it back. We&apos;ll validate every row before
                anything is saved.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>STEP 1 · DOWNLOAD A TEMPLATE</Text>
            <View style={styles.row2}>
              <Pressable
                testID="bulk-download-csv-template"
                onPress={() =>
                  downloadFile(
                    "/seller/bulk/template.csv",
                    "allsale-listings-template.csv",
                  )
                }
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
              >
                <FileText size={20} color={colors.primary} />
                <Text style={styles.tileTitle}>CSV template</Text>
                <Text style={styles.tileSubtitle}>Universal · easy edits</Text>
              </Pressable>
              <Pressable
                testID="bulk-download-xlsx-template"
                onPress={() =>
                  downloadFile(
                    "/seller/bulk/template.xlsx",
                    "allsale-listings-template.xlsx",
                  )
                }
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
              >
                <FileSpreadsheet size={20} color={colors.primary} />
                <Text style={styles.tileTitle}>Excel template</Text>
                <Text style={styles.tileSubtitle}>Opens directly in Excel</Text>
              </Pressable>
            </View>

            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>
              EDITING EXISTING LISTINGS?
            </Text>
            <View style={styles.row2}>
              <Pressable
                testID="bulk-export-csv"
                onPress={() =>
                  downloadFile(
                    "/seller/bulk/export.csv",
                    "allsale-listings-export.csv",
                  )
                }
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
              >
                <Download size={20} color={colors.primary} />
                <Text style={styles.tileTitle}>Export to CSV</Text>
                <Text style={styles.tileSubtitle}>Edit prices / stock in bulk</Text>
              </Pressable>
              <Pressable
                testID="bulk-export-xlsx"
                onPress={() =>
                  downloadFile(
                    "/seller/bulk/export.xlsx",
                    "allsale-listings-export.xlsx",
                  )
                }
                style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]}
              >
                <Download size={20} color={colors.primary} />
                <Text style={styles.tileTitle}>Export to Excel</Text>
                <Text style={styles.tileSubtitle}>Round-trip via XLSX</Text>
              </Pressable>
            </View>

            <View style={styles.tipBox}>
              <Info size={16} color={colors.accent} />
              <Text style={styles.tipBody}>
                Each row becomes one product. Leave <Text style={styles.mono}>product_id</Text>{" "}
                empty to create new listings, or keep it to update existing ones. Use{" "}
                <Text style={styles.mono}>|</Text> to separate sizes, colors and image URLs.
              </Text>
            </View>

            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>
              STEP 2 · UPLOAD IMAGES ZIP (OPTIONAL)
            </Text>
            <Pressable
              testID="bulk-pick-zip"
              onPress={pickAndUploadZip}
              disabled={zipUploading}
              style={({ pressed }) => [
                styles.zipPickCard,
                imagesZipSummary && styles.zipPickCardDone,
                pressed && { opacity: 0.85 },
                zipUploading && { opacity: 0.7 },
              ]}
            >
              <View style={styles.zipIcon}>
                {zipUploading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Archive
                    size={20}
                    color={imagesZipSummary ? colors.success : colors.primary}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                {imagesZipSummary ? (
                  <>
                    <Text style={styles.zipTitleDone}>
                      ✓ {imagesZipSummary.uploaded} images uploaded
                    </Text>
                    <Text style={styles.zipSubtitle} numberOfLines={1}>
                      {imagesZipSummary.name}
                      {imagesZipSummary.skipped > 0
                        ? ` · ${imagesZipSummary.skipped} skipped`
                        : ""}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.zipTitle}>Upload images (.zip)</Text>
                    <Text style={styles.zipSubtitle}>
                      Reference filenames in your sheet — we&apos;ll swap them for real URLs.
                    </Text>
                  </>
                )}
              </View>
              {imagesZipSummary ? (
                <Pressable
                  testID="bulk-clear-zip"
                  onPress={() => {
                    setImagesMap(null);
                    setImagesZipSummary(null);
                  }}
                  hitSlop={10}
                  style={styles.zipClearBtn}
                >
                  <RotateCcw size={16} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </Pressable>

            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>
              STEP 3 · UPLOAD YOUR FILE
            </Text>
            <Pressable
              testID="bulk-pick-file"
              onPress={pickAndPreview}
              disabled={picking || uploading}
              style={({ pressed }) => [
                styles.uploadCta,
                pressed && { transform: [{ scale: 0.98 }] },
                (picking || uploading) && { opacity: 0.7 },
              ]}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <CloudUpload size={20} color="#fff" />
                  <Text style={styles.uploadCtaText}>Choose CSV / XLSX file</Text>
                </>
              )}
            </Pressable>
            <Text style={styles.hint}>
              Up to 1000 rows · max 8 MB · uses image URLs (we&apos;ll host them automatically).
            </Text>
          </>
        ) : null}

        {/* PREVIEW */}
        {preview && !result ? (
          <>
            <View style={styles.summaryHeader}>
              <Text style={styles.summaryTitle}>
                Preview of {fileName || "your file"}
              </Text>
              <Pressable onPress={reset} hitSlop={8} testID="bulk-reset">
                <RotateCcw size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <View style={styles.statRow}>
              <Stat label="Rows" value={preview.total} />
              <Stat label="Valid" value={preview.valid} tone="success" />
              <Stat label="Errors" value={preview.errors} tone="error" />
            </View>
            <View style={styles.statRow}>
              <Stat label="New" value={preview.will_create} />
              <Stat label="Updates" value={preview.will_update} />
              <Stat
                label="Skipped"
                value={preview.total - preview.valid}
                tone={preview.errors > 0 ? "error" : "muted"}
              />
            </View>

            <Pressable
              testID="bulk-commit"
              onPress={commitImport}
              disabled={importing || preview.valid === 0}
              style={({ pressed }) => [
                styles.commitCta,
                pressed && { transform: [{ scale: 0.98 }] },
                (importing || preview.valid === 0) && { opacity: 0.6 },
              ]}
            >
              {importing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.commitCtaText}>
                  Import {preview.valid} {preview.valid === 1 ? "row" : "rows"}
                  {preview.errors > 0 ? ` · skip ${preview.errors}` : ""}
                </Text>
              )}
            </Pressable>

            <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>
              ROW-BY-ROW REPORT
            </Text>
            <FlatList
              data={visibleRows}
              scrollEnabled={false}
              keyExtractor={(r) => String(r.row_number)}
              renderItem={({ item }) => <RowReport row={item} />}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
            {hiddenCount > 0 ? (
              <Pressable
                onPress={() => setShowAll(true)}
                style={styles.showMore}
                testID="bulk-show-more"
              >
                <Text style={styles.showMoreText}>
                  Show {hiddenCount} more {hiddenCount === 1 ? "row" : "rows"}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {/* RESULT */}
        {result ? (
          <>
            <View style={styles.successCard}>
              <CheckCircle2 size={28} color={colors.success} />
              <Text style={styles.successTitle}>Import complete</Text>
              <Text style={styles.successBody}>
                {result.created} created · {result.updated} updated · {result.errors.length}{" "}
                skipped
              </Text>
            </View>
            {result.errors.length > 0 ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorBoxTitle}>
                  {result.errors.length} {result.errors.length === 1 ? "row was" : "rows were"}{" "}
                  skipped
                </Text>
                {result.errors.slice(0, 10).map((e) => (
                  <Text key={e.row_number} style={styles.errorBoxItem}>
                    Row {e.row_number}: {e.errors.join(", ")}
                  </Text>
                ))}
                {result.errors.length > 10 ? (
                  <Text style={styles.errorBoxItem}>
                    …and {result.errors.length - 10} more.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.lg }}>
              <Pressable
                testID="bulk-go-dashboard"
                onPress={() => router.replace("/seller/dashboard")}
                style={({ pressed }) => [
                  styles.commitCta,
                  { flex: 1 },
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={styles.commitCtaText}>View listings</Text>
              </Pressable>
              <Pressable
                testID="bulk-do-another"
                onPress={reset}
                style={({ pressed }) => [
                  styles.secondaryCta,
                  { flex: 1 },
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={styles.secondaryCtaText}>Upload another</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "error" | "muted";
}) {
  const color =
    tone === "success"
      ? colors.success
      : tone === "error"
      ? colors.error
      : tone === "muted"
      ? colors.textMuted
      : colors.text;
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RowReport({ row }: { row: PreviewRow }) {
  const okColor = row.ok ? colors.success : colors.error;
  return (
    <View
      style={[
        styles.rowCard,
        { borderColor: row.ok ? colors.border : "#FCA5A5", backgroundColor: row.ok ? "#fff" : "#FEF2F2" },
      ]}
      testID={`bulk-row-${row.row_number}`}
    >
      <View style={styles.rowHeader}>
        {row.ok ? (
          <CheckCircle2 size={16} color={okColor} />
        ) : (
          <AlertTriangle size={16} color={okColor} />
        )}
        <Text style={[styles.rowLabel, { color: okColor }]}>
          Row {row.row_number} · {row.mode === "create" ? "NEW" : "UPDATE"}
        </Text>
        <View style={{ flex: 1 }} />
        {typeof row.data.price_nzd === "number" ? (
          <Text style={styles.rowPrice}>{formatNZD(row.data.price_nzd)}</Text>
        ) : null}
      </View>
      <Text style={styles.rowName} numberOfLines={1}>
        {row.data.name || (row.mode === "update" ? "(no change to name)" : "(missing name)")}
      </Text>
      {row.data.category ? (
        <Text style={styles.rowCategory}>{row.data.category.toUpperCase()}</Text>
      ) : null}
      {row.errors.length > 0 ? (
        <View style={styles.rowErrors}>
          {row.errors.map((err, i) => (
            <Text key={i} style={styles.rowErrorText}>
              • {err}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
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
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  heroCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    gap: 8,
  },
  heroTitle: { fontSize: 18, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  heroBody: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  row2: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 6,
    minHeight: 92,
    ...shadow.card,
  },
  tileTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  tileSubtitle: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  tipBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    flexDirection: "row",
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  tipBody: { flex: 1, fontSize: 12, color: "#1E3A8A", lineHeight: 18 },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontWeight: "700" },
  uploadCta: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  uploadCtaText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  hint: { textAlign: "center", marginTop: spacing.sm, fontSize: 12, color: colors.textMuted },
  zipPickCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.surface,
  },
  zipPickCardDone: {
    borderStyle: "solid",
    backgroundColor: colors.successSoft,
    borderColor: "#A7F3D0",
  },
  zipIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  zipTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  zipTitleDone: { fontSize: 14, fontWeight: "800", color: colors.success },
  zipSubtitle: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: 2 },
  zipClearBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  summaryTitle: { fontSize: 16, fontWeight: "800", color: colors.text, flex: 1 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  statCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  statValue: { fontSize: 22, fontWeight: "900", color: colors.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginTop: 2, letterSpacing: 1 },
  commitCta: {
    marginTop: spacing.md,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  commitCtaText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  secondaryCta: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryCtaText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowCard: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  rowName: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 4 },
  rowCategory: { fontSize: 10, color: colors.textMuted, fontWeight: "700", marginTop: 2, letterSpacing: 0.8 },
  rowPrice: { fontSize: 12, fontWeight: "800", color: colors.text },
  rowErrors: { marginTop: 6 },
  rowErrorText: { fontSize: 12, color: colors.error, lineHeight: 17 },
  showMore: {
    alignItems: "center",
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  showMoreText: { color: colors.primary, fontWeight: "700" },
  successCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
    alignItems: "center",
    gap: 6,
  },
  successTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  successBody: { fontSize: 13, color: colors.textMuted, textAlign: "center" },
  errorBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    gap: 4,
  },
  errorBoxTitle: { color: colors.error, fontWeight: "800", marginBottom: 4 },
  errorBoxItem: { color: "#7F1D1D", fontSize: 12, lineHeight: 17 },
});
