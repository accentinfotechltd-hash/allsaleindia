import { useFocusEffect, useRouter } from "expo-router";
import { AlertCircle, CheckCircle2, Clock, FileText } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export type SellerStatus =
  | "pending_documents"
  | "pending_review"
  | "approved"
  | "auto_verified"
  | "rejected"
  | "not_seller";

export type SellerStatusPayload = {
  status: SellerStatus;
  submitted_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  has_id_proof?: boolean;
  has_business_proof?: boolean;
  sla_days_remaining?: number | null;
};

/**
 * Compact, brand-aware status banner shown on the seller dashboard.
 *
 * Polls `/api/seller/me/status` on focus and renders:
 *  - pending_documents → orange CTA to upload docs
 *  - pending_review    → blue "under review · X days remaining"
 *  - approved          → green success
 *  - rejected          → red with reason + resubmit CTA
 */
export function SellerStatusBanner({
  onStatusLoaded,
}: {
  onStatusLoaded?: (s: SellerStatusPayload) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<SellerStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<SellerStatusPayload>("/seller/me/status");
      setData(res);
      onStatusLoaded?.(res);
    } catch {
      // silent — render nothing
    } finally {
      setLoading(false);
    }
  }, [onStatusLoaded]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  if (data.status === "approved" || data.status === "auto_verified") {
    return (
      <View testID="seller-status-banner" style={[styles.banner, styles.approved]}>
        <CheckCircle2 size={18} color={colors.success} />
        <Text style={[styles.text, { color: colors.success }]} testID="seller-verified-badge">
          Business approved — you can start selling.
        </Text>
      </View>
    );
  }

  if (data.status === "pending_documents") {
    return (
      <Pressable
        testID="seller-status-banner"
        onPress={() => router.push("/seller/documents")}
        style={({ pressed }) => [styles.banner, styles.pendingDocs, pressed && { opacity: 0.85 }]}
      >
        <FileText size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.text, { color: colors.primaryDark }]}>
            Upload ID proof & business proof to continue
          </Text>
          <Text style={styles.subtext}>Tap to upload • required to list products</Text>
        </View>
      </Pressable>
    );
  }

  if (data.status === "pending_review") {
    const days =
      typeof data.sla_days_remaining === "number" ? data.sla_days_remaining : null;
    return (
      <View testID="seller-status-banner" style={[styles.banner, styles.review]}>
        <Clock size={18} color="#2563EB" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.text, { color: "#1E40AF" }]}>
            Application under review
          </Text>
          <Text style={styles.subtext}>
            {days !== null
              ? `We'll respond within ${days} business day${days === 1 ? "" : "s"}`
              : "We'll respond within 7 business days"}
          </Text>
        </View>
      </View>
    );
  }

  if (data.status === "rejected") {
    return (
      <Pressable
        testID="seller-status-banner"
        onPress={() => router.push("/seller/documents")}
        style={({ pressed }) => [styles.banner, styles.rejected, pressed && { opacity: 0.85 }]}
      >
        <AlertCircle size={18} color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.text, { color: colors.danger }]}>Application not approved</Text>
          <Text style={styles.subtext} numberOfLines={3}>
            {data.rejection_reason || "Please re-submit your documents to continue."}
          </Text>
          <Text style={[styles.subtext, { color: colors.primary, marginTop: 4, fontWeight: "700" }]}>
            Tap to re-upload documents
          </Text>
        </View>
      </Pressable>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 12, alignItems: "center" },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  approved: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  pendingDocs: { backgroundColor: colors.primarySoft, borderColor: "#FFD9BA" },
  review: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  rejected: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  text: { fontSize: 13.5, fontWeight: "700" },
  subtext: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
});
