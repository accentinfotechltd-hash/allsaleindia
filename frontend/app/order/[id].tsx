import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { ChevronLeft, ExternalLink, MapPin, Package, RefreshCcw, ShieldCheck, Truck, XCircle } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
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

import { api } from "@/src/lib/api";
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Order = {
  id: string;
  items: { product_id: string; name: string; image: string; price_nzd: number; quantity: number }[];
  subtotal_nzd: number;
  shipping_nzd: number;
  total_nzd: number;
  address: {
    full_name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postcode: string;
    country: string;
    phone: string;
  };
  status: string;
  payment_status: string;
  created_at: string;
  estimated_delivery: string;
  cancellable_until?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  refund_id?: string | null;
  refund_amount_nzd?: number | null;
  awb_code?: string | null;
  tracking_status?: string | null;
};

type Shipment = {
  id: string;
  order_id: string;
  carrier: string;
  awb_code: string;
  tracking_url: string;
  status: string;
  estimated_delivery: string;
  is_mocked: boolean;
};

type ReturnRequest = {
  id: string;
  order_id: string;
  reason: string;
  status: string; // pending_seller | approved | rejected | refunded
  refund_amount_nzd: number;
  restocking_fee_nzd: number;
  buyer_pays_shipping: boolean;
  decision_note?: string | null;
  created_at: string;
};

const TIMELINE = [
  { key: "paid", label: "Order confirmed" },
  { key: "shipped", label: "Shipped from India" },
  { key: "out_for_delivery", label: "Out for delivery in NZ" },
  { key: "delivered", label: "Delivered" },
];

function useCountdown(targetIso?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (!targetIso) return { ms: 0, label: "" };
  const target = new Date(targetIso).getTime();
  const ms = Math.max(0, target - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { ms, label: `${pad(h)}:${pad(m)}:${pad(s)}` };
}

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [o, shp, rts] = await Promise.all([
        api<Order>(`/orders/${id}`),
        api<Shipment | null>(`/orders/${id}/shipment`).catch(() => null),
        api<ReturnRequest[]>(`/returns/order/${id}`).catch(() => [] as ReturnRequest[]),
      ]);
      if (mounted.current) {
        setOrder(o);
        setShipment(shp);
        setReturns(rts || []);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const { ms: msLeft, label: countdown } = useCountdown(order?.cancellable_until);

  const canCancel = useMemo(() => {
    if (!order) return false;
    if (["cancelled", "refunded", "shipped", "out_for_delivery", "delivered"].includes(order.status)) {
      return false;
    }
    if (order.payment_status !== "paid") return false;
    if (!order.cancellable_until) return false;
    return msLeft > 0;
  }, [order, msLeft]);

  const onCancel = useCallback(async () => {
    if (!order) return;
    setCancelling(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/cancel`, {
        method: "POST",
        body: { reason: reason.trim() || undefined },
      });
      if (mounted.current) {
        setOrder(updated);
        setShowCancel(false);
        setReason("");
      }
      Alert.alert(
        "Order cancelled",
        updated.refund_id
          ? `Your refund of ${formatNZD(updated.refund_amount_nzd || 0)} is on the way. It typically appears within 5–10 business days.`
          : "Your cancellation has been received. Your refund will be processed shortly.",
      );
    } catch (e: any) {
      Alert.alert("Couldn't cancel", e?.message || "Please try again.");
    } finally {
      if (mounted.current) setCancelling(false);
    }
  }, [order, reason]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={{ color: colors.textMuted }}>Order not found.</Text>
      </SafeAreaView>
    );
  }

  const orderStages = ["paid", "shipped", "out_for_delivery", "delivered"];
  const currentIdx = orderStages.indexOf(order.status);
  const isCancelled = order.status === "cancelled" || order.status === "refunded";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="order-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Order details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerCard}>
          <View style={styles.iconCircle}>
            <Package size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderNum}>
              Order #{order.id.replace("order_", "").slice(0, 8).toUpperCase()}
            </Text>
            <Text style={styles.orderDate}>
              {new Date(order.created_at).toLocaleString("en-NZ", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </Text>
          </View>
        </View>

        {isCancelled ? (
          <View style={styles.cancelledBanner}>
            <XCircle size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cancelledTitle}>Order cancelled</Text>
              <Text style={styles.cancelledBody}>
                {order.refund_id
                  ? `Refund of ${formatNZD(order.refund_amount_nzd || order.total_nzd)} is being processed to your card (5–10 business days).`
                  : `Refund of ${formatNZD(order.refund_amount_nzd || order.total_nzd)} is being processed and will appear on your card within 5–10 business days.`}
              </Text>
              {order.cancel_reason ? (
                <Text style={styles.cancelledReason}>Reason: {order.cancel_reason}</Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.deliveryBanner}>
            <Text style={styles.deliveryLabel}>Estimated arrival</Text>
            <Text style={styles.deliveryDate}>{order.estimated_delivery}</Text>
          </View>
        )}

        {canCancel ? (
          <View style={styles.cancelWindowCard} testID="order-cancel-window">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={16} color={colors.success} />
              <Text style={styles.cancelWindowTitle}>Free cancellation available</Text>
            </View>
            <Text style={styles.cancelWindowBody}>
              You can cancel this order for a full refund within the next{" "}
              <Text style={styles.cancelCountdown}>{countdown}</Text>.
            </Text>
            <Pressable
              testID="order-cancel-btn"
              onPress={() => setShowCancel(true)}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
            >
              <XCircle size={16} color={colors.error} />
              <Text style={styles.cancelBtnText}>Cancel this order</Text>
            </Pressable>
          </View>
        ) : null}

        {returns.length > 0 ? (
          <View style={styles.returnsCard} testID="order-returns-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <RefreshCcw size={16} color={colors.primary} />
              <Text style={styles.returnsTitle}>Return request</Text>
              <View style={[styles.statusPill, statusPillStyle(returns[0].status)]}>
                <Text style={styles.statusPillText}>{formatReturnStatus(returns[0].status)}</Text>
              </View>
            </View>
            <Text style={styles.returnsBody}>
              {returns[0].status === "pending_seller"
                ? `Awaiting seller — refund of ${formatNZD(returns[0].refund_amount_nzd)} pending approval.`
                : returns[0].status === "approved"
                  ? `Approved — refund of ${formatNZD(returns[0].refund_amount_nzd)} being processed.`
                  : returns[0].status === "refunded"
                    ? `Refunded ${formatNZD(returns[0].refund_amount_nzd)} to your card.`
                    : `Declined: ${returns[0].decision_note || "Please contact support if you disagree."}`}
            </Text>
            {returns[0].restocking_fee_nzd > 0 ? (
              <Text style={styles.returnsMeta}>
                Restocking fee (15%): {formatNZD(returns[0].restocking_fee_nzd)}
              </Text>
            ) : null}
          </View>
        ) : order.status === "delivered" && !isCancelled ? (
          <View style={styles.returnPromptCard} testID="order-return-prompt">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <RefreshCcw size={16} color={colors.text} />
              <Text style={styles.returnPromptTitle}>Need to return something?</Text>
            </View>
            <Text style={styles.returnPromptBody}>
              You have 7 days from delivery to request a return.
            </Text>
            <Pressable
              testID="order-request-return-btn"
              onPress={() => router.push(`/order/${order.id}/return`)}
              style={({ pressed }) => [styles.returnBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.returnBtnText}>Request return</Text>
            </Pressable>
          </View>
        ) : null}

        {!isCancelled ? (
          <>
            <Text style={styles.sectionTitle}>Tracking</Text>
            {shipment ? (
              <Pressable
                testID="order-tracking-card"
                onPress={() =>
                  shipment.tracking_url ? Linking.openURL(shipment.tracking_url) : null
                }
                style={({ pressed }) => [styles.trackingCard, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.trackingTopRow}>
                  <View style={styles.trackingIcon}>
                    <Truck size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackingCarrier}>
                      {shipment.carrier.replace(" (mock)", "")} · India → NZ
                    </Text>
                    <Text style={styles.trackingAwb}>
                      AWB <Text style={styles.trackingAwbCode}>{shipment.awb_code}</Text>
                    </Text>
                  </View>
                  <ExternalLink size={14} color={colors.textMuted} />
                </View>
                {order.tracking_status ? (
                  <Text style={styles.trackingLatest} numberOfLines={1}>
                    {order.tracking_status}
                  </Text>
                ) : null}
                <Text style={styles.trackingTap}>Tap to open live tracking</Text>
              </Pressable>
            ) : order.payment_status === "paid" ? (
              <View style={styles.trackingCard} testID="order-tracking-card">
                <Text style={styles.trackingCarrier}>Shiprocket X · India → NZ</Text>
                <Text style={styles.trackingAwb}>
                  AWB pending · check back once shipment is dispatched
                </Text>
              </View>
            ) : null}
            <View style={styles.timeline}>
              {TIMELINE.map((t, i) => {
                const done = i <= currentIdx;
                return (
                  <View key={t.key} style={styles.timelineRow}>
                    <View style={[styles.dot, done && styles.dotDone]} />
                    <Text style={[styles.timelineLabel, done && styles.timelineLabelDone]}>
                      {t.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Items</Text>
        {order.items.map((it) => (
          <View key={it.product_id} style={styles.itemRow}>
            <Image source={{ uri: it.image }} style={styles.itemImg} />
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName} numberOfLines={2}>
                {it.name}
              </Text>
              <Text style={styles.itemMeta}>Qty {it.quantity}</Text>
            </View>
            <Text style={styles.itemPrice}>{formatNZD(it.price_nzd * it.quantity)}</Text>
          </View>
        ))}

        <Text style={styles.sectionTitle}>Shipping address</Text>
        <View style={styles.addressCard}>
          <MapPin size={16} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.addressName}>{order.address.full_name}</Text>
            <Text style={styles.addressLine}>
              {order.address.line1}
              {order.address.line2 ? `, ${order.address.line2}` : ""}
            </Text>
            <Text style={styles.addressLine}>
              {order.address.city}, {order.address.region} {order.address.postcode}
            </Text>
            <Text style={styles.addressLine}>{order.address.country}</Text>
            <Text style={styles.addressPhone}>{order.address.phone}</Text>
          </View>
        </View>

        <View style={styles.totals}>
          <Line label="Subtotal" value={formatNZD(order.subtotal_nzd)} />
          <Line
            label="Shipping"
            value={order.shipping_nzd === 0 ? "FREE" : formatNZD(order.shipping_nzd)}
            highlight={order.shipping_nzd === 0}
          />
          <View style={styles.divider} />
          <Line label="Total (NZD)" value={formatNZD(order.total_nzd)} bold />
        </View>

        <Pressable
          testID="order-cancel-policy-link"
          onPress={() => router.push("/help/cancellation-policy")}
          style={{ marginTop: spacing.md, alignSelf: "center" }}
        >
          <Text style={styles.policyLink}>Read cancellation & return policies</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={showCancel}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCancel(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalRoot}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCancel(false)} />
          <View style={styles.modalCard} testID="order-cancel-modal">
            <Text style={styles.modalTitle}>Cancel this order?</Text>
            <Text style={styles.modalBody}>
              You&apos;ll receive a full refund of {formatNZD(order.total_nzd)} to your card. We&apos;ll
              notify the seller and Allsale support straight away.
            </Text>
            <Text style={styles.modalLabel}>Reason (optional)</Text>
            <TextInput
              testID="order-cancel-reason-input"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Ordered by mistake"
              placeholderTextColor={colors.textFaint}
              maxLength={300}
              multiline
              style={styles.modalInput}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
              <Pressable
                testID="order-cancel-modal-keep"
                onPress={() => setShowCancel(false)}
                style={({ pressed }) => [styles.modalSecondary, pressed && { opacity: 0.85 }]}
                disabled={cancelling}
              >
                <Text style={styles.modalSecondaryText}>Keep order</Text>
              </Pressable>
              <Pressable
                testID="order-cancel-modal-confirm"
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  pressed && { opacity: 0.9 },
                  cancelling && { opacity: 0.7 },
                ]}
                disabled={cancelling}
              >
                {cancelling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Confirm cancel</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function Line({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineBold]}>{label}</Text>
      <Text
        style={[
          styles.lineValue,
          bold && styles.lineBold,
          highlight && { color: colors.success, fontWeight: "800" },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function formatReturnStatus(s: string): string {
  switch (s) {
    case "pending_seller":
      return "Awaiting seller";
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

function statusPillStyle(s: string) {
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
  center: { alignItems: "center", justifyContent: "center" },
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
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  orderNum: { fontSize: 14, fontWeight: "800", color: colors.text },
  orderDate: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  deliveryBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
  },
  deliveryLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  deliveryDate: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 4, letterSpacing: -0.3 },
  cancelledBanner: {
    flexDirection: "row",
    gap: 12,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  cancelledTitle: { fontSize: 14, fontWeight: "800", color: colors.error },
  cancelledBody: { fontSize: 12, color: "#7F1D1D", marginTop: 4, lineHeight: 17 },
  cancelledReason: { fontSize: 11, color: "#7F1D1D", marginTop: 6, fontStyle: "italic" },
  cancelWindowCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.successSoft,
    backgroundColor: colors.successSoft,
  },
  cancelWindowTitle: { fontSize: 13, fontWeight: "800", color: colors.text },
  cancelWindowBody: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 17 },
  cancelCountdown: { fontWeight: "800", color: colors.text, fontVariant: ["tabular-nums"] },
  cancelBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: "#fff",
  },
  cancelBtnText: { color: colors.error, fontWeight: "800", fontSize: 13 },
  returnsCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  returnsTitle: { fontSize: 13, fontWeight: "800", color: colors.text, flex: 1 },
  returnsBody: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  returnsMeta: { fontSize: 11, color: colors.textFaint, fontStyle: "italic" },
  returnPromptCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 6,
  },
  returnPromptTitle: { fontSize: 13, fontWeight: "800", color: colors.text },
  returnPromptBody: { fontSize: 12, color: colors.textMuted },
  returnBtn: {
    marginTop: spacing.sm,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.text,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  returnBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusPillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3, color: colors.text },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.text, marginTop: spacing.lg, marginBottom: 8 },
  timeline: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, gap: 12 },
  trackingCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    marginBottom: spacing.sm,
    gap: 8,
  },
  trackingTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  trackingIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  trackingCarrier: { fontSize: 13, fontWeight: "800", color: colors.text },
  trackingAwb: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  trackingAwbCode: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: colors.text,
    fontWeight: "700",
  },
  trackingLatest: {
    fontSize: 12,
    color: colors.text,
    fontWeight: "600",
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },
  trackingTap: { fontSize: 11, color: colors.primary, fontWeight: "700" },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 999, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.primary },
  timelineLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  timelineLabelDone: { color: colors.text },
  itemRow: { flexDirection: "row", gap: 12, paddingVertical: spacing.sm, alignItems: "center" },
  itemImg: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surface },
  itemName: { fontSize: 14, fontWeight: "600", color: colors.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: "800", color: colors.text },
  addressCard: {
    flexDirection: "row",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  addressName: { fontSize: 14, fontWeight: "800", color: colors.text },
  addressLine: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  addressPhone: { fontSize: 13, color: colors.text, marginTop: 4 },
  totals: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  lineLabel: { fontSize: 13, color: colors.textMuted },
  lineValue: { fontSize: 13, color: colors.text, fontWeight: "600" },
  lineBold: { fontSize: 16, fontWeight: "800", color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  policyLink: { color: colors.primary, fontWeight: "700", fontSize: 12 },
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
  modalLabel: { fontSize: 11, fontWeight: "800", color: colors.textMuted, marginTop: spacing.md, letterSpacing: 0.8 },
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
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPrimaryText: { color: "#fff", fontWeight: "800" },
});
