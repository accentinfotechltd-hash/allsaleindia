import { useRouter } from "expo-router";
import {
  Calendar,
  ChevronLeft,
  Coins,
  KeyRound,
  Mail,
  Phone,
  PlayCircle,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Store,
  User as UserIcon,
  X,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
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
  fetchCurrentAdmin,
  getAdminIdentity,
  getAdminSecret,
} from "@/src/lib/adminApi";
import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { colors, radius, spacing } from "@/src/lib/theme";

type AdminUser = {
  id: string;
  email: string;
  full_name?: string | null;
  phone?: string | null;
  country?: string | null;
  currency?: string | null;
  is_seller?: boolean;
  seller_verification_status?: string | null;
  company_name?: string | null;
  email_verified?: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
  points_balance?: number;
  orders_count?: number;
  is_suspended?: boolean;
  suspend_reason?: string | null;
  suspended_at?: string | null;
  two_factor_enabled?: boolean;
};

type ListResp = {
  users: AdminUser[];
  total: number;
  limit: number;
  skip: number;
  has_more: boolean;
};

const PAGE_SIZE = 50;
type RoleFilter = "all" | "buyer" | "seller";

const ROLE_TABS: { key: RoleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "buyer", label: "Buyers" },
  { key: "seller", label: "Sellers" },
];

function initials(name?: string | null, email?: string) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const { show } = useToast();
  const confirm = useConfirm();

  const [, setMe] = useState<AdminIdentity | null>(null);
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Inline prompt-modal for typing a reason or delta on an action.
  type PromptState = {
    visible: boolean;
    kind: "suspend" | "points" | null;
    title: string;
    label: string;
    reason: string;
    delta: string;
  };
  const [prompt, setPrompt] = useState<PromptState>({
    visible: false,
    kind: null,
    title: "",
    label: "",
    reason: "",
    delta: "",
  });
  const closePrompt = () =>
    setPrompt((p) => ({ ...p, visible: false, kind: null }));

  // Fetch full /admin/users/{id} payload (live balance + suspension state)
  // whenever a row is tapped.
  const openDetail = useCallback(
    async (row: AdminUser) => {
      setDetail(row);
      try {
        const full = await adminApi<AdminUser>(`/admin/users/${row.id}`);
        setDetail((prev) => (prev?.id === row.id ? { ...prev, ...full } : prev));
      } catch {
        // silent — keep the row-snapshot
      }
    },
    [],
  );

  const refreshDetail = useCallback(async () => {
    if (!detail?.id) return;
    try {
      const full = await adminApi<AdminUser>(`/admin/users/${detail.id}`);
      setDetail(full);
      // Also update the row in the list so the avatar / badges stay fresh.
      setItems((prev) =>
        prev.map((u) => (u.id === full.id ? { ...u, ...full } : u)),
      );
    } catch {
      // silent
    }
  }, [detail?.id]);

  // ---- Action: Suspend / Reactivate ---------------------------------------
  const onSuspend = () => {
    setPrompt({
      visible: true,
      kind: "suspend",
      title: "Suspend account",
      label: "Reason (visible only to admins)",
      reason: "",
      delta: "",
    });
  };

  const submitSuspend = async () => {
    if (!detail || prompt.reason.trim().length < 4) {
      show({ title: "Add a reason (min 4 chars)", kind: "error" });
      return;
    }
    setActionBusy(true);
    try {
      await adminApi(`/admin/users/${detail.id}/suspend`, {
        method: "POST",
        body: { reason: prompt.reason.trim() },
      });
      show({ title: "Account suspended", kind: "success" });
      closePrompt();
      await refreshDetail();
    } catch (e: any) {
      show({ title: e?.message || "Suspend failed", kind: "error" });
    } finally {
      setActionBusy(false);
    }
  };

  const onReactivate = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: "Reactivate account?",
      message: "The buyer/seller will be able to sign in again immediately.",
      confirmLabel: "Reactivate",
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      await adminApi(`/admin/users/${detail.id}/reactivate`, { method: "POST" });
      show({ title: "Account reactivated", kind: "success" });
      await refreshDetail();
    } catch (e: any) {
      show({ title: e?.message || "Reactivate failed", kind: "error" });
    } finally {
      setActionBusy(false);
    }
  };

  // ---- Action: Reset 2FA --------------------------------------------------
  const onReset2FA = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: "Reset two-factor authentication?",
      message:
        "The user will be able to sign in WITHOUT their authenticator app on the next login. Only do this after verifying their identity.",
      confirmLabel: "Reset 2FA",
      destructive: true,
    });
    if (!ok) return;
    setActionBusy(true);
    try {
      await adminApi(`/admin/users/${detail.id}/reset-2fa`, { method: "POST" });
      show({ title: "2FA disabled", kind: "success" });
      await refreshDetail();
    } catch (e: any) {
      show({ title: e?.message || "Reset failed", kind: "error" });
    } finally {
      setActionBusy(false);
    }
  };

  // ---- Action: Points adjust ---------------------------------------------
  const onPointsAdjust = () => {
    setPrompt({
      visible: true,
      kind: "points",
      title: "Adjust loyalty points",
      label: "Reason (visible in the ledger)",
      reason: "",
      delta: "",
    });
  };

  const submitPointsAdjust = async () => {
    if (!detail) return;
    const delta = parseInt(prompt.delta, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      show({ title: "Enter a non-zero delta", kind: "error" });
      return;
    }
    if (prompt.reason.trim().length < 4) {
      show({ title: "Add a reason (min 4 chars)", kind: "error" });
      return;
    }
    setActionBusy(true);
    try {
      const res = await adminApi<{ balance: number }>(
        `/admin/users/${detail.id}/points-adjust`,
        {
          method: "POST",
          body: { delta, reason: prompt.reason.trim() },
        },
      );
      show({
        title: `${delta > 0 ? "Credited" : "Debited"} ${Math.abs(delta)} pts`,
        body: `New balance: ${res.balance}`,
        kind: "success",
      });
      closePrompt();
      await refreshDetail();
    } catch (e: any) {
      show({ title: e?.message || "Adjustment failed", kind: "error" });
    } finally {
      setActionBusy(false);
    }
  };


  // 400ms debounce on the search input
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  const queryString = useCallback(
    (skip: number) => {
      const parts = [`limit=${PAGE_SIZE}`, `skip=${skip}`];
      if (role !== "all") parts.push(`role=${role}`);
      if (debouncedSearch) parts.push(`q=${encodeURIComponent(debouncedSearch)}`);
      return `?${parts.join("&")}`;
    },
    [role, debouncedSearch],
  );

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        // Resolve admin identity (same pattern as reviews.tsx)
        let identity: AdminIdentity | null = await getAdminIdentity();
        if (!identity) identity = await fetchCurrentAdmin();
        if (!identity) {
          const sec = await getAdminSecret();
          if (sec) identity = bootstrapIdentity();
        }
        setMe(identity);

        const resp = await adminApi<ListResp>(`/admin/users${queryString(0)}`);
        setItems(resp.users || []);
        setTotal(resp.total || 0);
        setHasMore(!!resp.has_more);
      } catch (e: any) {
        if (e instanceof AdminUnauthorized) {
          show({ title: "Login required", kind: "error" });
          router.replace("/admin");
          return;
        }
        if (e instanceof AdminForbidden) {
          show({ title: "Manager/Support access required", kind: "error" });
          router.replace("/admin");
          return;
        }
        show({ title: e?.message || "Failed to load users", kind: "error" });
      } finally {
        setLoading(false);
      }
    },
    [queryString, router, show],
  );

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const resp = await adminApi<ListResp>(
        `/admin/users${queryString(items.length)}`,
      );
      setItems((prev) => [...prev, ...(resp.users || [])]);
      setHasMore(!!resp.has_more);
    } catch (e: any) {
      show({ title: e?.message || "Failed to load more", kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items.length, loadingMore, queryString, show]);

  const headerSubtitle = useMemo(() => {
    const showing = items.length;
    return `Showing ${showing} of ${total.toLocaleString()}`;
  }, [items.length, total]);

  const renderItem = useCallback(
    ({ item }: { item: AdminUser }) => {
      const isSeller = !!item.is_seller;
      const verified = item.seller_verification_status;
      return (
        <Pressable
          testID={`admin-user-row-${item.id}`}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
          onPress={() => openDetail(item)}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {initials(item.full_name, item.email)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {item.full_name || item.company_name || item.email}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {item.email}
            </Text>
            <View style={styles.metaRow}>
              <View style={[styles.badge, isSeller ? styles.badgeSeller : styles.badgeBuyer]}>
                {isSeller ? (
                  <Store size={10} color="#7C2D12" />
                ) : (
                  <UserIcon size={10} color="#1E40AF" />
                )}
                <Text style={[styles.badgeText, isSeller ? { color: "#7C2D12" } : { color: "#1E40AF" }]}>
                  {isSeller ? "Seller" : "Buyer"}
                </Text>
              </View>
              {item.country ? (
                <Text style={styles.metaPill}>{item.country}</Text>
              ) : null}
              {isSeller && verified ? (
                <View
                  style={[
                    styles.verifyChip,
                    verified === "auto_verified" || verified === "approved"
                      ? styles.verifyOk
                      : styles.verifyPending,
                  ]}
                >
                  <ShieldCheck
                    size={10}
                    color={
                      verified === "auto_verified" || verified === "approved"
                        ? "#065F46"
                        : "#92400E"
                    }
                  />
                  <Text
                    style={[
                      styles.verifyChipText,
                      {
                        color:
                          verified === "auto_verified" || verified === "approved"
                            ? "#065F46"
                            : "#92400E",
                      },
                    ]}
                  >
                    {verified}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.dateSm}>{formatDate(item.created_at)}</Text>
            {item.email_verified ? (
              <Text style={styles.verifiedEmail}>✓ verified</Text>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [openDetail],
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable
          testID="admin-users-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Users</Text>
          <Text style={styles.headerSub}>{headerSubtitle}</Text>
        </View>
        <Pressable
          testID="admin-users-refresh"
          onPress={() => load()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <RefreshCw size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          testID="admin-users-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search by email, name, or company"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          returnKeyType="search"
        />
        {search ? (
          <Pressable
            onPress={() => setSearch("")}
            style={styles.searchClear}
            testID="admin-users-search-clear"
            hitSlop={8}
          >
            <X size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Role tabs */}
      <View style={styles.tabRow}>
        {ROLE_TABS.map((t) => {
          const active = role === t.key;
          return (
            <Pressable
              key={t.key}
              testID={`admin-users-role-${t.key}`}
              onPress={() => setRole(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <UserIcon size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No users found</Text>
          <Text style={styles.emptyBody}>
            {debouncedSearch
              ? `No results for "${debouncedSearch}". Try a different query.`
              : "There are no users for this filter."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ padding: spacing.md }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : !hasMore && items.length > 0 ? (
              <Text style={styles.endText}>
                — End of list · {items.length} of {total} —
              </Text>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      {/* Detail Modal */}
      <Modal
        visible={!!detail}
        animationType="slide"
        transparent
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>User details</Text>
              <Pressable
                onPress={() => setDetail(null)}
                testID="admin-user-detail-close"
                hitSlop={8}
              >
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            {detail ? (
              <View style={{ gap: 10 }}>
                <View style={styles.detailHero}>
                  <View style={[styles.avatar, { width: 56, height: 56, borderRadius: 28 }]}>
                    <Text style={[styles.avatarText, { fontSize: 18 }]}>
                      {initials(detail.full_name, detail.email)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailName}>
                      {detail.full_name || detail.company_name || detail.email}
                    </Text>
                    <Text style={styles.detailRoleSmall}>
                      {detail.is_seller ? "Seller account" : "Buyer account"}
                      {detail.country ? ` · ${detail.country}` : ""}
                    </Text>
                  </View>
                </View>

                <DetailRow
                  icon={<Mail size={14} color={colors.textMuted} />}
                  label="Email"
                  value={`${detail.email}${detail.email_verified ? " · ✓" : ""}`}
                />
                {detail.phone ? (
                  <DetailRow
                    icon={<Phone size={14} color={colors.textMuted} />}
                    label="Phone"
                    value={detail.phone}
                  />
                ) : null}
                {detail.is_seller && detail.company_name ? (
                  <DetailRow
                    icon={<Store size={14} color={colors.textMuted} />}
                    label="Company"
                    value={detail.company_name}
                  />
                ) : null}
                {detail.is_seller && detail.seller_verification_status ? (
                  <DetailRow
                    icon={<ShieldCheck size={14} color={colors.textMuted} />}
                    label="Verification"
                    value={detail.seller_verification_status}
                  />
                ) : null}
                <DetailRow
                  icon={<Calendar size={14} color={colors.textMuted} />}
                  label="Joined"
                  value={formatDate(detail.created_at)}
                />
                {detail.last_login_at ? (
                  <DetailRow
                    icon={<Calendar size={14} color={colors.textMuted} />}
                    label="Last login"
                    value={formatDate(detail.last_login_at)}
                  />
                ) : null}
                {typeof detail.points_balance === "number" ? (
                  <DetailRow
                    icon={<UserIcon size={14} color={colors.textMuted} />}
                    label="Points balance"
                    value={String(detail.points_balance)}
                  />
                ) : null}
                <Text style={styles.detailIdHint}>
                  ID: {detail.id}
                </Text>

                {/* Suspension banner */}
                {detail.is_suspended ? (
                  <View style={styles.suspendBanner} testID="user-suspended-banner">
                    <ShieldOff size={14} color={colors.error} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suspendTitle}>Account suspended</Text>
                      {detail.suspend_reason ? (
                        <Text style={styles.suspendReason} numberOfLines={3}>
                          {detail.suspend_reason}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {/* Admin actions */}
                <View style={styles.actionsHead}>
                  <Text style={styles.actionsHeadText}>Admin actions</Text>
                </View>
                <View style={styles.actionsGrid}>
                  {detail.is_suspended ? (
                    <Pressable
                      testID="admin-user-reactivate-btn"
                      disabled={actionBusy}
                      onPress={onReactivate}
                      style={[styles.actionBtn, styles.actionPrimary, actionBusy && { opacity: 0.6 }]}
                    >
                      <PlayCircle size={14} color="#fff" />
                      <Text style={styles.actionPrimaryText}>Reactivate</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      testID="admin-user-suspend-btn"
                      disabled={actionBusy}
                      onPress={onSuspend}
                      style={[styles.actionBtn, styles.actionDanger, actionBusy && { opacity: 0.6 }]}
                    >
                      <PowerOff size={14} color={colors.error} />
                      <Text style={styles.actionDangerText}>Suspend</Text>
                    </Pressable>
                  )}

                  <Pressable
                    testID="admin-user-reset-2fa-btn"
                    disabled={actionBusy || !detail.two_factor_enabled}
                    onPress={onReset2FA}
                    style={[
                      styles.actionBtn,
                      styles.actionSecondary,
                      (actionBusy || !detail.two_factor_enabled) && { opacity: 0.5 },
                    ]}
                  >
                    <KeyRound size={14} color={colors.text} />
                    <Text style={styles.actionSecondaryText}>
                      {detail.two_factor_enabled ? "Reset 2FA" : "2FA off"}
                    </Text>
                  </Pressable>

                  <Pressable
                    testID="admin-user-points-adjust-btn"
                    disabled={actionBusy}
                    onPress={onPointsAdjust}
                    style={[styles.actionBtn, styles.actionSecondary, actionBusy && { opacity: 0.6 }]}
                  >
                    <Coins size={14} color={colors.text} />
                    <Text style={styles.actionSecondaryText}>Adjust points</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Prompt Modal — captures reason / delta for suspend & points actions */}
      <Modal
        visible={prompt.visible}
        animationType="fade"
        transparent
        onRequestClose={closePrompt}
      >
        <View style={styles.modalScrim}>
          <View style={[styles.modalCard, { padding: spacing.lg }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{prompt.title}</Text>
              <Pressable onPress={closePrompt} testID="admin-user-prompt-close" hitSlop={8}>
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            {prompt.kind === "points" ? (
              <>
                <Text style={styles.promptLabel}>Delta (+credit / −debit)</Text>
                <TextInput
                  testID="admin-user-prompt-delta"
                  keyboardType="numbers-and-punctuation"
                  value={prompt.delta}
                  onChangeText={(v) =>
                    setPrompt((p) => ({ ...p, delta: v.replace(/[^\d-]/g, "") }))
                  }
                  placeholder="e.g. 500 or -100"
                  placeholderTextColor={colors.textFaint}
                  style={styles.promptInput}
                />
              </>
            ) : null}

            <Text style={styles.promptLabel}>{prompt.label}</Text>
            <TextInput
              testID="admin-user-prompt-reason"
              value={prompt.reason}
              onChangeText={(v) => setPrompt((p) => ({ ...p, reason: v }))}
              placeholder="Why are you doing this?"
              placeholderTextColor={colors.textFaint}
              multiline
              style={[styles.promptInput, { minHeight: 70, textAlignVertical: "top" }]}
              maxLength={240}
            />

            <View style={styles.promptActions}>
              <Pressable
                onPress={closePrompt}
                style={[styles.actionBtn, styles.actionSecondary, { flex: 1 }]}
                testID="admin-user-prompt-cancel"
              >
                <Text style={styles.actionSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={actionBusy}
                onPress={
                  prompt.kind === "suspend"
                    ? submitSuspend
                    : submitPointsAdjust
                }
                style={[
                  styles.actionBtn,
                  styles.actionPrimary,
                  { flex: 1 },
                  actionBusy && { opacity: 0.6 },
                ]}
                testID="admin-user-prompt-submit"
              >
                {actionBusy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.actionPrimaryText}>Confirm</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>{icon}</View>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitleWrap: { flex: 1, alignItems: "center" },
  headerTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  headerSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },

  searchWrap: {
    margin: spacing.md,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 44,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  searchClear: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.surface,
  },

  tabRow: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    gap: 6,
    marginBottom: spacing.sm,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: { color: colors.text, fontWeight: "700", fontSize: 12 },
  tabTextActive: { color: "#fff" },

  loadingWrap: { padding: spacing.xl, alignItems: "center" },

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  emptyBody: { color: colors.textMuted, fontSize: 13, textAlign: "center" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: "#fff",
    gap: 12,
  },
  sep: { height: 1, backgroundColor: colors.border, marginLeft: 60 },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft || "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 14,
  },
  name: { fontWeight: "800", color: colors.text, fontSize: 14 },
  email: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeSeller: { backgroundColor: "#FED7AA" },
  badgeBuyer: { backgroundColor: "#DBEAFE" },
  badgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
  metaPill: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: "700",
    backgroundColor: colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  verifyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  verifyOk: { backgroundColor: "#D1FAE5" },
  verifyPending: { backgroundColor: "#FEF3C7" },
  verifyChipText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },

  dateSm: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
  verifiedEmail: { color: "#065F46", fontSize: 10, fontWeight: "700", marginTop: 2 },

  endText: {
    textAlign: "center",
    color: colors.textFaint,
    fontSize: 11,
    paddingVertical: 16,
  },

  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    maxHeight: "85%",
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  modalTitle: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 16 },

  detailHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: spacing.sm,
  },
  detailName: { fontWeight: "800", color: colors.text, fontSize: 16 },
  detailRoleSmall: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailIcon: { width: 18 },
  detailLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", width: 96 },
  detailValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "600" },
  detailIdHint: {
    color: colors.textFaint,
    fontSize: 10,
    fontFamily: "monospace",
    marginTop: 8,
  },

  // Suspension banner
  suspendBanner: {
    marginTop: spacing.sm,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  suspendTitle: { color: colors.error, fontWeight: "800", fontSize: 12 },
  suspendReason: { color: "#7F1D1D", fontSize: 11, marginTop: 2 },

  // Admin actions
  actionsHead: { marginTop: spacing.md, marginBottom: spacing.xs },
  actionsHeadText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  actionsGrid: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  actionBtn: {
    flexGrow: 1,
    minWidth: "30%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  actionPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  actionSecondary: {
    backgroundColor: "#fff",
    borderColor: colors.border,
  },
  actionSecondaryText: { color: colors.text, fontWeight: "800", fontSize: 12 },
  actionDanger: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FCA5A5",
  },
  actionDangerText: { color: colors.error, fontWeight: "800", fontSize: 12 },

  // Prompt modal
  promptLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  promptInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 10,
    color: colors.text,
    fontSize: 13,
    backgroundColor: "#fff",
  },
  promptActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.md,
  },
});
