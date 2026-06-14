import { useFocusEffect, useRouter } from "expo-router";
import { BarChart3, CheckCircle2, ChevronLeft, ClipboardList, Package, Pencil, Plus, RefreshCcw, Settings, Store, Tag, Trash2, Upload, Wallet, Zap } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { SellerStatusBanner } from "@/src/components/SellerStatusBanner";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type SellerProfile = {
  company_name: string;
  gstin: string;
  verification_status: string;
  city: string;
  state: string;
};

type Listing = {
  id: string;
  name: string;
  image: string;
  price_nzd: number;
  category: string;
};

export default function SellerDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        api<SellerProfile>("/seller/me").catch(() => null),
        api<Listing[]>("/seller/products").catch(() => []),
      ]);
      setProfile(p);
      setListings(l || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const remove = async (id: string) => {
    try {
      await api(`/seller/products/${id}`, { method: "DELETE" });
      setListings((cur) => cur.filter((it) => it.id !== id));
    } catch {
      // ignored
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="seller-dashboard-back" onPress={() => router.replace("/(tabs)/account")} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Seller dashboard</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !user?.is_seller || !profile ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Seller profile not found.</Text>
          <Pressable testID="seller-dashboard-onboard-btn" onPress={() => router.push("/seller/welcome")} style={styles.cta}>
            <Text style={styles.ctaText}>Start seller onboarding</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 140, gap: 12 }}
          ListHeaderComponent={
            <View>
              <View style={styles.headerCard}>
                <View style={styles.iconCircle}>
                  <Store size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.company} testID="seller-company-name">{profile.company_name}</Text>
                  <Text style={styles.companyMeta}>
                    {profile.city}, {profile.state} · GSTIN {profile.gstin}
                  </Text>
                </View>
              </View>

              <View style={{ marginBottom: spacing.md }}>
                <SellerStatusBanner />
              </View>

              <View style={styles.quickActions}>
                <Pressable
                  testID="seller-orders-link"
                  onPress={() => router.push("/seller/orders")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <Package size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Orders</Text>
                  <Text style={styles.quickSubtitle}>Buyer purchases of your listings</Text>
                </Pressable>
                <Pressable
                  testID="seller-payouts-link"
                  onPress={() => router.push("/seller/payouts")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <Wallet size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Payouts</Text>
                  <Text style={styles.quickSubtitle}>Earnings after 15% platform fee</Text>
                </Pressable>
                <Pressable
                  testID="seller-returns-link"
                  onPress={() => router.push("/seller/returns")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <RefreshCcw size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Returns</Text>
                  <Text style={styles.quickSubtitle}>Approve or decline buyer returns</Text>
                </Pressable>
              </View>

              <View style={[styles.quickActions, { marginTop: 10 }]}>
                <Pressable
                  testID="seller-analytics-link"
                  onPress={() => router.push("/seller/analytics")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <BarChart3 size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Analytics</Text>
                  <Text style={styles.quickSubtitle}>Views, carts, sold & conversion</Text>
                </Pressable>
                <Pressable
                  testID="seller-bulk-edit-link"
                  onPress={() => router.push("/seller/bulk-edit")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <ClipboardList size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Bulk edit</Text>
                  <Text style={styles.quickSubtitle}>Update price / stock in one go</Text>
                </Pressable>
                <Pressable
                  testID="seller-bulk-upload-link"
                  onPress={() => router.push("/seller/bulk-upload")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <Upload size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Bulk upload</Text>
                  <Text style={styles.quickSubtitle}>Add many listings via CSV / Excel</Text>
                </Pressable>
                <Pressable
                  testID="seller-coupons-link"
                  onPress={() => router.push("/seller/coupons")}
                  style={({ pressed }) => [styles.quickCard, pressed && { opacity: 0.85 }]}
                >
                  <View style={styles.quickIcon}>
                    <Tag size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.quickTitle}>Coupons</Text>
                  <Text style={styles.quickSubtitle}>Promo codes & flash deals</Text>
                </Pressable>
              </View>

              <View style={styles.listingsHeader}>
                <Text style={styles.sectionTitle}>My listings ({listings.length})</Text>
              </View>

              {listings.length === 0 ? (
                <View style={styles.emptyList}>
                  <Text style={styles.emptyTitle}>No listings yet</Text>
                  <Text style={styles.emptyBody}>
                    Add your first product — shoppers in NZ will see it on the Allsale home feed.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row} testID={`listing-row-${item.id}`}>
              <Image source={{ uri: item.image }} style={styles.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemCategory}>{item.category.toUpperCase()}</Text>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemPrice}>{formatNZD(item.price_nzd)}</Text>
              </View>
              <Pressable
                testID={`listing-edit-${item.id}`}
                onPress={() => router.push(`/seller/edit-listing/${item.id}`)}
                style={styles.editBtn}
              >
                <Pencil size={16} color={colors.primary} />
              </Pressable>
              <Pressable
                testID={`listing-delete-${item.id}`}
                onPress={() => remove(item.id)}
                style={styles.deleteBtn}
              >
                <Trash2 size={16} color={colors.error} />
              </Pressable>
            </View>
          )}
        />
      )}

      {profile ? (
        <SafeAreaView edges={["bottom"]} style={styles.fab}>
          <Pressable
            testID="seller-add-listing-btn"
            onPress={() => router.push("/seller/new-listing")}
            style={({ pressed }) => [styles.fabBtn, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            <Plus size={18} color="#fff" />
            <Text style={styles.fabText}>Add listing</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  muted: { color: colors.textMuted },
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  company: { fontSize: 16, fontWeight: "800", color: colors.text },
  companyMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  verifiedBanner: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.md,
    backgroundColor: colors.successSoft,
    borderRadius: radius.lg,
  },
  verifiedText: { color: colors.success, fontSize: 13, fontWeight: "700", flex: 1 },
  quickActions: { flexDirection: "row", gap: 10, marginTop: spacing.md },
  quickCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 6,
  },
  quickIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  quickTitle: { fontSize: 14, fontWeight: "800", color: colors.text },
  quickSubtitle: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  listingsHeader: { marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  emptyList: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
  },
  emptyTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  emptyBody: { fontSize: 12, color: colors.textMuted, marginTop: 6, textAlign: "center", lineHeight: 18 },
  row: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surface },
  itemCategory: { fontSize: 10, color: colors.primary, fontWeight: "800", letterSpacing: 1 },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 2, lineHeight: 18 },
  itemPrice: { fontSize: 14, fontWeight: "800", color: colors.text, marginTop: 4 },
  deleteBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  editBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  fab: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  fabBtn: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cta: {
    backgroundColor: colors.primary,
    height: 48,
    paddingHorizontal: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  fab: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  fabBtn: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
