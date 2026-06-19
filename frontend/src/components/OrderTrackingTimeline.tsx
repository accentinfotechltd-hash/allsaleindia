import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AlertCircle, CheckCircle2, Circle, Clock, ExternalLink, ImageIcon, MapPin, PackageCheck, Truck } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Stage = {
  key: "paid" | "shipped" | "out_for_delivery" | "delivered";
  label: string;
  done: boolean;
  at?: string | null;
};

type TrackingEvent = {
  at: string;
  status?: string | null;
  location?: string | null;
  remark?: string | null;
};

export type OrderTracking = {
  order_id: string;
  status: string;
  progress_pct: number;
  stages: Stage[];
  events: TrackingEvent[];
  awb_code?: string | null;
  carrier?: string | null;
  tracking_url?: string | null;
  estimated_delivery?: string | null;
  last_tracking_status?: string | null;
  last_tracking_location?: string | null;
  last_tracking_update?: string | null;
  delivered_at?: string | null;
  buyer_confirmed_at?: string | null;
  proof_of_delivery?: {
    image: string;
    note?: string | null;
    uploaded_by: "carrier" | "seller";
    uploaded_at: string;
  } | null;
};

type Props = {
  orderId: string;
  /** Externally controlled — caller may already have the tracking object. */
  initial?: OrderTracking | null;
};

// Color tokens for the ETA ribbon, keyed by `eta_summary.status`.
const ETA_TONE: Record<
  string,
  { bg: string; border: string; text: string; iconBg: string; icon: React.ReactNode }
> = {
  on_time: {
    bg: "#EFF6FF",
    border: "#BFDBFE",
    text: "#1E3A8A",
    iconBg: "#DBEAFE",
    icon: <Truck size={18} color="#1E40AF" />,
  },
  arriving_soon: {
    bg: "#FFF7ED",
    border: "#FED7AA",
    text: "#9A3412",
    iconBg: "#FFEDD5",
    icon: <Clock size={18} color="#C2410C" />,
  },
  out_for_delivery: {
    bg: "#FEF3C7",
    border: "#FCD34D",
    text: "#92400E",
    iconBg: "#FDE68A",
    icon: <Truck size={18} color="#B45309" />,
  },
  delivered: {
    bg: "#ECFDF5",
    border: "#A7F3D0",
    text: "#065F46",
    iconBg: "#D1FAE5",
    icon: <PackageCheck size={18} color="#047857" />,
  },
  delayed: {
    bg: "#FEF2F2",
    border: "#FCA5A5",
    text: "#991B1B",
    iconBg: "#FECACA",
    icon: <AlertCircle size={18} color="#B91C1C" />,
  },
  pending: {
    bg: "#F1F5F9",
    border: "#CBD5E1",
    text: "#475569",
    iconBg: "#E2E8F0",
    icon: <Clock size={18} color="#475569" />,
  },
  cancelled: {
    bg: "#F1F5F9",
    border: "#CBD5E1",
    text: "#64748B",
    iconBg: "#E2E8F0",
    icon: <AlertCircle size={18} color="#64748B" />,
  },
};

export default function OrderTrackingTimeline({ orderId, initial }: Props) {
  const [tracking, setTracking] = useState<OrderTracking | null>(initial ?? null);
  const [loading, setLoading] = useState<boolean>(!initial);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [proofZoom, setProofZoom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (initial) return;
    setLoading(true);
    (async () => {
      try {
        const t = await api<OrderTracking>(`/orders/${orderId}/tracking`);
        if (!cancelled) setTracking(t);
      } catch {
        // silent — caller still shows shipment fallback
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId, initial]);

  const visibleEvents = useMemo(() => {
    if (!tracking) return [];
    return showAllEvents ? tracking.events : tracking.events.slice(0, 5);
  }, [tracking, showAllEvents]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!tracking) return null;

  const cancelled = ["cancelled", "refunded"].includes(tracking.status);
  const eta = tracking.eta_summary || null;
  const etaTone = eta ? ETA_TONE[eta.status] || ETA_TONE.on_time : ETA_TONE.on_time;

  return (
    <View style={styles.wrap} testID="tracking-timeline">
      {/* Smart ETA ribbon (Phase 1.5 #2) */}
      {eta ? (
        <View
          style={[styles.etaRibbon, { backgroundColor: etaTone.bg, borderColor: etaTone.border }]}
          testID="tracking-eta-ribbon"
        >
          <View style={[styles.etaIconCircle, { backgroundColor: etaTone.iconBg }]}>
            {etaTone.icon}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.etaHeadline, { color: etaTone.text }]} numberOfLines={1}>
              {eta.headline}
            </Text>
            {eta.sublabel ? (
              <Text style={[styles.etaSublabel, { color: etaTone.text }]} numberOfLines={1}>
                {eta.sublabel}
              </Text>
            ) : null}
            {eta.status === "delayed" && eta.original_window ? (
              <Text style={styles.etaOriginal} numberOfLines={1}>
                Original: {eta.original_window}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Progress bar — Amazon-style */}
      {!cancelled ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(4, tracking.progress_pct)}%` },
              ]}
            />
          </View>
          <Text style={styles.progressPct}>{tracking.progress_pct}% complete</Text>
        </View>
      ) : null}

      {/* Stage milestones */}
      <View style={styles.stages}>
        {tracking.stages.map((s, idx) => {
          const isLast = idx === tracking.stages.length - 1;
          return (
            <View key={s.key} style={styles.stageRow}>
              <View style={styles.stageIconCol}>
                {s.done ? (
                  <CheckCircle2 size={20} color={colors.primary} />
                ) : (
                  <Circle size={20} color={colors.border} />
                )}
                {!isLast ? (
                  <View
                    style={[
                      styles.stageConnector,
                      s.done ? styles.stageConnectorDone : null,
                    ]}
                  />
                ) : null}
              </View>
              <View style={{ flex: 1, paddingBottom: isLast ? 0 : 12 }}>
                <Text
                  style={[styles.stageLabel, s.done && styles.stageLabelDone]}
                >
                  {s.label}
                </Text>
                {s.at ? (
                  <Text style={styles.stageAt}>{formatDateTime(s.at)}</Text>
                ) : (
                  <Text style={styles.stageAtPending}>Pending</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Carrier card */}
      {tracking.awb_code ? (
        <Pressable
          testID="tracking-carrier-card"
          onPress={() =>
            tracking.tracking_url ? Linking.openURL(tracking.tracking_url) : null
          }
          style={({ pressed }) => [
            styles.carrierCard,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View style={styles.carrierRow}>
            <View style={styles.carrierIcon}>
              <Truck size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.carrierName}>
                {(tracking.carrier || "Carrier").replace(" (mock)", "")} · India → NZ
              </Text>
              <Text style={styles.carrierAwb}>
                AWB <Text style={styles.carrierAwbCode}>{tracking.awb_code}</Text>
              </Text>
            </View>
            <ExternalLink size={14} color={colors.textMuted} />
          </View>
          {tracking.last_tracking_status ? (
            <Text style={styles.carrierLatest} numberOfLines={1}>
              {tracking.last_tracking_status}
              {tracking.last_tracking_location ? ` · ${tracking.last_tracking_location}` : ""}
            </Text>
          ) : null}
        </Pressable>
      ) : null}

      {/* Phase 1.5 #3 — Static map preview from OpenStreetMap (no API key) */}
      {tracking.last_tracking_geo?.static_map_url ? (
        <Pressable
          testID="tracking-map-preview"
          onPress={() => {
            const { lat, lng } = tracking.last_tracking_geo!;
            const url = Platform.select({
              ios: `https://maps.apple.com/?ll=${lat},${lng}&q=Parcel`,
              default: `https://www.google.com/maps?q=${lat},${lng}`,
            })!;
            Linking.openURL(url).catch(() => {});
          }}
          style={styles.mapWrap}
        >
          <Image
            source={{ uri: tracking.last_tracking_geo.static_map_url }}
            style={styles.mapImage}
            resizeMode="cover"
            onError={() => {
              /* OSM tile failed — UI degrades to text-only carrier card above. */
            }}
          />
          <View style={styles.mapPin}>
            <MapPin size={14} color="#fff" />
          </View>
          {tracking.last_tracking_geo.label ? (
            <View style={styles.mapLabel}>
              <Text style={styles.mapLabelText} numberOfLines={1}>
                {tracking.last_tracking_geo.label}
              </Text>
              <Text style={styles.mapLabelHint}>Tap to open in Maps</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {/* Delivery proof photo (carrier or seller) */}
      {tracking.proof_of_delivery?.image ? (
        <View style={styles.proofBox} testID="tracking-proof-of-delivery">
          <View style={styles.proofHeader}>
            <ImageIcon size={14} color={colors.success} />
            <Text style={styles.proofTitle}>
              Delivery proof · {tracking.proof_of_delivery.uploaded_by === "seller" ? "From seller" : "From courier"}
            </Text>
          </View>
          <Pressable
            testID="tracking-proof-image"
            onPress={() => setProofZoom(true)}
            style={styles.proofImageWrap}
          >
            <Image
              source={{ uri: tracking.proof_of_delivery.image }}
              style={styles.proofImage}
              resizeMode="cover"
            />
          </Pressable>
          {tracking.proof_of_delivery.note ? (
            <Text style={styles.proofNote}>{tracking.proof_of_delivery.note}</Text>
          ) : null}
          <Text style={styles.proofTs}>
            {formatDateTime(tracking.proof_of_delivery.uploaded_at)}
          </Text>
        </View>
      ) : null}

      <Modal
        visible={proofZoom}
        transparent
        animationType="fade"
        onRequestClose={() => setProofZoom(false)}
      >
        <Pressable style={styles.zoomBackdrop} onPress={() => setProofZoom(false)}>
          {tracking.proof_of_delivery?.image ? (
            <Image
              source={{ uri: tracking.proof_of_delivery.image }}
              style={styles.zoomImage}
              resizeMode="contain"
            />
          ) : null}
        </Pressable>
      </Modal>

      {/* Detailed scan event timeline */}
      {tracking.events.length > 0 ? (
        <View style={styles.eventsBox} testID="tracking-events">
          <Text style={styles.eventsTitle}>Scan events</Text>
          {visibleEvents.map((e, i) => (
            <View key={`${e.at}-${i}`} style={styles.eventRow}>
              <View style={styles.eventDotCol}>
                <View style={[styles.eventDot, i === 0 && styles.eventDotLatest]} />
                {i < visibleEvents.length - 1 ? (
                  <View style={styles.eventConnector} />
                ) : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 12 }}>
                <Text style={styles.eventStatus}>
                  {e.status || "Update"}
                </Text>
                {e.location ? (
                  <View style={styles.eventLocRow}>
                    <MapPin size={11} color={colors.textMuted} />
                    <Text style={styles.eventLocation}>{e.location}</Text>
                  </View>
                ) : null}
                {e.remark ? (
                  <Text style={styles.eventRemark}>{e.remark}</Text>
                ) : null}
                <Text style={styles.eventAt}>{formatDateTime(e.at)}</Text>
              </View>
            </View>
          ))}
          {tracking.events.length > 5 ? (
            <Pressable
              testID="tracking-events-toggle"
              onPress={() => setShowAllEvents((v) => !v)}
              style={styles.eventsToggle}
            >
              <Text style={styles.eventsToggleText}>
                {showAllEvents
                  ? "Show fewer events"
                  : `Show all ${tracking.events.length} events`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  loading: { padding: spacing.lg, alignItems: "center" },

  progressWrap: { gap: 6 },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 999 },
  progressPct: { fontSize: 11, color: colors.textMuted, fontWeight: "700", textAlign: "right" },

  stages: {
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stageRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stageIconCol: { alignItems: "center", width: 20 },
  stageConnector: {
    width: 2,
    flex: 1,
    minHeight: 18,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  stageConnectorDone: { backgroundColor: colors.primary },
  stageLabel: { fontSize: 14, fontWeight: "700", color: colors.textMuted },
  stageLabelDone: { color: colors.text },
  stageAt: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontWeight: "600" },
  stageAtPending: { fontSize: 11, color: colors.textFaint, marginTop: 2, fontStyle: "italic" },

  carrierCard: {
    padding: spacing.md,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  carrierRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  carrierIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  carrierName: { fontSize: 13, fontWeight: "800", color: colors.text },
  carrierAwb: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  carrierAwbCode: {
    color: colors.text,
    fontWeight: "700",
  },
  carrierLatest: {
    fontSize: 12,
    color: colors.text,
    fontWeight: "600",
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
  },

  eventsBox: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  eventsTitle: { fontSize: 13, fontWeight: "800", color: colors.text, marginBottom: spacing.sm },
  eventRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  eventDotCol: { alignItems: "center", width: 12 },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  eventDotLatest: { backgroundColor: colors.primary },
  eventConnector: { width: 2, flex: 1, minHeight: 16, backgroundColor: colors.border, marginTop: 2 },
  eventStatus: { fontSize: 13, fontWeight: "700", color: colors.text },
  eventLocRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  eventLocation: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  eventRemark: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  eventAt: { fontSize: 11, color: colors.textFaint, marginTop: 4, fontWeight: "600" },
  eventsToggle: { alignSelf: "center", paddingVertical: 6 },
  eventsToggleText: { color: colors.primary, fontWeight: "700", fontSize: 12 },

  proofBox: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
  },
  proofHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  proofTitle: { fontSize: 12, fontWeight: "800", color: colors.success, letterSpacing: 0.3 },
  proofImageWrap: { borderRadius: radius.md, overflow: "hidden", backgroundColor: "#fff" },
  proofImage: { width: "100%", height: 220 },
  proofNote: { marginTop: 8, fontSize: 13, color: colors.text, fontStyle: "italic" },
  proofTs: { marginTop: 4, fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  zoomBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  zoomImage: { width: "100%", height: "100%" },

  etaRibbon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  etaIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  etaHeadline: { fontSize: 16, fontWeight: "800", letterSpacing: 0.2 },
  etaSublabel: { fontSize: 12, fontWeight: "600", marginTop: 2, opacity: 0.85 },
  etaOriginal: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: "italic" },

  mapWrap: {
    position: "relative",
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapImage: { width: "100%", height: 160 },
  mapPin: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  mapLabel: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: "rgba(15,23,42,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  mapLabelText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  mapLabelHint: { color: "rgba(255,255,255,0.78)", fontSize: 10, fontWeight: "600", marginTop: 1 },
});
