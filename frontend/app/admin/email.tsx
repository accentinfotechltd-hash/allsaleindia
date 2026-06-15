import { useFocusEffect, useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  Mail,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

type Status = {
  sdk_installed: boolean;
  api_key_set: boolean;
  api_key_preview: string | null;
  from_address: string | null;
  ready: boolean;
};

export default function AdminEmailScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await adminApi<Status>("/admin/email/status");
      setStatus(s);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized) {
        router.replace("/admin");
      } else {
        Alert.alert("Failed", e?.message || "Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const send = useCallback(async () => {
    if (!to.includes("@")) {
      Alert.alert("Enter a valid email", "e.g. you@example.com");
      return;
    }
    setSending(true);
    try {
      const r = await adminApi<{ sent?: boolean; skipped?: boolean; id?: string; reason?: string }>(
        "/admin/email/test",
        { method: "POST", body: { to } },
      );
      if (r.sent) {
        Alert.alert("✅ Sent!", `Resend ID: ${r.id || "—"}\nCheck the inbox of ${to}.`);
      } else if (r.skipped) {
        Alert.alert(
          "Skipped",
          `Resend not ready: ${r.reason}\nCheck API key + from email.`,
        );
      }
    } catch (e: any) {
      Alert.alert("Send failed", e?.message || "Try again.");
    } finally {
      setSending(false);
    }
  }, [to]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="email-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Mail size={18} color={colors.primary} />
          <Text style={styles.title}>Email diagnostics</Text>
        </View>
        <Pressable testID="email-refresh" onPress={load} style={styles.backBtn}>
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading || !status ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View
              style={[
                styles.statusCard,
                status.ready ? styles.ok : styles.bad,
              ]}
            >
              {status.ready ? (
                <CheckCircle2 size={20} color="#065F46" />
              ) : (
                <XCircle size={20} color="#991B1B" />
              )}
              <Text
                style={[
                  styles.statusText,
                  { color: status.ready ? "#065F46" : "#991B1B" },
                ]}
              >
                {status.ready ? "Ready to send" : "Not ready"}
              </Text>
            </View>

            <View style={styles.detailCard}>
              <Detail label="SDK installed" ok={status.sdk_installed} />
              <Detail
                label="API key configured"
                ok={status.api_key_set}
                value={status.api_key_preview || undefined}
              />
              <Detail
                label="From address"
                ok={!!status.from_address}
                value={status.from_address || undefined}
              />
            </View>

            <Text style={styles.section}>Send test email</Text>
            <TextInput
              testID="test-email-to"
              value={to}
              onChangeText={setTo}
              placeholder="you@example.com"
              placeholderTextColor={colors.textFaint}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
            <Pressable
              testID="test-email-send"
              disabled={sending || !status.ready}
              onPress={send}
              style={({ pressed }) => [
                styles.sendBtn,
                (sending || !status.ready) && { opacity: 0.5 },
                pressed && status.ready && !sending && { opacity: 0.85 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Send size={16} color="#fff" />
                  <Text style={styles.sendText}>Send test email</Text>
                </>
              )}
            </Pressable>

            <Text style={styles.helper}>
              💡 If &quot;Not ready&quot;, install the SDK / set RESEND_API_KEY +
              RESEND_FROM_EMAIL in backend/.env. Then verify your domain at
              resend.com → Domains.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value?: string;
}) {
  return (
    <View style={styles.detailRow}>
      {ok ? (
        <CheckCircle2 size={16} color={colors.success} />
      ) : (
        <XCircle size={16} color={colors.error} />
      )}
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || (ok ? "✓" : "—")}</Text>
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
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  scroll: { padding: spacing.lg, gap: spacing.md },
  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  ok: { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  bad: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  statusText: { fontSize: 15, fontWeight: "800" },
  detailCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailLabel: { fontSize: 13, fontWeight: "700", color: colors.text, flex: 1 },
  detailValue: { fontSize: 12, color: colors.textMuted, fontFamily: "monospace" },
  section: { fontSize: 13, fontWeight: "800", color: colors.textMuted, marginTop: spacing.md, letterSpacing: 0.3 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  sendText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  helper: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginTop: spacing.sm },
});
