/**
 * Admin → Seller Tax-Registration Capture
 *
 * Lets a Manager record each seller's tax-authority registrations (NZ GST
 * IRD, AU ABN, UK VAT, India GSTIN, etc.). These are the legally-binding
 * identifiers the platform needs on file for offshore-retailer compliance.
 *
 * Workflow: search by seller user_id → load existing registrations → add /
 * edit / remove rows → save. Backend dedupes by (country, kind).
 */
import { useRouter } from "expo-router";
import {
  ChevronLeft,
  Plus,
  Save,
  Trash2,
  ShieldCheck,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import {
  AdminForbidden,
  AdminUnauthorized,
  adminApi,
} from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type TaxRegistration = {
  country: string;
  kind: string;
  number: string;
  verified_at?: string | null;
  note?: string | null;
};

// Common (country, kind) pairs surfaced as quick-pick chips so admins
// don't have to memorise the codes.
const COUNTRY_OPTIONS = [
  { code: "NZ", label: "🇳🇿 NZ" },
  { code: "AU", label: "🇦🇺 AU" },
  { code: "GB", label: "🇬🇧 GB" },
  { code: "US", label: "🇺🇸 US" },
  { code: "CA", label: "🇨🇦 CA" },
  { code: "IN", label: "🇮🇳 IN" },
  { code: "FJ", label: "🇫🇯 FJ" },
];
const KIND_OPTIONS = [
  { code: "gst_ird", label: "NZ GST (IRD)" },
  { code: "abn", label: "AU ABN" },
  { code: "vat", label: "UK VAT" },
  { code: "vat_eu", label: "EU VAT" },
  { code: "ein", label: "US EIN" },
  { code: "bn", label: "CA BN" },
  { code: "gstin", label: "IN GSTIN" },
  { code: "tin", label: "TIN (other)" },
];

export default function AdminTaxRegistrations() {
  const router = useRouter();
  const { show } = useToast();
  const [userId, setUserId] = useState("");
  const [rows, setRows] = useState<TaxRegistration[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAuthError = useCallback(
    (e: unknown) => {
      if (e instanceof AdminUnauthorized) {
        show({ title: "Login required", kind: "error" });
        router.replace("/admin");
        return true;
      }
      if (e instanceof AdminForbidden) {
        show({ title: "Manager access required", kind: "error" });
        return true;
      }
      return false;
    },
    [router, show],
  );

  const onLoad = useCallback(async () => {
    const uid = userId.trim();
    if (!uid) {
      show({ title: "Enter a seller user ID", kind: "error" });
      return;
    }
    setLoading(true);
    try {
      const data = await adminApi<TaxRegistration[]>(
        `/admin/sellers/${encodeURIComponent(uid)}/tax-registrations`,
      );
      setRows(Array.isArray(data) ? data : []);
      setLoaded(true);
      show({
        title: `Loaded ${data.length} registration${data.length === 1 ? "" : "s"}`,
        kind: "success",
      });
    } catch (e: any) {
      if (!handleAuthError(e)) {
        show({ title: e?.message || "Failed to load", kind: "error" });
      }
    } finally {
      setLoading(false);
    }
  }, [userId, show, handleAuthError]);

  const onSave = useCallback(async () => {
    const uid = userId.trim();
    if (!uid) return;
    // Client-side validation
    for (const [i, r] of rows.entries()) {
      if (!r.country || r.country.length !== 2) {
        show({ title: `Row ${i + 1}: country must be ISO-2`, kind: "error" });
        return;
      }
      if (!r.kind) {
        show({ title: `Row ${i + 1}: kind is required`, kind: "error" });
        return;
      }
      if (!r.number || r.number.trim().length < 4) {
        show({ title: `Row ${i + 1}: number must be ≥ 4 chars`, kind: "error" });
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await adminApi<TaxRegistration[]>(
        `/admin/sellers/${encodeURIComponent(uid)}/tax-registrations`,
        {
          method: "PUT",
          body: {
            registrations: rows.map((r) => ({
              country: r.country.toUpperCase(),
              kind: r.kind,
              number: r.number.trim(),
              verified_at: r.verified_at || null,
              note: r.note || null,
            })),
          },
        },
      );
      setRows(saved);
      show({
        title: "Tax registrations saved",
        body: `${saved.length} record${saved.length === 1 ? "" : "s"} on file`,
        kind: "success",
      });
    } catch (e: any) {
      if (!handleAuthError(e)) {
        show({ title: e?.message || "Save failed", kind: "error" });
      }
    } finally {
      setSaving(false);
    }
  }, [userId, rows, show, handleAuthError]);

  const updateRow = (idx: number, patch: Partial<TaxRegistration>) => {
    setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = () =>
    setRows((curr) => [
      ...curr,
      { country: "NZ", kind: "gst_ird", number: "", note: "" },
    ]);
  const deleteRow = (idx: number) =>
    setRows((curr) => curr.filter((_, i) => i !== idx));

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="back-btn"
          onPress={() => router.back()}
          style={styles.headerBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Tax registrations</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.intro}>
          <ShieldCheck size={20} color={colors.primary} />
          <Text style={styles.introBody}>
            Record each seller&apos;s tax-authority registrations (NZ GST, AU ABN,
            UK VAT, India GSTIN, etc.). These get printed under each invoice
            for the matching jurisdiction.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>SELLER USER ID</Text>
        <View style={styles.lookupRow}>
          <TextInput
            testID="lookup-user-id"
            value={userId}
            onChangeText={setUserId}
            placeholder="e.g. u_abc123…"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={onLoad}
          />
          <Pressable
            testID="lookup-btn"
            onPress={onLoad}
            disabled={loading}
            style={({ pressed }) => [
              styles.lookupBtn,
              (loading || pressed) && { opacity: 0.7 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.lookupBtnText}>Load</Text>
            )}
          </Pressable>
        </View>

        {loaded && (
          <>
            <Text style={styles.sectionLabel}>
              REGISTRATIONS ({rows.length})
            </Text>

            {rows.map((row, idx) => (
              <View key={idx} style={styles.card} testID={`tax-row-${idx}`}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardIndex}>#{idx + 1}</Text>
                  <Pressable
                    testID={`delete-row-${idx}`}
                    onPress={() => deleteRow(idx)}
                    hitSlop={8}
                  >
                    <Trash2 size={18} color={colors.error} />
                  </Pressable>
                </View>

                <Text style={styles.label}>Country</Text>
                <View style={styles.chipRow}>
                  {COUNTRY_OPTIONS.map((c) => (
                    <Pressable
                      key={c.code}
                      testID={`row-${idx}-country-${c.code}`}
                      onPress={() => updateRow(idx, { country: c.code })}
                      style={[
                        styles.chip,
                        row.country === c.code && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          row.country === c.code && styles.chipTextActive,
                        ]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Kind</Text>
                <View style={styles.chipRow}>
                  {KIND_OPTIONS.map((k) => (
                    <Pressable
                      key={k.code}
                      testID={`row-${idx}-kind-${k.code}`}
                      onPress={() => updateRow(idx, { kind: k.code })}
                      style={[
                        styles.chip,
                        row.kind === k.code && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          row.kind === k.code && styles.chipTextActive,
                        ]}
                      >
                        {k.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Registration number</Text>
                <TextInput
                  testID={`row-${idx}-number`}
                  value={row.number}
                  onChangeText={(v) => updateRow(idx, { number: v })}
                  placeholder="e.g. 123-456-789"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />

                <Text style={styles.label}>Note (optional)</Text>
                <TextInput
                  testID={`row-${idx}-note`}
                  value={row.note || ""}
                  onChangeText={(v) => updateRow(idx, { note: v })}
                  placeholder="e.g. verified via IRD portal, 21 Jun 2026"
                  placeholderTextColor={colors.textFaint}
                  style={styles.input}
                />
              </View>
            ))}

            <Pressable
              testID="add-row-btn"
              onPress={addRow}
              style={({ pressed }) => [
                styles.addBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Plus size={18} color={colors.primary} />
              <Text style={styles.addBtnText}>Add registration</Text>
            </Pressable>

            <Pressable
              testID="save-btn"
              onPress={onSave}
              disabled={saving}
              style={({ pressed }) => [
                styles.saveBtn,
                (saving || pressed) && { opacity: 0.7 },
              ]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Save size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>Save changes</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  headerBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "800",
    fontSize: 17,
    color: colors.text,
  },
  scroll: { padding: spacing.lg, paddingBottom: 64 },
  intro: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: "#F4F8FF",
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  introBody: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  lookupRow: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  lookupBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    alignItems: "center",
    height: 46,
  },
  lookupBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  cardIndex: { fontSize: 12, color: colors.textMuted, fontWeight: "700" },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    marginTop: 6,
    marginBottom: 4,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { fontSize: 12, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: "#fff",
    marginTop: spacing.sm,
  },
  addBtnText: { fontSize: 14, fontWeight: "700", color: colors.primary },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.lg,
  },
  saveBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
