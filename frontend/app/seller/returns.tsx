import { useFocusEffect, useRouter } from "expo-router";
import { Check, ChevronLeft, RefreshCcw, X } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type ReturnItem = {
  product_id: string;
  name: string;
  image: string;
  price_nzd: number;
  quantity: number;
};

type Return = {
  id: string;
  order_id: string;
  user_id: string;
  reason: string;
  note?: string | null;
  status: string;
  items: ReturnItem[];
  refund_amount_nzd: number;
  restocking_fee_nzd: number;
  buyer_pays_shipping: boolean;
  created_at: string;
};

const REASON_LABEL: Record<string, string> = {
  damaged_on_arrival: "Damaged on arrival",
  wrong_item: "Wrong item received",
  not_as_described: "Not as described",
  defective: "Defective / not working",
  changed_my_mind: "Changed mind",
};

export default function SellerReturnsScreen() {
  const router = useRouter();
  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<Return[]>("/seller/returns");
      setReturns(res || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const decide = useCallback(
    async (id: string, approve: boolean) => {
      setBusyId(id);
      try {
        const updated = await api<Return>(`/returns/${id}/${approve ? "approve" : "reject"}`, {
          method: "POST",
          body: {},
        });
        setReturns((prev) => prev.map((r) => (r.id === id ? updated : r)));
        Alert.alert(
          approve ? "Return approved" : "Return declined",
          approve
            ? `A refund of ${formatNZD(updated.refund_amount_nzd)} has been initiated to the buyer.`
            : "The buyer has been notified.",
        );
      } catch (e: any) {
        Alert.alert("Couldn't update", e?.message || "Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    []
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="seller-returns-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Return requests</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : returns.length === 0 ? (
        <View style={styles.center}>
          <RefreshCcw size={36} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>No return requests yet</Text>
          <Text style={styles.emptySub}>
            Buyers can request a return within 7 days of delivery.
          </Text>
        </View>
      ) : (
        <FlatList
          data={returns}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => {
            const isPending = item.status === "pending_seller";
            return (
              <View style={styles.card} testID={`seller-rtn-${item.id}`}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardOrder}>
                    Order #{item.order_id.replace("order_", "").slice(0, 8).toUpperCase()}
                  </Text>
                  <View style={[styles.pill, pillStyle(item.status)]}>
                    <Text style={styles.pillText}>{prettyStatus(item.status)}</Text>
                  </View>
                </View>
                <Text style={styles.reason}>{REASON_LABEL[item.reason] || item.reason}</Text>
                {item.note ? <Text style={styles.note}>“{item.note}”</Text> : null}

                <View style={styles.itemsRow}>
                  {item.items.map((it) => (
                    <View key={it.product_id} style={styles.itemMini}>
                      <Image source={{ uri: it.image }} style={styles.itemImg} />
                      <Text numberOfLines={1} style={styles.itemName}>
                        {it.name}
                      </Text>
                      <Text style={styles.itemQty}>Qty {it.quantity}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.summary}>
                  <Text style={styles.summaryRow}>
                    Refund amount:{" "}
                    <Text style={styles.summaryBold}>{formatNZD(item.refund_amount_nzd)}</Text>
                  </Text>
                  {item.restocking_fee_nzd > 0 ? (
                    <Text style={styles.summaryRow}>
                      Restocking fee (15%):{" "}
                      <Text style={styles.summaryBold}>{formatNZD(item.restocking_fee_nzd)}</Text>
                    </Text>
                  ) : null}
                  <Text style={styles.summaryRow}>
                    Return shipping:{" "}
                    <Text style={styles.summaryBold}>
                      {item.buyer_pays_shipping ? "Buyer pays" : "You pay (prepaid label)"}
                    </Text>
                  </Text>
                </View>

                {isPending ? (
                  <View style={styles.actions}>
                    <Pressable
                      testID={`seller-rtn-reject-${item.id}`}
                      disabled={busyId === item.id}
                      onPress={() =>
                        Alert.alert("Decline return?", "The buyer will be notified.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Decline", style: "destructive", onPress: () => decide(item.id, false) },
                        ])
                      }
                      style={({ pressed }) => [
                        styles.btnSecondary,
                        pressed && { opacity: 0.85 },
                        busyId === item.id && { opacity: 0.5 },
                      ]}
                    >
                      <X size={16} color={colors.error} />
                      <Text style={styles.btnSecondaryText}>Decline</Text>
                    </Pressable>
                    <Pressable
                      testID={`seller-rtn-approve-${item.id}`}
                      disabled={busyId === item.id}
                      onPress={() =>
                        Alert.alert(
                          "Approve return?",
                          `A refund of ${formatNZD(item.refund_amount_nzd)} will be initiated to the buyer.`,
                          [
                            { text: "Cancel", style: "cancel" },
                            { text: "Approve", onPress: () => decide(item.id, true) },
                          ]
                        )
                      }
                      style={({ pressed }) => [
                        styles.btnPrimary,
                        pressed && { opacity: 0.9 },
                        busyId === item.id && { opacity: 0.5 },
                      ]}
                    >
                      {busyId === item.id ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Check size={16} color="#fff" />
                          <Text style={styles.btnPrimaryText}>Approve & refund</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function prettyStatus(s: string) {
  switch (s) {
    case "pending_seller":
      return "Action needed";
    case "approved":
      return "Approved";
    case "refunded":
      return "Refunded";
    case "rejected":
      return "Declined";
    default:
      return s;
  }
}

function pillStyle(s: string) {
  switch (s) {
    case "pending_seller":
      return { backgroundColor: "#FEF3C7" };
    case "approved":
    case "refunded":
      return { backgroundColor: colors.successSoft };
    case "rejected":
      return { backgroundColor: "#FEE2E2" };
    default:
      return { backgroundColor: colors.surface };
  }
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 8 },
  emptySub: { fontSize: 13, color: colors.textMuted, textAlign: "center", maxWidth: 280 },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardOrder: { fontSize: 13, fontWeight: "800", color: colors.text },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  pillText: { fontSize: 10, fontWeight: "800", color: colors.text, letterSpacing: 0.3 },
  reason: { fontSize: 14, fontWeight: "600", color: colors.text },
  note: { fontSize: 12, color: colors.textMuted, fontStyle: "italic" },
  itemsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  itemMini: {
    width: 90,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 6,
  },
  itemImg: { width: 78, height: 60, borderRadius: radius.sm, backgroundColor: "#fff" },
  itemName: { fontSize: 11, color: colors.text, marginTop: 4 },
  itemQty: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  summary: {
    marginTop: 4,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: 4,
  },
  summaryRow: { fontSize: 12, color: colors.textMuted },
  summaryBold: { color: colors.text, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  btnSecondary: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  btnSecondaryText: { color: colors.error, fontWeight: "800", fontSize: 13 },
  btnPrimary: {
    flex: 1.5,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});
