import { useRouter } from "expo-router";
import { AlertTriangle, CheckCircle2, ChevronLeft, RefreshCw, XCircle } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/src/lib/theme";

type PendingSeller = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  country: string | null;
  company_name: string | null;
  business_type: string | null;
  gstin: string | null;
  pan: string | null;
  id_proof_url: string | null;
  business_proof_url: string | null;
  submitted_at: string | null;
  sla_days_remaining: number | null;
  overdue: boolean;
};

async function adminFetch<T>(
  path: string,
  secret: string,
  init?: RequestInit & { body?: any },
): Promise<T> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  const r = await fetch(`${base}/api${path}`, {
    method: init?.method || "GET",
    headers: {
      "x-admin-secret": secret,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

export default function AdminSellersScreen() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [sellers, setSellers] = useState<PendingSeller[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async (s: string) => {
    if (!s) return;
    setLoading(true);
    try {
      const data = await adminFetch<{ sellers: PendingSeller[] }>(
        "/admin/sellers/pending",
        s,
      );
      setSellers(data.sellers || []);
    } catch (e: any) {
      Alert.alert("Failed", e.message);
      setSellers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (secret) refresh(secret);
  }, [secret, refresh]);

  const approve = useCallback(
    async (s: PendingSeller) => {
      setBusyId(s.user_id);
      try {
        await adminFetch(`/admin/sellers/${s.user_id}/approve`, secret, {
          method: "POST",
        });
        await refresh(secret);
        Alert.alert("Approved", `${s.company_name || s.email} can now list products.`);
      } catch (e: any) {
        Alert.alert("Failed", e.message);
      } finally {
        setBusyId(null);
      }
    },
    [secret, refresh],
  );

  const reject = useCallback(
    (s: PendingSeller) => {
      Alert.prompt?.(
        "Reject seller",
        "Reason (shown to seller):",
        async (reason) => {
          if (!reason || !reason.trim()) return;
          setBusyId(s.user_id);
          try {
            await adminFetch(`/admin/sellers/${s.user_id}/reject`, secret, {
              method: "POST",
              body: { reason: reason.trim() },
            });
            await refresh(secret);
            Alert.alert("Rejected", `Reason sent to ${s.company_name || s.email}.`);
          } catch (e: any) {
            Alert.alert("Failed", e.message);
          } finally {
            setBusyId(null);
          }
        },
        "plain-text",
      );
      // Fallback for Android (no Alert.prompt) — use a generic reason
      if (!(Alert as any).prompt) {
        Alert.alert("Provide reason on iOS", "Web/Android prompt not supported here — please use the iOS Admin app for rejection with reason.");
      }
    },
    [secret, refresh],
  );

  if (!secret) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.gate}>
          <Text style={styles.gateTitle}>Admin: pending sellers</Text>
          <Text style={styles.gateHint}>Enter admin secret to continue</Text>
          <TextInput
            testID="admin-secret-input"
            style={styles.input}
            placeholder="x-admin-secret"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            onSubmitEditing={(e) => setSecret(e.nativeEvent.text.trim())}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Pending sellers</Text>
        <Pressable onPress={() => refresh(secret)} style={styles.iconBtn}>
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : sellers && sellers.length === 0 ? (
        <View style={styles.emptyWrap}>
          <CheckCircle2 size={48} color={colors.success} />
          <Text style={styles.emptyText}>No pending sellers — all caught up!</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {sellers?.map((s) => (
            <View key={s.user_id} style={styles.card} testID={`pending-seller-${s.user_id}`}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.company}>{s.company_name || s.full_name || s.email}</Text>
                  <Text style={styles.subtle}>
                    {s.email} · {s.business_type} · {s.country || "—"}
                  </Text>
                </View>
                {s.overdue ? (
                  <View style={styles.overduePill}>
                    <AlertTriangle size={12} color={colors.danger} />
                    <Text style={styles.overdueText}>OVERDUE</Text>
                  </View>
                ) : (
                  <View style={styles.slaPill}>
                    <Text style={styles.slaText}>{s.sla_days_remaining}d left</Text>
                  </View>
                )}
              </View>

              <View style={styles.docRow}>
                <Text style={styles.field}>GSTIN: {s.gstin || "—"}</Text>
                <Text style={styles.field}>PAN: {s.pan || "—"}</Text>
              </View>

              <View style={styles.docsRow}>
                {s.id_proof_url ? (
                  <Pressable onPress={() => Linking.openURL(s.id_proof_url!)} style={styles.docPreview}>
                    {s.id_proof_url.startsWith("http") || s.id_proof_url.startsWith("data:") ? (
                      <Image source={{ uri: s.id_proof_url }} style={styles.docImg} resizeMode="cover" />
                    ) : (
                      <Text style={styles.docLink}>View ID</Text>
                    )}
                    <Text style={styles.docLabel}>Photo ID</Text>
                  </Pressable>
                ) : null}
                {s.business_proof_url ? (
                  <Pressable onPress={() => Linking.openURL(s.business_proof_url!)} style={styles.docPreview}>
                    {s.business_proof_url.startsWith("http") || s.business_proof_url.startsWith("data:") ? (
                      <Image source={{ uri: s.business_proof_url }} style={styles.docImg} resizeMode="cover" />
                    ) : (
                      <Text style={styles.docLink}>View Biz</Text>
                    )}
                    <Text style={styles.docLabel}>Business proof</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.actions}>
                <Pressable
                  testID={`reject-${s.user_id}`}
                  disabled={busyId === s.user_id}
                  onPress={() => reject(s)}
                  style={({ pressed }) => [styles.actionBtn, styles.rejectBtn, pressed && { opacity: 0.85 }]}
                >
                  <XCircle size={16} color={colors.danger} />
                  <Text style={[styles.actionText, { color: colors.danger }]}>Reject</Text>
                </Pressable>
                <Pressable
                  testID={`approve-${s.user_id}`}
                  disabled={busyId === s.user_id}
                  onPress={() => approve(s)}
                  style={({ pressed }) => [styles.actionBtn, styles.approveBtn, pressed && { opacity: 0.85 }]}
                >
                  {busyId === s.user_id ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <CheckCircle2 size={16} color="#fff" />
                      <Text style={[styles.actionText, { color: "#fff" }]}>Approve</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  gate: { flex: 1, padding: spacing.lg, justifyContent: "center", gap: 12 },
  gateTitle: { fontSize: 20, fontWeight: "800", color: colors.text },
  gateHint: { fontSize: 13, color: colors.textMuted },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 14, color: colors.text },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { padding: 6 },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  loadingWrap: { padding: 32, alignItems: "center" },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  emptyText: { fontSize: 15, fontWeight: "600", color: colors.text },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  company: { fontSize: 15, fontWeight: "800", color: colors.text },
  subtle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  slaPill: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  slaText: { fontSize: 11, fontWeight: "800", color: "#1E40AF" },
  overduePill: {
    backgroundColor: "#FEF2F2",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  overdueText: { fontSize: 11, fontWeight: "800", color: colors.danger },
  docRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  field: { fontSize: 12, color: colors.textMuted },
  docsRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  docPreview: { gap: 4, alignItems: "center" },
  docImg: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  docLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  docLink: { color: colors.primary, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: radius.md,
    gap: 6,
  },
  rejectBtn: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA" },
  approveBtn: { backgroundColor: colors.success },
  actionText: { fontSize: 13, fontWeight: "800" },
});
