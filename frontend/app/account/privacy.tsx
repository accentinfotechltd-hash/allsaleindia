import { useRouter } from "expo-router";
import {
  AlertTriangle,
  ChevronLeft,
  Download,
  ShieldCheck,
  Trash2,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

/**
 * Account Privacy & Data — GDPR-style hub.
 *
 * Two flows live here:
 *   1. Export — calls GET /api/account/export, saves the JSON dump locally
 *      (and surfaces a Share sheet so the user can keep it).
 *   2. Delete — irreversible.  Requires the user to type "DELETE" so we
 *      don't act on an accidental press, then calls DELETE /api/auth/me.
 *      After a successful delete the user is signed out and bounced back
 *      to the welcome screen.
 */
export default function PrivacyCenter() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const toast = useToast();

  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ---------------------- Export ----------------------
  const exportData = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await api<Record<string, unknown>>("/account/export", {
        method: "GET",
      });
      const json = JSON.stringify(data, null, 2);
      const filename = `allsale-data-${
        user?.id || "me"
      }-${new Date().toISOString().slice(0, 10)}.json`;

      if (Platform.OS === "web") {
        // Browser download via Blob URL.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w: any = globalThis;
        const blob = new w.Blob([json], { type: "application/json" });
        const url = w.URL.createObjectURL(blob);
        const a = w.document.createElement("a");
        a.href = url;
        a.download = filename;
        w.document.body.appendChild(a);
        a.click();
        a.remove();
        w.setTimeout(() => w.URL.revokeObjectURL(url), 0);
        toast.show({
          type: "success",
          title: "Download started",
          message: `Saved as ${filename}`,
        });
      } else {
        // Native: write to a cache file, then surface a Share sheet so the
        // user can move it to Files / iCloud / Drive / wherever they want.
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const uri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(uri, json, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/json",
            dialogTitle: "Save your Allsale data",
            UTI: "public.json",
          });
        } else {
          // Last-ditch fallback — paste it as plain text.
          await Share.share({ message: json.slice(0, 2000) });
        }
        toast.show({
          type: "success",
          title: "Export ready",
          message: "Saved to your device — choose where to keep it.",
        });
      }
    } catch (e: any) {
      toast.show({
        type: "error",
        title: "Export failed",
        message: e?.message || "Try again in a moment.",
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, toast, user?.id]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          testID="privacy-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
        >
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Privacy & data</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* -------- What we hold -------- */}
        <View style={styles.section}>
          <View style={styles.iconChip}>
            <ShieldCheck size={18} color={colors.primary} />
          </View>
          <Text style={styles.sectionTitle}>Your data, your control</Text>
          <Text style={styles.sectionSub}>
            We keep only what we need to ship your orders and answer your
            questions. You can download everything we have or close your
            account at any time.
          </Text>
        </View>

        {/* -------- Export -------- */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconChip, styles.iconChipBlue]}>
              <Download size={18} color="#1d4ed8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Download your data</Text>
              <Text style={styles.cardSub}>
                A JSON file with your profile, orders, addresses, reviews,
                returns, wishlist, notifications and loyalty points history.
              </Text>
            </View>
          </View>
          <Pressable
            testID="privacy-export-btn"
            onPress={exportData}
            disabled={exporting}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.85 },
              exporting && { opacity: 0.7 },
            ]}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Download data (.json)</Text>
            )}
          </Pressable>
        </View>

        {/* -------- Delete -------- */}
        <View style={[styles.card, styles.dangerCard]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconChip, styles.iconChipRed]}>
              <Trash2 size={18} color="#b91c1c" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, styles.dangerTitle]}>
                Delete account
              </Text>
              <Text style={styles.cardSub}>
                Permanently scrubs your name, email, phone, addresses, cart,
                wishlist and recently-viewed history. Past orders & reviews
                are kept (anonymised) for tax & seller records.
              </Text>
              <Text style={styles.warningInline}>
                This can&apos;t be undone.
              </Text>
            </View>
          </View>
          <Pressable
            testID="privacy-delete-btn"
            onPress={() => setConfirmOpen(true)}
            style={({ pressed }) => [
              styles.dangerBtn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.dangerBtnText}>Delete my account</Text>
          </Pressable>
        </View>

        <Text style={styles.footnote}>
          Signed in as {user?.email}
        </Text>
      </ScrollView>

      <DeleteConfirmSheet
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirmed={async () => {
          setConfirmOpen(false);
          await logout();
          router.replace("/(auth)/welcome");
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Confirmation modal — typed "DELETE" + reason picker
// ---------------------------------------------------------------------------
function DeleteConfirmSheet({
  visible,
  onClose,
  onConfirmed,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const canDelete = typed.trim().toUpperCase() === "DELETE" && !busy;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      await api("/auth/me", {
        method: "DELETE",
        body: { confirm: "DELETE", reason: reason.trim() || undefined },
      });
      toast.show({
        type: "success",
        title: "Account deleted",
        message: "Your personal data has been scrubbed.",
      });
      onConfirmed();
    } catch (e: any) {
      toast.show({
        type: "error",
        title: "Could not delete",
        message: e?.message || "Try again in a moment.",
      });
    } finally {
      setBusy(false);
      setTyped("");
      setReason("");
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={[styles.iconChip, styles.iconChipRed, { alignSelf: "center" }]}>
            <AlertTriangle size={22} color="#b91c1c" />
          </View>
          <Text style={styles.modalTitle}>Confirm account deletion</Text>
          <Text style={styles.modalBody}>
            Type the word <Text style={styles.codeMono}>DELETE</Text> below to
            confirm. This signs you out of every device and cannot be undone.
          </Text>

          <Text style={styles.modalLabel}>Type DELETE</Text>
          <TextInput
            testID="privacy-delete-confirm-input"
            value={typed}
            onChangeText={setTyped}
            placeholder="DELETE"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.modalInput}
          />

          <Text style={styles.modalLabel}>Optional — why are you leaving?</Text>
          <TextInput
            testID="privacy-delete-reason-input"
            value={reason}
            onChangeText={setReason}
            placeholder="We'd love to know what we could improve"
            placeholderTextColor={colors.textFaint}
            multiline
            numberOfLines={3}
            style={[styles.modalInput, { height: 80, textAlignVertical: "top", paddingTop: 12 }]}
          />

          <View style={styles.modalActions}>
            <Pressable
              testID="privacy-delete-cancel-btn"
              onPress={onClose}
              disabled={busy}
              style={({ pressed }) => [
                styles.modalSecondaryBtn,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.modalSecondaryText}>Keep my account</Text>
            </Pressable>
            <Pressable
              testID="privacy-delete-confirm-btn"
              onPress={submit}
              disabled={!canDelete}
              style={({ pressed }) => [
                styles.modalDangerBtn,
                pressed && { opacity: 0.85 },
                !canDelete && { opacity: 0.4 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalDangerText}>Delete account</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  section: { marginBottom: spacing.lg },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  iconChipBlue: { backgroundColor: "#dbeafe" },
  iconChipRed: { backgroundColor: "#fee2e2" },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sectionSub: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 21 },

  card: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardHeader: { flexDirection: "row", gap: 12, marginBottom: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: "800", color: colors.text },
  cardSub: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 19 },
  dangerCard: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  dangerTitle: { color: "#991b1b" },
  warningInline: { fontSize: 12, fontWeight: "700", color: "#b91c1c", marginTop: 8 },

  primaryBtn: {
    backgroundColor: "#1d4ed8",
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  dangerBtn: {
    backgroundColor: "#dc2626",
    height: 48,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  footnote: { textAlign: "center", color: colors.textFaint, fontSize: 12, marginTop: spacing.md },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalHandle: {
    width: 44,
    height: 4,
    borderRadius: 4,
    backgroundColor: "#e5e7eb",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginTop: 8,
  },
  modalBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 8,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  codeMono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontWeight: "800",
    color: colors.text,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modalInput: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
    backgroundColor: "#fff",
  },
  modalActions: { flexDirection: "row", gap: 10, marginTop: spacing.lg },
  modalSecondaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  modalSecondaryText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  modalDangerBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  modalDangerText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
