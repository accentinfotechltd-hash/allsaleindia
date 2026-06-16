import { useRouter } from "expo-router";
import { ChevronLeft, HandCoins, LifeBuoy, LineChart, LogOut, Mail, MessageSquare, RefreshCw, ShieldAlert, Users } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
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

import {
  AdminForbidden,
  AdminIdentity,
  AdminUnauthorized,
  adminApi,
  bootstrapIdentity,
  clearAdminAuth,
  fetchCurrentAdmin,
  getAdminSecret,
  getAdminToken,
  hasRole,
  loginWithPassword,
  setAdminSecret,
} from "@/src/lib/adminApi";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
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

type AuthMode = "password" | "secret";

export default function AdminDashboard() {
  const router = useRouter();
  const { t } = useTranslation();
  const { show } = useToast();

  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");

  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sellers, setSellers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [o, sl, ord] = await Promise.all([
        adminApi<Overview>("/admin/overview"),
        adminApi<any[]>("/admin/sellers"),
        adminApi<any[]>("/admin/orders?limit=20"),
      ]);
      setOverview(o);
      setSellers(sl);
      setOrders(ord);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized || e instanceof AdminForbidden) {
        setIdentity(null);
        await clearAdminAuth();
        show({ title: t("admin.access_denied"), kind: "error" });
      } else {
        show({ title: e?.message || "Failed to load", kind: "error" });
      }
    } finally {
      setLoading(false);
    }
  }, [show, t]);

  // Boot — auto-unlock from a stored token or legacy secret.
  useEffect(() => {
    (async () => {
      try {
        // 1) try JWT
        const me = await fetchCurrentAdmin();
        if (me) {
          setIdentity({ id: me.id, email: me.email, full_name: me.full_name, role: me.role });
          await loadData();
          return;
        }
        // 2) try legacy bootstrap secret
        const stored = await getAdminSecret();
        if (stored) {
          setSecret(stored);
          setIdentity(bootstrapIdentity());
          await loadData();
        }
      } catch {
        /* fall through to lock screen */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLoginPassword = async () => {
    if (!email.trim() || password.length < 8) {
      show({ title: "Email + 8-char password required", kind: "error" });
      return;
    }
    setAuthBusy(true);
    try {
      const id = await loginWithPassword(email.trim().toLowerCase(), password);
      setIdentity(id);
      setPassword("");
      await loadData();
    } catch (e: any) {
      show({ title: e?.message || "Login failed", kind: "error" });
    } finally {
      setAuthBusy(false);
    }
  };

  const onLoginSecret = async () => {
    if (secret.length < 4) {
      show({ title: "Enter your admin secret", kind: "error" });
      return;
    }
    setAuthBusy(true);
    try {
      await setAdminSecret(secret);
      setIdentity(bootstrapIdentity());
      await loadData();
    } catch (e: any) {
      show({ title: e?.message || "Failed", kind: "error" });
    } finally {
      setAuthBusy(false);
    }
  };

  const onLogout = async () => {
    await clearAdminAuth();
    setIdentity(null);
    setOverview(null);
    setSellers([]);
    setOrders([]);
    setSecret("");
    setEmail("");
    setPassword("");
  };

  // ---------------- LOCK SCREEN ----------------
  if (!identity) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Admin</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.lockScroll} keyboardShouldPersistTaps="handled">
          <ShieldAlert size={42} color={colors.primary} />
          <Text style={styles.lockTitle}>Admin access</Text>
          <Text style={styles.lockSub}>
            {authMode === "password"
              ? "Sign in with your admin email and password."
              : "Use the bootstrap owner secret (legacy)."}
          </Text>

          <View style={styles.tabRow}>
            <Pressable
              onPress={() => setAuthMode("password")}
              style={[styles.tab, authMode === "password" && styles.tabActive]}
            >
              <Text style={[styles.tabText, authMode === "password" && styles.tabTextActive]}>
                Email + password
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAuthMode("secret")}
              style={[styles.tab, authMode === "secret" && styles.tabActive]}
            >
              <Text style={[styles.tabText, authMode === "secret" && styles.tabTextActive]}>
                Owner secret
              </Text>
            </Pressable>
          </View>

          {authMode === "password" ? (
            <>
              <TextInput
                testID="admin-login-email"
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                style={styles.input}
              />
              <TextInput
                testID="admin-login-password"
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textFaint}
                secureTextEntry
                style={styles.input}
              />
              <Pressable
                testID="admin-login-btn"
                disabled={authBusy || !email.trim() || password.length < 8}
                onPress={onLoginPassword}
                style={[
                  styles.cta,
                  (authBusy || !email.trim() || password.length < 8) && { opacity: 0.5 },
                ]}
              >
                {authBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Sign in</Text>}
              </Pressable>
            </>
          ) : (
            <>
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
                disabled={authBusy || secret.length < 4}
                onPress={onLoginSecret}
                style={[styles.cta, (authBusy || secret.length < 4) && { opacity: 0.5 }]}
              >
                {authBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Unlock</Text>}
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------------- DASHBOARD ----------------
  const isOwner = identity.role === "owner";
  const canSeePayouts = hasRole(identity, ["manager"]);
  const canSeeFinancing = hasRole(identity, ["manager"]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("admin.overview")}</Text>
        <Pressable onPress={loadData} style={styles.backBtn} testID="admin-refresh">
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      {/* Role banner */}
      <View style={styles.roleBanner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleEmail} numberOfLines={1}>
            {identity.email}
          </Text>
          <Text style={styles.roleLabel}>{identity.role.toUpperCase()}</Text>
        </View>
        <Pressable onPress={onLogout} style={styles.logoutBtn} testID="admin-logout-btn">
          <LogOut size={14} color={colors.textMuted} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading && !overview && (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        )}
        {overview && (
          <View style={styles.grid}>
            <Stat label="Users" value={String(overview.users)} />
            <Stat label="Sellers" value={String(overview.sellers)} />
            <Stat label="Products" value={String(overview.products)} />
            <Stat label="Paid orders" value={String(overview.orders_paid)} />
            <Stat label="Revenue" value={formatNZD(overview.revenue_nzd)} emphasis />
            {canSeePayouts && (
              <Stat
                label="Pending payouts"
                value={String(overview.pending_payouts)}
                warn={overview.pending_payouts > 0}
              />
            )}
            <Stat
              label="Pending sellers"
              value={String(overview.pending_sellers)}
              warn={overview.pending_sellers > 0}
            />
            <Stat
              label="Open returns"
              value={String(overview.open_returns)}
              warn={overview.open_returns > 0}
            />
          </View>
        )}

        <Pressable
          testID="admin-review-sellers-btn"
          onPress={() => router.push("/admin/sellers")}
          style={({ pressed }) => [styles.reviewBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.reviewBtnText}>{t("admin.review_pending_sellers")}</Text>
        </Pressable>

        <Pressable
          testID="admin-tickets-btn"
          onPress={() => router.push("/admin/tickets")}
          style={({ pressed }) => [styles.ticketsBtn, pressed && { opacity: 0.85 }]}
        >
          <LifeBuoy size={18} color="#fff" />
          <Text style={styles.reviewBtnText}>{t("admin.open_support_tickets")}</Text>
        </Pressable>

        {canSeeFinancing && (
          <Pressable
            testID="admin-financing-btn"
            onPress={() => router.push("/admin/financing")}
            style={({ pressed }) => [styles.financingBtn, pressed && { opacity: 0.85 }]}
          >
            <HandCoins size={18} color="#fff" />
            <Text style={styles.reviewBtnText}>{t("admin.financing_applications")}</Text>
          </Pressable>
        )}

        {canSeePayouts && (
          <Pressable
            testID="admin-analytics-btn"
            onPress={() => router.push("/admin/analytics")}
            style={({ pressed }) => [styles.analyticsBtn, pressed && { opacity: 0.85 }]}
          >
            <LineChart size={18} color="#fff" />
            <Text style={styles.reviewBtnText}>A/B Analytics</Text>
          </Pressable>
        )}

        <Pressable
          testID="admin-email-btn"
          onPress={() => router.push("/admin/email")}
          style={({ pressed }) => [styles.emailBtn, pressed && { opacity: 0.85 }]}
        >
          <Mail size={18} color="#fff" />
          <Text style={styles.reviewBtnText}>{t("admin.email_diagnostics")}</Text>
        </Pressable>

        {isOwner && (
          <Pressable
            testID="admin-team-btn"
            onPress={() => router.push("/admin/team")}
            style={({ pressed }) => [styles.teamBtn, pressed && { opacity: 0.85 }]}
          >
            <Users size={18} color="#fff" />
            <Text style={styles.reviewBtnText}>Team & Sub-admins</Text>
          </Pressable>
        )}

        <Pressable
          testID="admin-reviews-btn"
          onPress={() => router.push("/admin/reviews")}
          style={({ pressed }) => [styles.reviewsBtn, pressed && { opacity: 0.85 }]}
        >
          <MessageSquare size={18} color="#fff" />
          <Text style={styles.reviewBtnText}>Reviews moderation</Text>
        </Pressable>

        <Text style={styles.section}>{t("admin.sellers_count", { count: sellers.length })}</Text>
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

        <Text style={styles.section}>{t("admin.recent_orders", { count: orders.length })}</Text>
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
  lockScroll: { padding: spacing.xl, alignItems: "center", gap: spacing.md, paddingBottom: 80 },
  lockTitle: { fontWeight: "800", color: colors.text, fontSize: 18 },
  lockSub: { color: colors.textMuted, textAlign: "center" },
  tabRow: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    padding: 4,
    marginTop: spacing.sm,
  },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  tabActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tabText: { color: colors.textMuted, fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff", color: colors.text, fontSize: 15, minWidth: 260, width: "100%", maxWidth: 320, textAlign: "center" },
  cta: { backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, minWidth: 160, alignItems: "center" },
  ctaText: { color: "#fff", fontWeight: "800" },
  roleBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  roleEmail: { color: colors.text, fontWeight: "700", fontSize: 13 },
  roleLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 0.5, fontWeight: "600", marginTop: 1 },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border },
  logoutText: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  scroll: { padding: spacing.md, paddingBottom: 64 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flexBasis: "31%", flexGrow: 1, backgroundColor: "#fff", borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  statWarn: { backgroundColor: "#FEF3C7", borderColor: "#FCD34D" },
  statLabel: { color: colors.textMuted, fontSize: 11, marginBottom: 4 },
  statValue: { color: colors.text, fontWeight: "800", fontSize: 16 },
  section: { fontWeight: "800", color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm, fontSize: 13, letterSpacing: 0.3 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: "#fff", borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  rowTitle: { color: colors.text, fontWeight: "700", fontSize: 13 },
  rowMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  amount: { color: colors.text, fontWeight: "800" },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  chipText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  chipGood: { backgroundColor: "#D1FAE5" },
  chipPend: { backgroundColor: "#FEF3C7" },
  reviewBtn: { marginTop: spacing.md, backgroundColor: colors.primary, paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  reviewBtnText: { color: "#fff", fontWeight: "800" },
  ticketsBtn: { marginTop: spacing.sm, backgroundColor: "#0EA5E9", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  financingBtn: { marginTop: spacing.sm, backgroundColor: "#7C3AED", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  emailBtn: { marginTop: spacing.sm, backgroundColor: "#10B981", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  teamBtn: { marginTop: spacing.sm, backgroundColor: "#F97316", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  reviewsBtn: { marginTop: spacing.sm, backgroundColor: "#8B5CF6", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
  analyticsBtn: { marginTop: spacing.sm, backgroundColor: "#0F172A", paddingHorizontal: 22, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 },
});
