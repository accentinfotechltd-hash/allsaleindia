import { useLocalSearchParams, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as Linking from "expo-linking";
import * as Sharing from "expo-sharing";
import { CheckCircle2, Circle, ChevronLeft, ExternalLink, FileText, Mail, MapPin, MessageCircle, Package, PenSquare, RefreshCcw, RotateCcw, ShieldCheck, Truck, XCircle } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { api, getAuthToken } from "@/src/lib/api";
import { useTranslation } from "@/src/i18n";
import { useRegion } from "@/src/contexts/RegionContext";
import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import OrderTrackingTimeline from "@/src/components/OrderTrackingTimeline";
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
  cancel_reason_code?: string | null;
  refund_id?: string | null;
  refund_amount_nzd?: number | null;
  refund_expected_by?: string | null;
  awb_code?: string | null;
  tracking_status?: string | null;
  buyer_confirmed_at?: string | null;
};

type CancelReason = {
  code: string;
  label: string;
  requires_note: boolean;
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
  const toast = useToast();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const [order, setOrder] = useState<Order | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [cancelReasons, setCancelReasons] = useState<CancelReason[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const [emailingInvoice, setEmailingInvoice] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);
  const [reordering, setReordering] = useState(false);
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

  const downloadInvoice = useCallback(async () => {
    if (!order || downloadingInvoice) return;
    setDownloadingInvoice(true);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error("Please sign in again.");
      const base = process.env.EXPO_PUBLIC_BACKEND_URL as string;
      const url = `${base}/api/orders/${order.id}/invoice.pdf`;
      const shortId = order.id.replace("order_", "").slice(0, 8).toUpperCase();
      const fileUri = `${FileSystem.cacheDirectory}allsale-invoice-${shortId}.pdf`;

      const dl = await FileSystem.downloadAsync(url, fileUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dl.status !== 200) {
        throw new Error(`Server returned ${dl.status}`);
      }

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dl.uri, {
          mimeType: "application/pdf",
          dialogTitle: `Allsale invoice ${shortId}`,
          UTI: "com.adobe.pdf",
        });
      } else {
        // Web fallback — just open in a new tab
        await Linking.openURL(dl.uri);
      }
      toast.show({
        title: "Invoice ready",
        body: `Saved as allsale-invoice-${shortId}.pdf`,
        kind: "success",
      });
    } catch (e: any) {
      toast.show({
        title: "Couldn't download invoice",
        body: e?.message || "Please try again in a moment.",
        kind: "error",
      });
    } finally {
      setDownloadingInvoice(false);
    }
  }, [order, downloadingInvoice, toast]);

  const emailInvoice = useCallback(async () => {
    if (!order || emailingInvoice) return;
    const ok = await confirm({
      title: "Email this invoice?",
      message: "We'll send a PDF copy to the email on your account.",
      confirmLabel: "Send",
    });
    if (!ok) return;
    setEmailingInvoice(true);
    try {
      const resp = await api<{
        sent: boolean;
        to: string;
        skipped?: boolean;
        reason?: string;
      }>(`/orders/${order.id}/invoice/email`, { method: "POST", body: {} });
      if (resp.sent) {
        toast.show({
          title: "Invoice emailed",
          body: `Sent to ${resp.to}`,
          kind: "success",
        });
      } else if (resp.skipped) {
        toast.show({
          title: "Email service not configured",
          body: "Ask support to enable Resend — or download the PDF instead.",
          kind: "error",
        });
      } else {
        toast.show({
          title: "Couldn't send invoice",
          body: resp.reason || "Try again or download the PDF.",
          kind: "error",
        });
      }
    } catch (e: any) {
      toast.show({
        title: "Couldn't send invoice",
        body: e?.message || "Please try again in a moment.",
        kind: "error",
      });
    } finally {
      setEmailingInvoice(false);
    }
  }, [order, emailingInvoice, toast, confirm]);

  const canCancel = useMemo(() => {
    if (!order) return false;
    // Cancel is allowed any time before the parcel ships from India.
    if (["cancelled", "refunded", "shipped", "out_for_delivery", "delivered"].includes(order.status)) {
      return false;
    }
    if (order.payment_status !== "paid") return false;
    return true;
  }, [order]);

  const onCancel = useCallback(async () => {
    if (!order) return;
    // Validate locally so we can show inline feedback before the round-trip.
    if (!reasonCode) {
      toast.show({
        title: "Pick a reason",
        body: "Help us improve by telling us why you're cancelling.",
        kind: "error",
      });
      return;
    }
    const selected = cancelReasons.find((r) => r.code === reasonCode);
    if (selected?.requires_note && !reason.trim()) {
      toast.show({
        title: "A short note is required",
        body: "Please add a quick line so we can do better next time.",
        kind: "error",
      });
      return;
    }
    setCancelling(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/cancel`, {
        method: "POST",
        body: {
          reason_code: reasonCode,
          reason: reason.trim() || undefined,
        },
      });
      if (mounted.current) {
        setOrder(updated);
        setShowCancel(false);
        setReason("");
        setReasonCode(null);
      }
      toast.show({
        title: "Order cancelled",
        body: updated.refund_id
          ? `Refund of ${formatNZD(updated.refund_amount_nzd || 0)} on its way (5–10 business days).`
          : "Your cancellation has been received. Your refund will be processed shortly.",
        kind: "success",
      });
    } catch (e: any) {
      toast.show({ title: "Couldn't cancel", body: e?.message || "Please try again.", kind: "error" });
    } finally {
      if (mounted.current) setCancelling(false);
    }
  }, [order, reason, reasonCode, cancelReasons, toast]);

  // Lazy-load the cancel reasons list the first time the modal opens, then
  // cache it for the rest of the session.
  const openCancelModal = useCallback(async () => {
    setShowCancel(true);
    if (cancelReasons.length > 0) return;
    try {
      const list = await api<CancelReason[]>("/orders/cancel-reasons");
      if (mounted.current) setCancelReasons(list || []);
    } catch {
      // Network failure — fall back to a hardcoded minimal set so the user
      // can still cancel. These codes must stay in sync with the backend.
      if (mounted.current) {
        setCancelReasons([
          { code: "ordered_by_mistake", label: "Ordered by mistake", requires_note: false },
          { code: "changed_mind", label: "Changed my mind", requires_note: false },
          { code: "other", label: "Other (please tell us why)", requires_note: true },
        ]);
      }
    }
  }, [cancelReasons.length]);

  const onMarkReceived = useCallback(async () => {
    if (!order || confirmingReceipt) return;
    setConfirmingReceipt(true);
    try {
      const updated = await api<Order>(`/orders/${order.id}/mark-received`, {
        method: "POST",
      });
      if (mounted.current) setOrder(updated);
      toast.show({
        title: "Delivery confirmed",
        body: "Thanks! Your return window starts now if anything's wrong.",
        kind: "success",
      });
    } catch (e: any) {
      toast.show({
        title: "Couldn't confirm",
        body: e?.message || "Please try again.",
        kind: "error",
      });
    } finally {
      if (mounted.current) setConfirmingReceipt(false);
    }
  }, [order, confirmingReceipt, toast]);

  const onReorder = useCallback(async () => {
    if (!order || reordering) return;
    setReordering(true);
    try {
      const res = await api<{ cart_item_count: number; added: string[]; skipped: { product_id: string; reason: string }[] }>(
        `/orders/${order.id}/reorder`,
        { method: "POST" },
      );
      const addedCount = res.added.length;
      const skippedCount = res.skipped.length;
      toast.show({
        title: addedCount ? `Added ${addedCount} item${addedCount === 1 ? "" : "s"} to cart` : "Nothing added",
        body: skippedCount
          ? `${skippedCount} item${skippedCount === 1 ? "" : "s"} skipped (out of stock or unavailable).`
          : "Heading to your cart…",
        kind: addedCount ? "success" : "error",
      });
      if (addedCount > 0) {
        router.push("/(tabs)/cart");
      }
    } catch (e: any) {
      toast.show({
        title: "Couldn't reorder",
        body: e?.message || "Please try again.",
        kind: "error",
      });
    } finally {
      if (mounted.current) setReordering(false);
    }
  }, [order, reordering, toast, router]);

  const onMessageSeller = useCallback(async () => {
    if (!order) return;
    // Use the first seller_id from items (most orders are single-seller in MVP).
    const sellerId = order.items.find((it: any) => it.seller_id)?.["seller_id"] || null;
    if (!sellerId) {
      toast.show({
        title: "Can't open chat",
        body: "We couldn't find a seller for this order.",
        kind: "error",
      });
      return;
    }
    try {
      const firstItem = order.items.find((it: any) => it.seller_id) as any;
      const conv = await api<{ id: string }>(`/chat/conversations`, {
        method: "POST",
        body: {
          seller_id: sellerId,
          product_id: firstItem?.product_id,
          order_id: order.id,
        },
      });
      router.push(`/chat/${conv.id}`);
    } catch (e: any) {
      toast.show({
        title: "Couldn't open chat",
        body: e?.message || "Please try again.",
        kind: "error",
      });
    }
  }, [order, toast, router]);

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
        {canCancel ? (
          <Pressable
            testID="order-cancel-topbar-btn"
            onPress={openCancelModal}
            style={styles.cancelHeaderBtn}
            hitSlop={8}
          >
            <XCircle size={14} color="#fff" />
            <Text style={styles.cancelHeaderText}>Cancel</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
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
          <View style={styles.refundCard} testID="order-refund-card">
            <View style={styles.refundHeader}>
              <View style={styles.refundIconWrap}>
                <RefreshCcw size={18} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.refundTitle}>
                  {order.refund_id ? t("order_detail.refund_on_way") : t("order_detail.cancel_received")}
                </Text>
                <Text style={styles.refundSubtitle}>
                  Order #{order.id.replace("order_", "").slice(0, 8).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.refundAmount}>
                {formatNZD(order.refund_amount_nzd || order.total_nzd)}
              </Text>
            </View>

            <View style={styles.refundRow}>
              <Text style={styles.refundLabel}>{t("order_detail.status")}</Text>
              <View style={styles.refundStatusPill}>
                <View style={styles.refundDot} />
                <Text style={styles.refundStatusText}>
                  {order.refund_id ? t("order_detail.status_issued") : t("order_detail.status_pending")}
                </Text>
              </View>
            </View>

            {order.refund_expected_by ? (
              <View style={styles.refundRow}>
                <Text style={styles.refundLabel}>{t("order_detail.expected_by")}</Text>
                <Text style={styles.refundValue}>
                  {new Date(order.refund_expected_by).toLocaleDateString("en-NZ", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </Text>
              </View>
            ) : null}

            <View style={styles.refundRow}>
              <Text style={styles.refundLabel}>{t("order_detail.method")}</Text>
              <Text style={styles.refundValue}>{t("order_detail.method_card")}</Text>
            </View>

            {order.refund_id ? (
              <View style={styles.refundRow}>
                <Text style={styles.refundLabel}>{t("order_detail.reference")}</Text>
                <Text style={styles.refundValueMono} numberOfLines={1}>
                  {order.refund_id}
                </Text>
              </View>
            ) : null}

            {order.cancel_reason || order.cancel_reason_code ? (
              <View style={styles.refundRow}>
                <Text style={styles.refundLabel}>{t("order_detail.reason")}</Text>
                <Text style={styles.refundValue} numberOfLines={2}>
                  {order.cancel_reason || _cancelLabelFor(order.cancel_reason_code)}
                </Text>
              </View>
            ) : null}

            <Text style={styles.refundFootnote}>
              Your bank typically posts refunds within 5–10 business days. If you
              don&apos;t see it after that, share this reference with your card
              issuer or our support team.
            </Text>
          </View>
        ) : null}

        {canCancel ? (
          <View style={styles.cancelWindowCard} testID="order-cancel-window">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={16} color={colors.success} />
              <Text style={styles.cancelWindowTitle}>Free cancellation available</Text>
            </View>
            <Text style={styles.cancelWindowBody}>
              Your parcel hasn&apos;t shipped from India yet. You can still cancel for a full refund.
              {msLeft > 0 ? (
                <Text>
                  {" "}Estimated dispatch in <Text style={styles.cancelCountdown}>{countdown}</Text>.
                </Text>
              ) : null}
            </Text>
            <Pressable
              testID="order-cancel-btn"
              onPress={openCancelModal}
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
            >
              <XCircle size={16} color={colors.error} />
              <Text style={styles.cancelBtnText}>{t("order_detail.cancel_this_order")}</Text>
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
        ) : !isCancelled ? (
          // Not delivered yet — show a disabled hint so the option is always discoverable.
          <View style={styles.returnHintCard} testID="order-return-hint">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <RefreshCcw size={16} color={colors.textMuted} />
              <Text style={styles.returnHintTitle}>Returns</Text>
            </View>
            <Text style={styles.returnHintBody}>
              {order.status === "out_for_delivery"
                ? "Returns will be available once your parcel is delivered. You'll have 7 days from then."
                : order.status === "shipped"
                  ? "Once your parcel is delivered you'll have 7 days to request a return from this screen."
                  : "Returns become available within 7 days of delivery. You can cancel this order in the first 12 hours instead."}
            </Text>
            <View style={styles.returnHintFooter}>
              <Text style={styles.returnHintFooterText}>
                Read our{" "}
                <Text
                  testID="order-return-policy-link"
                  onPress={() => router.push("/help/return-policy")}
                  style={styles.returnHintLink}
                >
                  return policy
                </Text>
              </Text>
            </View>
          </View>
        ) : null}

        {!isCancelled ? (
          <>
            <Text style={styles.sectionTitle}>Tracking</Text>
            <OrderTrackingTimeline orderId={order.id} />
          </>
        ) : null}

        {/* Post-delivery actions: Mark received + Reorder + Message seller */}
        {!isCancelled && ["out_for_delivery", "delivered"].includes(order.status) && !order.buyer_confirmed_at ? (
          <Pressable
            testID="order-mark-received-btn"
            disabled={confirmingReceipt}
            onPress={onMarkReceived}
            style={({ pressed }) => [
              styles.markReceivedBtn,
              pressed && { opacity: 0.85 },
              confirmingReceipt && { opacity: 0.6 },
            ]}
          >
            {confirmingReceipt ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <CheckCircle2 size={16} color="#fff" />
                <Text style={styles.markReceivedText}>
                  {order.status === "delivered" ? "Confirm I received it" : "I've already received it"}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}

        {!isCancelled && order.buyer_confirmed_at ? (
          <View style={styles.confirmedBanner} testID="order-confirmed-banner">
            <CheckCircle2 size={16} color={colors.success} />
            <Text style={styles.confirmedText}>
              Delivery confirmed by you on {formatLocalDate(order.buyer_confirmed_at)}
            </Text>
          </View>
        ) : null}

        {(order.status === "delivered" || isCancelled) ? (
          <View style={styles.actionGrid}>
            <Pressable
              testID="order-reorder-btn"
              disabled={reordering}
              onPress={onReorder}
              style={({ pressed }) => [
                styles.actionTile,
                pressed && { opacity: 0.85 },
                reordering && { opacity: 0.6 },
              ]}
            >
              {reordering ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <RotateCcw size={18} color={colors.primary} />
              )}
              <Text style={styles.actionTileText}>Reorder</Text>
              <Text style={styles.actionTileSub}>Add all items back to cart</Text>
            </Pressable>
            <Pressable
              testID="order-message-seller-btn"
              onPress={onMessageSeller}
              style={({ pressed }) => [
                styles.actionTile,
                pressed && { opacity: 0.85 },
              ]}
            >
              <MessageCircle size={18} color={colors.primary} />
              <Text style={styles.actionTileText}>Message seller</Text>
              <Text style={styles.actionTileSub}>Ask about this order</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Items</Text>
        {order.items.map((it) => {
          const canReview =
            ["shipped", "out_for_delivery", "delivered"].includes(order.status);
          return (
            <View key={it.product_id} style={styles.itemRow}>
              <Image source={{ uri: it.image }} style={styles.itemImg} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={2}>
                  {it.name}
                </Text>
                <Text style={styles.itemMeta}>Qty {it.quantity}</Text>
                {canReview ? (
                  <Pressable
                    testID={`order-item-review-${it.product_id}`}
                    onPress={() =>
                      router.push({
                        pathname: "/review/write",
                        params: {
                          order_id: order.id,
                          product_id: it.product_id,
                          product_name: it.name,
                          product_image: it.image,
                        },
                      })
                    }
                    style={({ pressed }) => [
                      styles.reviewPill,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <PenSquare size={12} color={colors.primary} />
                    <Text style={styles.reviewPillText}>Write a review</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.itemPrice}>{formatNZD(it.price_nzd * it.quantity)}</Text>
            </View>
          );
        })}

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

        {/* Invoice download — only after payment clears */}
        {order.payment_status === "paid" ? (
          <Pressable
            testID="order-download-invoice"
            disabled={downloadingInvoice}
            onPress={downloadInvoice}
            style={({ pressed }) => [
              styles.invoiceBtn,
              pressed && { opacity: 0.85 },
              downloadingInvoice && { opacity: 0.55 },
            ]}
          >
            {downloadingInvoice ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <FileText size={16} color={colors.primary} />
            )}
            <Text style={styles.invoiceBtnText}>
              {downloadingInvoice ? "Generating invoice…" : "Download invoice (PDF)"}
            </Text>
          </Pressable>
        ) : null}

        {/* Email this invoice (Resend) */}
        {order.payment_status === "paid" ? (
          <Pressable
            testID="order-email-invoice"
            disabled={emailingInvoice}
            onPress={emailInvoice}
            style={({ pressed }) => [
              styles.invoiceBtn,
              { marginTop: 8 },
              pressed && { opacity: 0.85 },
              emailingInvoice && { opacity: 0.55 },
            ]}
          >
            {emailingInvoice ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Mail size={16} color={colors.primary} />
            )}
            <Text style={styles.invoiceBtnText}>
              {emailingInvoice ? "Sending…" : "Email this invoice"}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          testID="order-cancel-policy-link"
          onPress={() => router.push("/legal/cancellation")}
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
            <Text style={styles.modalTitle}>{t("order_detail.cancel_modal_title")}</Text>
            <Text style={styles.modalBody}>
              We&apos;ll refund {formatNZD(order.total_nzd)} to your card. Picking a
              reason helps us improve the experience for everyone.
            </Text>

            <ScrollView
              style={styles.reasonList}
              contentContainerStyle={{ paddingVertical: 4 }}
              showsVerticalScrollIndicator={false}
            >
              {(cancelReasons.length > 0
                ? cancelReasons
                : [
                    { code: "loading", label: "Loading…", requires_note: false },
                  ]
              ).map((r) => {
                const selected = reasonCode === r.code;
                const disabled = r.code === "loading";
                return (
                  <Pressable
                    key={r.code}
                    testID={`order-cancel-reason-${r.code}`}
                    onPress={() => !disabled && setReasonCode(r.code)}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.reasonRow,
                      selected && styles.reasonRowSelected,
                      pressed && !disabled && { opacity: 0.85 },
                    ]}
                  >
                    {selected ? (
                      <CheckCircle2 size={20} color={colors.primary} />
                    ) : (
                      <Circle size={20} color={colors.border} />
                    )}
                    <Text
                      style={[
                        styles.reasonLabel,
                        selected && styles.reasonLabelSelected,
                        disabled && { color: colors.textFaint },
                      ]}
                    >
                      {r.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {(() => {
              const sel = cancelReasons.find((r) => r.code === reasonCode);
              if (!sel) return null;
              const required = sel.requires_note;
              return (
                <>
                  <Text style={styles.modalLabel}>
                    {required ? t("order_detail.note_required") : t("order_detail.note_optional")}
                  </Text>
                  <TextInput
                    testID="order-cancel-reason-input"
                    value={reason}
                    onChangeText={setReason}
                    placeholder={
                      required
                        ? "What happened? We read every note."
                        : "Anything you'd like us to know"
                    }
                    placeholderTextColor={colors.textFaint}
                    maxLength={300}
                    multiline
                    style={styles.modalInput}
                  />
                </>
              );
            })()}

            <View style={{ flexDirection: "row", gap: 10, marginTop: spacing.md }}>
              <Pressable
                testID="order-cancel-modal-keep"
                onPress={() => setShowCancel(false)}
                style={({ pressed }) => [styles.modalSecondary, pressed && { opacity: 0.85 }]}
                disabled={cancelling}
              >
                <Text style={styles.modalSecondaryText}>{t("order_detail.keep_order")}</Text>
              </Pressable>
              <Pressable
                testID="order-cancel-modal-confirm"
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  pressed && { opacity: 0.9 },
                  (cancelling || !reasonCode) && { opacity: 0.55 },
                ]}
                disabled={cancelling || !reasonCode}
              >
                {cancelling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalPrimaryText}>{t("order_detail.confirm_cancel")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function _cancelLabelFor(code?: string | null): string {
  // Tiny local fallback for displaying the reason label when only the code
  // round-trips back from the server. Keep in sync with backend CANCEL_REASONS.
  if (!code) return "";
  const map: Record<string, string> = {
    ordered_by_mistake: "Ordered by mistake",
    changed_mind: "Changed my mind",
    found_better_price: "Found a better price elsewhere",
    shipping_too_slow: "Delivery is taking too long",
    payment_issue: "Payment / billing issue",
    duplicate_order: "Duplicate order",
    address_or_size_wrong: "Wrong address or size",
    other: "Other",
  };
  return map[code] || code;
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

function formatLocalDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
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
  cancelHeaderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.error,
  },
  cancelHeaderText: { color: "#fff", fontSize: 12, fontWeight: "800" },
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
  returnHintCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: 8,
  },
  returnHintTitle: { fontSize: 13, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.3 },
  returnHintBody: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  returnHintFooter: { marginTop: 2 },
  returnHintFooterText: { fontSize: 11, color: colors.textFaint },
  returnHintLink: { color: colors.primary, fontWeight: "700" },
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
  reviewPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  reviewPillText: { color: colors.primary, fontWeight: "700", fontSize: 11 },
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
  invoiceBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: "#fff",
  },
  invoiceBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
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

  // Refund Status Card (replaces the old cancelledBanner)
  refundCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    gap: 10,
  },
  refundHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  refundIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
  },
  refundTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  refundSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  refundAmount: { fontSize: 18, fontWeight: "800", color: colors.text },
  refundRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 6,
  },
  refundLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  refundValue: { fontSize: 13, color: colors.text, fontWeight: "700", maxWidth: "60%", textAlign: "right" },
  refundValueMono: { fontSize: 11, color: colors.text, fontWeight: "600", fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), maxWidth: "60%" },
  refundStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  refundDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  refundStatusText: { fontSize: 11, color: colors.primary, fontWeight: "800" },
  refundFootnote: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
    lineHeight: 15,
  },

  // Structured cancellation-reason picker
  reasonList: {
    marginTop: spacing.md,
    maxHeight: 320,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: colors.surface,
  },
  reasonRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  reasonLabel: { fontSize: 14, color: colors.text, fontWeight: "600", flex: 1 },
  reasonLabelSelected: { fontWeight: "800", color: colors.primary },

  markReceivedBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  markReceivedText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  confirmedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
  },
  confirmedText: { color: colors.success, fontWeight: "700", fontSize: 13, flex: 1 },
  actionGrid: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionTile: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionTileText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  actionTileSub: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
});
