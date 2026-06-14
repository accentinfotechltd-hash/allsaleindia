import { useRouter } from "expo-router";
import { ChevronLeft, LifeBuoy, RefreshCw, ShieldAlert } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
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

import { getAdminSecret, setAdminSecret } from "@/src/lib/adminApi";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Overview = {
  users: number;
  sellers: number;
  products: number;
  orders_paid: number;
  revenue_nzd: number;
  pending_payouts: number;
  pending_sellers: number;
  open_returns: number;
};

async function adminFetch<T>(path: string, secret: string): Promise<T> {
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || "";
  const r = await fetch(`${base}/api${path}`, {
    headers: { "x-admin-secret": secret },
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

export default function AdminDashboard() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sellers, setSellers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const [o, sl, ord] = await Promise.all([
        adminFetch<Overview>("/admin/overview", s),
        adminFetch<any[]>("/admin/sellers", s),
        adminFetch<any[]>("/admin/orders?limit=20", s),
      ]);
      setOverview(o);
      setSellers(sl);
      setOrders(ord);
      setAuthed(true);
      await setAdminSecret(s);
    } catch (e: any) {
      Alert.alert("Access denied", e?.message?.startsWith("403") ? "Wrong admin secret." : e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-unlock if the secret is already persisted from a previous session.
  useEffect(() => {
    (async () => {
      const stored = await getAdminSecret();
      if (stored && !authed) {
        setSecret(stored);
        await load(stored);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Admin</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.lockWrap}>
          <ShieldAlert size={42} color={colors.primary} />
          <Text style={styles.lockTitle}>Admin access</Text>
          <Text style={styles.lockSub}>Enter your admin secret to view the dashboard.</Text>
          <TextInput
            testID="admin-secret-input"
            value={secret}
            onChangeText={setSecret}
            placeholder="Admin secret"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            style={styles.input}
          />
          <Pressable
            testID="admin-unlock-btn"
            disabled={loading || secret.length < 4}
            onPress={() => load(secret)}
            style={[styles.cta, (loading || secret.length < 4) && { opacity: 0.5 }]}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Unlock</Text>}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Admin · Overview</Text>
        <Pressable onPress={() => load(secret)} style={styles.backBtn} testID="admin-refresh">
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {overview && (
          <View style={styles.grid}>
            <Stat label="Users" value={String(overview.users)} />
            <Stat label="Sellers" value={String(overview.sellers)} />
            <Stat label="Products" value={String(overview.products)} />
            <Stat label="Paid orders" value={String(overview.orders_paid)} />
            <Stat label="Revenue" value={formatNZD(overview.revenue_nzd)} emphasis />
            <Stat label="Pending payouts" value={String(overview.pending_payouts)} warn={overview.pending_payouts > 0} />
            <Stat label="Pending sellers" value={String(overview.pending_sellers)} warn={overview.pending_sellers > 0} />
            <Stat label="Open returns" value={String(overview.open_returns)} warn={overview.open_returns > 0} />
          </View>
        )}

        <Pressable
          testID="admin-review-sellers-btn"
          onPress={() => router.push("/admin/sellers")}
          style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.reviewBtnText}>Review pending sellers →</Text>
        </Pressable>

        <Pressable
          testID="admin-tickets-btn"
          onPress={() => router.push("/admin/tickets")}
          style={({ pressed }) => [styles.ticketsBtn, pressed && { opacity: 0.85 }]}
        >
          <LifeBuoy size={18} color="#fff" />
          <Text style={styles.reviewBtnText}>Open support tickets →</Text>
        </Pressable>

        <Text style={styles.section}>Sellers ({sellers.length})</Text>
        {sellers.slice(0, 10).map((s) => (
          <View key={s.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{s.company_name || s.full_name || s.email}</Text>
              <Text style={styles.rowMeta}>{s.email} · {s.country || "—"}</Text>
            </View>
            <View
              style={[
                styles.chip,
                s.seller_verification_status === "auto_verified" ? styles.chipGood : styles.chipPend,
              ]}
            >
              <Text style={styles.chipText}>{s.seller_verification_status || "pending"}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.section}>Recent orders ({orders.length})</Text>
        {orders.slice(0, 10).map((o) => (
          <View key={o.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{(o.id || "").slice(0, 16)}…</Text>
              <Text style={styles.rowMeta}>{o.buyer_country || "NZ"} · {o.payment_status}</Text>
            </View>
            <Text style={styles.amount}>{formatNZD(o.total_nzd || 0)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, emphasis, warn }: { label: string; value: string; emphasis?: boolean; warn?: boolean }) {
  return (
    <View style={[styles.stat, warn && styles.statWarn]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, emphasis && { color: colors.primary }, warn && { color: "#A16207" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  lockWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  lockTitle: { fontWeight: "800", color: colors.text, fontSize: 18 },
  lockSub: { color: colors.textMuted, textAlign: "center" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", color: colors.text, fontSize: 15, minWidth: 240, textAlign: "center" },
  cta: { backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999 },
  ctaText: { color: "#fff", fontWeight: "800" },
  scroll: { padding: spacing.lg, gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { width: "48%", padding: spacing.md, borderRadius: radius.md, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border },
  statWarn: { borderColor: "#F59E0B", backgroundColor: "#FEF3C7" },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "800", marginTop: 2 },
  section: { fontWeight: "800", color: colors.text, fontSize: 14, marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  rowTitle: { fontWeight: "700", color: colors.text, fontSize: 13 },
  rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipGood: { backgroundColor: "#ECFDF5" },
  chipPend: { backgroundColor: "#FEF3C7" },
  chipText: { fontWeight: "800", fontSize: 10 },
  amount: { fontWeight: "800", color: colors.text },
  reviewBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  reviewBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  ticketsBtn: {
    backgroundColor: "#0EA5E9",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.sm,
  },
});
