import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  HandCoins,
  Landmark,
  Mail,
  Radio,
  Save,
  Send,
  StickyNote,
  XCircle,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AdminUnauthorized, adminApi } from "@/src/lib/adminApi";
import { colors, radius, spacing } from "@/src/lib/theme";

type App = {
  id: string;
  user_id: string;
  user_email: string;
  partner_id: string;
  partner_name: string;
  desired_advance_nzd: number;
  monthly_invoices_inr: number | null;
  business_age_months: number | null;
  notes: string | null;
  seller_tier: string | null;
  status: string;
  admin_notes: string | null;
  partner_notified_at: string | null;
  partner_notification_status: string | null;
  partner_notification_error: string | null;
  created_at: string;
  updated_at: string;
};

const STATUSES = [
  { value: "interest", label: "Interest", color: "#92400E" },
  { value: "submitted_to_partner", label: "With partner", color: "#1E3A8A" },
  { value: "approved", label: "Approve", color: "#065F46" },
  { value: "rejected", label: "Reject", color: "#991B1B" },
  { value: "withdrawn", label: "Withdraw", color: "#374151" },
];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  interest: { bg: "#FEF3C7", fg: "#92400E", label: "Interest noted" },
  submitted_to_partner: { bg: "#DBEAFE", fg: "#1E3A8A", label: "With partner" },
  approved: { bg: "#D1FAE5", fg: "#065F46", label: "Approved" },
  rejected: { bg: "#FEE2E2", fg: "#991B1B", label: "Rejected" },
  withdrawn: { bg: "#E5E7EB", fg: "#374151", label: "Withdrawn" },
};

export default function AdminFinancingDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [app, setApp] = useState<App | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const a = await adminApi<App>(`/admin/financing/${id}`);
      setApp(a);
      setNote(a.admin_notes || "");
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        Alert.alert("Admin login required", "Please unlock the admin dashboard.", [
          { text: "OK", onPress: () => router.replace("/admin") },
        ]);
      } else {
        Alert.alert("Failed to load", e?.message || "Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const update = useCallback(
    async (status?: string, persistNote = false) => {
      if (!id || !app) return;
      setSaving(true);
      try {
        const body: Record<string, any> = {
          status: status || app.status,
        };
        if (persistNote) body.admin_notes = note;
        const fresh = await adminApi<App>(`/admin/financing/${id}`, {
          method: "PATCH",
          body,
        });
        setApp(fresh);
      } catch (e: any) {
        Alert.alert("Update failed", e?.message || "Try again.");
      } finally {
        setSaving(false);
      }
    },
    [id, app, note],
  );

  const renotify = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const fresh = await adminApi<App>(
        `/admin/financing/${id}/notify-partner`,
        { method: "POST" },
      );
      setApp(fresh);
      Alert.alert(
        "Partner notified",
        fresh.partner_notification_status === "sent"
          ? "Partner received the application."
          : fresh.partner_notification_status === "skipped_no_channel"
          ? "No webhook/email configured for this partner."
          : "Notification failed — see error details.",
      );
    } catch (e: any) {
      Alert.alert("Failed", e?.message || "Try again.");
    } finally {
      setSaving(false);
    }
  }, [id]);

  if (loading || !app) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header onBack={() => router.back()} title="Loading…" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const s = STATUS_STYLE[app.status] || { bg: colors.surface, fg: colors.text, label: app.status };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Header
        onBack={() => router.back()}
        title={`#${app.id.replace("fin_", "").slice(0, 8).toUpperCase()}`}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Status + Partner header */}
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={[styles.statusPill, { backgroundColor: s.bg }]}>
                <Text style={[styles.statusText, { color: s.fg }]}>{s.label}</Text>
              </View>
              {app.seller_tier ? (
                <View style={styles.tierBadge}>
                  <Text style={styles.tierText}>{app.seller_tier.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.partnerRow}>
              <View style={styles.partnerIcon}>
                <Landmark size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.partnerName}>{app.partner_name}</Text>
                <Text style={styles.amount}>
                  NZD {app.desired_advance_nzd.toLocaleString()}
                </Text>
              </View>
              <HandCoins size={22} color={colors.primary} />
            </View>
            <View style={styles.metaRow}>
              <Mail size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{app.user_email}</Text>
            </View>
            <Text style={styles.subtle}>
              Raised {new Date(app.created_at).toLocaleString()} · Updated{" "}
              {new Date(app.updated_at).toLocaleString()}
            </Text>
          </View>

          {/* Application details */}
          <Text style={styles.sectionTitle}>Seller-provided details</Text>
          <View style={styles.card}>
            <DetailRow
              label="Monthly invoices"
              value={
                app.monthly_invoices_inr
                  ? `₹${app.monthly_invoices_inr.toLocaleString()}`
                  : "—"
              }
            />
            <DetailRow
              label="Business age"
              value={
                app.business_age_months ? `${app.business_age_months} months` : "—"
              }
            />
            {app.notes ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.detailLabel}>Notes from seller</Text>
                <Text style={styles.notesText}>{app.notes}</Text>
              </View>
            ) : null}
          </View>

          {/* Partner notification status */}
          <Text style={styles.sectionTitle}>Partner notification</Text>
          <View
            style={[
              styles.notifyCard,
              app.partner_notification_status === "sent" && {
                backgroundColor: "#F0FDF4",
                borderColor: "#86EFAC",
              },
              app.partner_notification_status === "failed" && {
                backgroundColor: "#FEF2F2",
                borderColor: "#FCA5A5",
              },
              app.partner_notification_status === "skipped_no_channel" && {
                backgroundColor: "#FEF3C7",
                borderColor: "#FCD34D",
              },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Radio
                size={16}
                color={
                  app.partner_notification_status === "sent"
                    ? "#065F46"
                    : app.partner_notification_status === "failed"
                    ? "#991B1B"
                    : colors.textMuted
                }
              />
              <Text style={styles.notifyTitle}>
                {app.partner_notification_status === "sent"
                  ? "Partner notified"
                  : app.partner_notification_status === "failed"
                  ? "Notification failed"
                  : app.partner_notification_status === "skipped_no_channel"
                  ? "No channel configured"
                  : "Not yet notified"}
              </Text>
            </View>
            {app.partner_notified_at ? (
              <Text style={styles.notifyMeta}>
                Last attempt: {new Date(app.partner_notified_at).toLocaleString()}
              </Text>
            ) : (
              <Text style={styles.notifyMeta}>
                Will be notified when you set status to &ldquo;With partner&rdquo;.
              </Text>
            )}
            {app.partner_notification_error ? (
              <Text style={styles.notifyError}>{app.partner_notification_error}</Text>
            ) : null}
            <Pressable
              testID="fin-renotify"
              disabled={saving}
              onPress={renotify}
              style={({ pressed }) => [
                styles.renotifyBtn,
                saving && { opacity: 0.5 },
                pressed && !saving && { opacity: 0.85 },
              ]}
            >
              <Send size={14} color={colors.primary} />
              <Text style={styles.renotifyText}>
                {app.partner_notified_at ? "Re-send notification" : "Send notification now"}
              </Text>
            </Pressable>
          </View>

          {/* Status actions */}
          <Text style={styles.sectionTitle}>Update status</Text>
          <View style={styles.statusActions}>
            {STATUSES.filter((st) => st.value !== app.status).map((st) => (
              <Pressable
                key={st.value}
                testID={`fin-status-${st.value}`}
                disabled={saving}
                onPress={() => update(st.value)}
                style={[styles.statusAction, saving && { opacity: 0.4 }]}
              >
                {st.value === "approved" ? (
                  <CheckCircle2 size={14} color={st.color} />
                ) : st.value === "rejected" ? (
                  <XCircle size={14} color={st.color} />
                ) : (
                  <Building2 size={14} color={st.color} />
                )}
                <Text style={[styles.statusActionText, { color: st.color }]}>
                  {st.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Admin notes */}
          <Text style={styles.sectionTitle}>
            <StickyNote
              size={13}
              color={colors.textMuted}
              style={{ marginRight: 4 }}
            />{" "}
            Admin notes (internal)
          </Text>
          <TextInput
            testID="fin-admin-notes"
            value={note}
            onChangeText={(t) => setNote(t.slice(0, 600))}
            placeholder="Internal notes — never shown to seller."
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.notesInput}
          />
          <Pressable
            testID="fin-save-notes"
            disabled={saving}
            onPress={() => update(undefined, true)}
            style={({ pressed }) => [
              styles.saveBtn,
              saving && { opacity: 0.5 },
              pressed && !saving && { opacity: 0.85 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Save size={16} color="#fff" />
                <Text style={styles.saveText}>Save notes</Text>
              </>
            )}
          </Pressable>

          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.topBar}>
      <Pressable testID="fin-detail-back" onPress={onBack} style={styles.backBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40 }} />
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.sm },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: "800" },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tierText: { fontSize: 10, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5 },
  partnerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  partnerIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  partnerName: { fontSize: 17, fontWeight: "800", color: colors.text },
  amount: { fontSize: 18, fontWeight: "800", color: colors.primary, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  subtle: { fontSize: 11, color: colors.textMuted },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  detailLabel: { fontSize: 12.5, color: colors.textMuted, fontWeight: "700" },
  detailValue: { fontSize: 13.5, color: colors.text, fontWeight: "700" },
  notesText: {
    fontSize: 13.5,
    color: colors.text,
    marginTop: 4,
    lineHeight: 19,
    backgroundColor: colors.surface,
    padding: 10,
    borderRadius: radius.md,
  },
  statusActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusActionText: { fontSize: 12.5, fontWeight: "800" },
  notesInput: {
    minHeight: 100,
    backgroundColor: "#FEF9C3",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#FCD34D",
    padding: 12,
    fontSize: 13.5,
    color: colors.text,
    textAlignVertical: "top",
  },
  saveBtn: {
    backgroundColor: colors.primary,
    height: 48,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  saveText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  notifyCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  notifyTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  notifyMeta: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  notifyError: {
    fontSize: 11.5,
    color: "#991B1B",
    fontFamily: "monospace",
    marginTop: 4,
    backgroundColor: "#FEE2E2",
    padding: 8,
    borderRadius: radius.sm,
  },
  renotifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    marginTop: 6,
  },
  renotifyText: { fontSize: 13, fontWeight: "800", color: colors.primary },
});
