import { useFocusEffect, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Check, ChevronLeft, Film, Play, RefreshCcw, X } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  photos?: string[];
  refund_amount_nzd: number;
  restocking_fee_nzd: number;
  buyer_pays_shipping: boolean;
  created_at: string;
  videos?: string[];
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
  const [pending, setPending] = useState<{ rtn: Return; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");

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

  const confirmDecision = useCallback(async () => {
    if (!pending) return;
    const { rtn, action } = pending;
    setBusyId(rtn.id);
    try {
      const updated = await api<Return>(`/returns/${rtn.id}/${action}`, {
        method: "POST",
        body: { note: note.trim() || undefined },
      });
      setReturns((prev) => prev.map((r) => (r.id === rtn.id ? updated : r)));
      setPending(null);
      setNote("");
      Alert.alert(
        action === "approve" ? "Return approved" : "Return declined",
        action === "approve"
          ? `A refund of ${formatNZD(updated.refund_amount_nzd)} has been initiated to the buyer.`
          : "The buyer has been notified.",
      );
    } catch (e: any) {
      Alert.alert("Couldn't update", e?.message || "Please try again.");
    } finally {
      setBusyId(null);
    }
  }, [pending, note]);

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

                {(item.photos && item.photos.length > 0) || (item.videos && item.videos.length > 0) ? (
                  <View style={styles.proofWrap}>
                    <Text style={styles.proofLabel}>Buyer&apos;s proof</Text>
                    <View style={styles.proofRow}>
                      {(item.photos || []).map((url, idx) => (
                        <Pressable
                          key={url + idx}
                          testID={`seller-rtn-proof-${item.id}-${idx}`}
                          onPress={() => Linking.openURL(url)}
                          style={styles.proofTile}
                        >
                          <Image source={{ uri: url }} style={styles.proofImg} />
                        </Pressable>
                      ))}
                      {(item.videos || []).map((url, idx) => (
                        <Pressable
                          key={"v" + url + idx}
                          testID={`seller-rtn-video-${item.id}-${idx}`}
                          onPress={() => Linking.openURL(url)}
                          style={[styles.proofTile, styles.proofTileVideo]}
                        >
                          <Film size={18} color="#fff" />
                          <View style={styles.playBadge}>
                            <Play size={10} color="#fff" />
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}

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
                      onPress={() => {
                        setNote("");
                        setPending({ rtn: item, action: "reject" });
                      }}
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
                      onPress={() => {
                        setNote("");
                        setPending({ rtn: item, action: "approve" });
                      }}
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

      <Modal
        visible={pending !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPending(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalRoot}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setPending(null)} />
          <View style={styles.modalCard} testID="seller-rtn-modal">
            <Text style={styles.modalTitle}>
              {pending?.action === "approve" ? "Approve return?" : "Decline return?"}
            </Text>
            <Text style={styles.modalBody}>
              {pending?.action === "approve"
                ? `A refund of ${formatNZD(pending?.rtn.refund_amount_nzd || 0)} will be initiated to the buyer in NZD. They'll receive an in-app notification immediately.`
                : "The buyer will be notified your decision. Provide a brief reason so they understand."}
            </Text>
            <Text style={styles.modalLabel}>
              {pending?.action === "approve" ? "Note (optional)" : "Reason for declining"}
            </Text>
            <TextInput
              testID="seller-rtn-modal-note"
              value={note}
              onChangeText={setNote}
              placeholder={
                pending?.action === "approve"
                  ? "Anything to add for the buyer..."
                  : "Item is in non-returnable condition..."
              }
              placeholderTextColor={colors.textFaint}
              maxLength={300}
              multiline
              style={styles.modalInput}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
              <Pressable
                testID="seller-rtn-modal-cancel"
                onPress={() => setPending(null)}
                style={({ pressed }) => [styles.modalSecondary, pressed && { opacity: 0.85 }]}
                disabled={busyId !== null}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="seller-rtn-modal-confirm"
                onPress={confirmDecision}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  pending?.action === "reject" && { backgroundColor: colors.error },
                  pressed && { opacity: 0.9 },
                  busyId !== null && { opacity: 0.7 },
                ]}
                disabled={busyId !== null}
              >
                {busyId === pending?.rtn.id ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>
                    {pending?.action === "approve" ? "Approve & refund" : "Decline"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  proofWrap: { marginTop: spacing.sm },
  proofLabel: { fontSize: 11, fontWeight: "800", color: colors.text, letterSpacing: 0.5, marginBottom: 6, textTransform: "uppercase" },
  proofRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  proofTile: { width: 64, height: 64, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  proofImg: { width: "100%", height: "100%" },
  proofTileVideo: { backgroundColor: "#111827", alignItems: "center", justifyContent: "center" },
  playBadge: { position: "absolute", width: 22, height: 22, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
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
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  modalBody: { fontSize: 13, color: colors.textMuted, marginTop: 6, lineHeight: 19 },
  modalLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    marginTop: spacing.md,
    letterSpacing: 0.8,
  },
  modalInput: {
    marginTop: 6,
    minHeight: 70,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    color: colors.text,
    textAlignVertical: "top",
  },
  modalSecondary: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSecondaryText: { color: colors.text, fontWeight: "700" },
  modalPrimary: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPrimaryText: { color: "#fff", fontWeight: "800" },
});
