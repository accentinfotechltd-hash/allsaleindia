/**
 * Seller Sponsored Campaigns — single screen with list + create form.
 *
 * Sellers tap "Promote a product" to open a slide-up form (product picker
 * + daily budget + CPC). Existing campaigns show with stats, pause toggle,
 * and a long-press delete. Spend (today + total) is shown prominently so
 * sellers know exactly what they'll be invoiced.
 */
import { useFocusEffect, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import {
  AlertCircle,
  ChevronLeft,
  CreditCard,
  Eye,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react-native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Campaign = {
  id: string;
  product_id: string;
  product_name?: string | null;
  product_image?: string | null;
  daily_budget_nzd: number;
  cpc_nzd: number;
  placements: string[];
  status: "active" | "paused" | "out_of_budget" | "deleted";
  impressions: number;
  clicks: number;
  ctr: number;
  spent_today: number;
  spent_total: number;
};

type SellerProduct = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
};

const STATUS_META: Record<
  Campaign["status"],
  { bg: string; fg: string; label: string }
> = {
  active: { bg: "#DCFCE7", fg: "#166534", label: "Active" },
  paused: { bg: "#FEF3C7", fg: "#92400E", label: "Paused" },
  out_of_budget: { bg: "#FFE4D9", fg: "#9A3412", label: "Out of budget" },
  deleted: { bg: "#E5E7EB", fg: "#374151", label: "Deleted" },
};

export default function SponsoredScreen() {
  const router = useRouter();
  const { show } = useToast();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Campaign[]>("/seller/sponsored/campaigns");
      setItems(d);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const togglePause = useCallback(
    async (c: Campaign) => {
      const next = c.status === "active" ? "paused" : "active";
      try {
        const u = await api<Campaign>(
          `/seller/sponsored/campaigns/${c.id}`,
          { method: "PATCH", body: { status: next } }
        );
        setItems((prev) => prev.map((p) => (p.id === u.id ? u : p)));
      } catch (e: any) {
        show({ title: "Couldn't update", body: e?.message || "", kind: "error" });
      }
    },
    [show]
  );

  const remove = useCallback(
    (c: Campaign) => {
      const doIt = async () => {
        try {
          await api(`/seller/sponsored/campaigns/${c.id}`, { method: "DELETE" });
          setItems((prev) => prev.filter((p) => p.id !== c.id));
          show({ title: "Campaign deleted", kind: "success" });
        } catch (e: any) {
          show({ title: "Couldn't delete", body: e?.message || "", kind: "error" });
        }
      };
      if (Platform.OS === "web") {
        if (window.confirm(`Delete the campaign for ${c.product_name}?`)) doIt();
      } else {
        Alert.alert(
          "Delete campaign?",
          `This stops promotion for ${c.product_name}. Stats are kept for billing.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: doIt },
          ]
        );
      }
    },
    [show]
  );

  const totalSpentToday = useMemo(
    () => items.reduce((acc, c) => acc + (c.spent_today || 0), 0),
    [items]
  );
  const totalSpentMonth = useMemo(
    () => items.reduce((acc, c) => acc + (c.spent_total || 0), 0),
    [items]
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="sponsored-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Sponsored placements</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Sparkles size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Boost what you want sold</Text>
            <Text style={styles.heroSub}>
              Pay-per-click. Top up your wallet, set a daily budget, pause
              anytime.
            </Text>
          </View>
        </View>

        <WalletCard show={show} />

        {items.length > 0 ? (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Spent today</Text>
              <Text style={styles.statValue}>${totalSpentToday.toFixed(2)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>This month</Text>
              <Text style={styles.statValue}>${totalSpentMonth.toFixed(2)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Campaigns</Text>
              <Text style={styles.statValue}>{items.length}</Text>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No campaigns yet</Text>
            <Text style={styles.emptyBody}>
              Promote a listing into the home, category and search pages.
              You set the daily budget and pay only when shoppers click.
            </Text>
          </View>
        ) : (
          items.map((c) => {
            const s = STATUS_META[c.status];
            const pctSpent = Math.min(
              100,
              Math.round(
                (c.spent_today / Math.max(c.daily_budget_nzd, 0.01)) * 100
              )
            );
            return (
              <View key={c.id} style={styles.card} testID={`sponsored-card-${c.id}`}>
                <View style={styles.cardTop}>
                  {c.product_image ? (
                    <Image
                      source={{ uri: c.product_image }}
                      style={styles.thumb}
                    />
                  ) : (
                    <View style={[styles.thumb, { backgroundColor: colors.surface }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName} numberOfLines={2}>
                      {c.product_name || c.product_id}
                    </Text>
                    <View
                      style={[styles.statusPill, { backgroundColor: s.bg }]}
                    >
                      <Text style={[styles.statusText, { color: s.fg }]}>
                        {s.label}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.budgetRow}>
                  <Text style={styles.budgetText}>
                    ${c.spent_today.toFixed(2)} / ${c.daily_budget_nzd.toFixed(2)} today
                  </Text>
                  <Text style={styles.cpcText}>${c.cpc_nzd.toFixed(2)} CPC</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${pctSpent}%`,
                        backgroundColor:
                          c.status === "out_of_budget"
                            ? colors.error
                            : colors.primary,
                      },
                    ]}
                  />
                </View>

                <View style={styles.metricsRow}>
                  <View style={styles.metricChip}>
                    <Eye size={12} color={colors.textMuted} />
                    <Text style={styles.metricText}>
                      {c.impressions.toLocaleString()}
                    </Text>
                  </View>
                  <View style={styles.metricChip}>
                    <MousePointerClick size={12} color={colors.textMuted} />
                    <Text style={styles.metricText}>{c.clicks}</Text>
                  </View>
                  <View style={styles.metricChip}>
                    <TrendingUp size={12} color={colors.textMuted} />
                    <Text style={styles.metricText}>{c.ctr}%</Text>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    testID={`sponsored-pause-${c.id}`}
                    onPress={() => togglePause(c)}
                    disabled={c.status === "out_of_budget"}
                    style={[
                      styles.iconBtn,
                      c.status === "out_of_budget" && { opacity: 0.4 },
                    ]}
                  >
                    {c.status === "active" ? (
                      <Pause size={14} color={colors.text} />
                    ) : (
                      <Play size={14} color={colors.primary} />
                    )}
                  </Pressable>
                  <Pressable
                    testID={`sponsored-delete-${c.id}`}
                    onPress={() => remove(c)}
                    style={styles.iconBtn}
                  >
                    <Trash2 size={14} color={colors.error} />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={styles.fab}>
        <Pressable
          testID="sponsored-new"
          onPress={() => setShowCreate(true)}
          style={({ pressed }) => [
            styles.fabBtn,
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
        >
          <Plus size={18} color="#fff" />
          <Text style={styles.fabText}>Promote a product</Text>
        </Pressable>
      </SafeAreaView>

      <CreateCampaignModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(c) => {
          setItems((prev) => [c, ...prev]);
          setShowCreate(false);
          show({ title: "Campaign live", kind: "success" });
        }}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------
function CreateCampaignModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (c: Campaign) => void;
}) {
  const { show } = useToast();
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loadingProds, setLoadingProds] = useState(false);
  const [pid, setPid] = useState<string | null>(null);
  const [budget, setBudget] = useState("10");
  const [cpc, setCpc] = useState("0.50");
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setLoadingProds(true);
    api<SellerProduct[]>("/seller/products")
      .then((d) => setProducts(d))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProds(false));
  }, [visible]);

  const canSubmit = useMemo(
    () =>
      !!pid &&
      parseFloat(budget) >= 1 &&
      parseFloat(cpc) >= 0.1 &&
      !submitting,
    [pid, budget, cpc, submitting]
  );

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const c = await api<Campaign>("/seller/sponsored/campaigns", {
        method: "POST",
        body: {
          product_id: pid,
          daily_budget_nzd: parseFloat(budget),
          cpc_nzd: parseFloat(cpc),
          placements: ["home", "category", "search"],
        },
      });
      onCreated(c);
      // reset
      setPid(null);
      setBudget("10");
      setCpc("0.50");
    } catch (e: any) {
      show({
        title: "Couldn't create campaign",
        body: e?.message || "",
        kind: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, pid, budget, cpc, onCreated, show]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Promote a product</Text>
            <Pressable
              testID="sponsored-new-close"
              onPress={onClose}
              style={styles.modalCloseBtn}
            >
              <X size={20} color={colors.text} />
            </Pressable>
          </View>

          <Text style={styles.label}>Pick a listing</Text>
          {loadingProds ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={products}
              keyExtractor={(p) => p.id}
              contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
              renderItem={({ item }) => {
                const active = pid === item.id;
                return (
                  <Pressable
                    testID={`sponsored-pick-${item.id}`}
                    onPress={() => setPid(item.id)}
                    style={[
                      styles.pickCard,
                      active && styles.pickCardActive,
                    ]}
                  >
                    <Image source={{ uri: item.image }} style={styles.pickImage} />
                    <Text style={styles.pickName} numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text style={styles.pickPrice}>
                      ${item.price_nzd.toFixed(2)}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Daily budget (NZD)</Text>
              <TextInput
                testID="sponsored-budget-input"
                value={budget}
                onChangeText={setBudget}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholder="10"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Cost per click</Text>
              <TextInput
                testID="sponsored-cpc-input"
                value={cpc}
                onChangeText={setCpc}
                keyboardType="decimal-pad"
                style={styles.input}
                placeholder="0.50"
              />
            </View>
          </View>

          <View style={styles.hintBox}>
            <AlertCircle size={14} color="#92400E" />
            <Text style={styles.hintText}>
              Estimated reach: {Math.round(parseFloat(budget || "0") / Math.max(parseFloat(cpc || "0.5"), 0.1))}{" "}
              clicks/day. We&apos;ll auto-pause when the daily budget is spent
              and resume tomorrow.
            </Text>
          </View>

          <Pressable
            testID="sponsored-submit"
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.primaryBtn, !canSubmit && { opacity: 0.4 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Launch campaign</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Wallet card — balance + topup
// ---------------------------------------------------------------------------
function WalletCard({ show }: { show: (o: any) => void }) {
  const [wallet, setWallet] = React.useState<{
    balance_nzd: number;
    lifetime_topup_nzd: number;
    lifetime_spent_nzd: number;
  } | null>(null);
  const [amount, setAmount] = React.useState("50");
  const [busy, setBusy] = React.useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<any>("/seller/sponsored/wallet");
      setWallet(d);
    } catch {
      // ignore
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const topup = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amt || amt < 5) {
      show({ title: "Minimum top-up is $5 NZD", kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const d = await api<{ url: string }>("/seller/sponsored/wallet/topup", {
        method: "POST",
        body: { amount_nzd: amt },
      });
      if (Platform.OS === "web") {
        window.open(d.url, "_blank");
      } else {
        await Linking.openURL(d.url);
      }
      show({
        title: "Opening Stripe Checkout",
        body: "Your wallet will update after payment.",
        kind: "success",
      });
    } catch (e: any) {
      show({
        title: "Topup failed",
        body: e?.message || "",
        kind: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [amount, show]);

  if (!wallet) return null;
  return (
    <View style={walletStyles.card}>
      <View style={walletStyles.headerRow}>
        <View style={walletStyles.iconWrap}>
          <Wallet size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={walletStyles.label}>Ad wallet balance</Text>
          <Text style={walletStyles.balance}>
            ${wallet.balance_nzd.toFixed(2)}
          </Text>
        </View>
      </View>
      <Text style={walletStyles.meta}>
        Topped up ${wallet.lifetime_topup_nzd.toFixed(0)} · spent $
        {wallet.lifetime_spent_nzd.toFixed(2)} lifetime
      </Text>
      <View style={walletStyles.row}>
        <TextInput
          testID="sponsored-topup-input"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={walletStyles.input}
          placeholder="50"
        />
        <Pressable
          testID="sponsored-topup-btn"
          onPress={topup}
          disabled={busy}
          style={[walletStyles.topupBtn, busy && { opacity: 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <CreditCard size={14} color="#fff" />
              <Text style={walletStyles.topupBtnText}>Top up via Stripe</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const walletStyles = StyleSheet.create({
  card: {
    margin: spacing.md, marginTop: 0, padding: spacing.md,
    backgroundColor: "#fff", borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, gap: 8,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
  },
  label: { color: colors.textMuted, fontSize: 11, textTransform: "uppercase" },
  balance: { color: colors.text, fontWeight: "900", fontSize: 22 },
  meta: { color: colors.textMuted, fontSize: 11 },
  row: { flexDirection: "row", gap: 8, marginTop: 6 },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, fontWeight: "700", color: colors.text,
    borderWidth: 1, borderColor: colors.border,
  },
  topupBtn: {
    flexDirection: "row", gap: 6, alignItems: "center",
    backgroundColor: colors.primary, paddingHorizontal: 14,
    borderRadius: radius.md, justifyContent: "center",
  },
  topupBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});

// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: "#fff",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  center: { padding: 32, alignItems: "center" },

  heroCard: {
    flexDirection: "row", gap: 12, alignItems: "center",
    padding: spacing.md, margin: spacing.md, marginBottom: 8,
    backgroundColor: colors.primarySoft, borderRadius: radius.lg,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
  },
  heroTitle: { fontWeight: "800", color: colors.text, fontSize: 15 },
  heroSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  statsRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  statCard: {
    flex: 1, padding: spacing.md, backgroundColor: "#fff",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: "center",
  },
  statLabel: { color: colors.textMuted, fontSize: 10, textTransform: "uppercase" },
  statValue: { color: colors.text, fontWeight: "800", fontSize: 18, marginTop: 4 },

  empty: { padding: spacing.xl, alignItems: "center", gap: 6 },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16 },
  emptyBody: {
    color: colors.textMuted, fontSize: 12, lineHeight: 17,
    textAlign: "center", paddingHorizontal: spacing.md,
  },

  card: {
    margin: spacing.md, marginTop: 6, padding: spacing.md,
    backgroundColor: "#fff", borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  cardTop: { flexDirection: "row", gap: 10 },
  thumb: { width: 56, height: 56, borderRadius: radius.sm },
  cardName: { fontWeight: "700", color: colors.text, fontSize: 14 },
  statusPill: {
    alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999, marginTop: 4,
  },
  statusText: { fontSize: 10, fontWeight: "800" },

  budgetRow: { flexDirection: "row", justifyContent: "space-between" },
  budgetText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  cpcText: { fontSize: 12, color: colors.textMuted, fontWeight: "700" },
  progressTrack: {
    height: 6, backgroundColor: colors.surface,
    borderRadius: 999, overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 999 },

  metricsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metricChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: colors.surface, borderRadius: 999,
  },
  metricText: { color: colors.text, fontSize: 11, fontWeight: "700" },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },

  fab: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  fabBtn: {
    backgroundColor: colors.primary, height: 52, borderRadius: 999,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, gap: 10, maxHeight: "92%",
  },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },

  label: {
    fontWeight: "800", color: colors.text, fontSize: 12,
    textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4,
  },

  pickCard: {
    width: 120, padding: 8, gap: 4,
    backgroundColor: "#fff", borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border,
  },
  pickCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pickImage: { width: "100%", height: 80, borderRadius: radius.sm },
  pickName: { fontSize: 11, color: colors.text, fontWeight: "700" },
  pickPrice: { fontSize: 11, color: colors.text, fontWeight: "800" },

  row: { flexDirection: "row", gap: 12 },
  input: {
    backgroundColor: "#fff", borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16, color: colors.text, fontWeight: "700",
  },

  hintBox: {
    flexDirection: "row", gap: 6, alignItems: "flex-start",
    padding: 10, backgroundColor: "#FEF3C7", borderRadius: radius.md,
    borderWidth: 1, borderColor: "#FCD34D",
  },
  hintText: { flex: 1, color: "#92400E", fontSize: 11, lineHeight: 15 },

  primaryBtn: {
    backgroundColor: colors.primary, padding: 14, borderRadius: radius.md,
    alignItems: "center", marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
