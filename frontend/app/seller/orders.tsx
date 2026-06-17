import { useFocusEffect, useRouter } from "expo-router";
import { useToast } from "@/src/components/UiOverlayProvider";
import { ChevronLeft, Download, MapPin, Package } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type SellerOrder = {
  order_id: string;
  buyer_name: string;
  buyer_city: string;
  buyer_region: string;
  items: { product_id: string; name: string; image: string; price_nzd: number; quantity: number }[];
  seller_subtotal_nzd: number;
  status: string;
  created_at: string;
  estimated_delivery: string;
};

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending: { bg: "#FEF3C7", text: "#92400E" },
  paid: { bg: "#DBEAFE", text: "#1E40AF" },
  shipped: { bg: "#E0E7FF", text: "#3730A3" },
  delivered: { bg: "#D1FAE5", text: "#065F46" },
  cancelled: { bg: "#FEE2E2", text: "#991B1B" },
};

export default function SellerOrders() {
  const toast = useToast();
  const router = useRouter();
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await api<SellerOrder[]>("/seller/orders");
      setOrders(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const downloadCsv = useCallback(async () => {
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL as string;
      const token = await storage.secureGet<string>("allsale_token", "");
      const url = `${base}/api/seller/orders.csv`;
      if (Platform.OS === "web") {
        // Web: fetch with auth, blob it, click an anchor.
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = (globalThis as any).document?.createElement("a");
        if (a) {
          a.href = href;
          a.download = `allsale-orders-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(href), 1000);
        }
        return;
      }
      // Native: fetch CSV string, write to cache, then open share sheet.
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const FileSystem = await import("expo-file-system/legacy");
      const Sharing = await import("expo-sharing");
      const path = `${FileSystem.cacheDirectory}allsale-orders-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Save orders CSV" });
      } else {
        await Linking.openURL(path);
      }
    } catch (e: any) {
      toast.show({ title: "Couldn't download", body: e?.message || "Please try again.", kind: "error" });
    }
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="seller-orders-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Orders</Text>
        <Pressable
          testID="seller-orders-csv-btn"
          onPress={downloadCsv}
          style={styles.csvBtn}
          hitSlop={10}
        >
          <Download size={18} color={colors.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : orders.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Package size={28} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>No orders yet</Text>
          <Text style={styles.emptyText}>When buyers purchase your listings, they&apos;ll appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.order_id}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: 12 }}
          renderItem={({ item }) => {
            const tone = STATUS_COLOR[item.status] || STATUS_COLOR.pending;
            const date = new Date(item.created_at);
            return (
              <View style={styles.row} testID={`seller-order-row-${item.order_id}`}>
                <View style={styles.rowHead}>
                  <Text style={styles.orderId}>#{item.order_id.replace("order_", "").slice(0, 8).toUpperCase()}</Text>
                  <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.statusText, { color: tone.text }]}>{item.status.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.orderDate}>
                  {date.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                </Text>

                <View style={styles.buyer}>
                  <MapPin size={12} color={colors.textMuted} />
                  <Text style={styles.buyerText}>
                    {item.buyer_name} · {item.buyer_city}{item.buyer_region ? `, ${item.buyer_region}` : ""}
                  </Text>
                </View>

                {item.items.map((it) => (
                  <View key={it.product_id} style={styles.itemRow}>
                    <Image source={{ uri: it.image }} style={styles.itemImg} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName} numberOfLines={2}>{it.name}</Text>
                      <Text style={styles.itemMeta}>Qty {it.quantity}</Text>
                    </View>
                    <Text style={styles.itemPrice}>{formatNZD(it.price_nzd * it.quantity)}</Text>
                  </View>
                ))}

                <View style={styles.rowFoot}>
                  <Text style={styles.deliveryText}>Est. delivery: {item.estimated_delivery}</Text>
                  <Text style={styles.totalText}>{formatNZD(item.seller_subtotal_nzd)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
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
  csvBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  emptyText: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: "center" },
  row: {
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  orderId: { fontSize: 13, fontWeight: "800", color: colors.text, letterSpacing: 0.5 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  orderDate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  buyer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  buyerText: { fontSize: 12, color: colors.textMuted },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: spacing.sm,
  },
  itemImg: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface },
  itemName: { fontSize: 13, fontWeight: "600", color: colors.text, lineHeight: 17 },
  itemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  itemPrice: { fontSize: 13, fontWeight: "800", color: colors.text },
  rowFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deliveryText: { fontSize: 12, color: colors.textMuted, flex: 1 },
  totalText: { fontSize: 16, fontWeight: "800", color: colors.text },
});
