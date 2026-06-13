import { useRouter } from "expo-router";
import { ChevronLeft, Copy, Gift, Share2, UserPlus } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Entry = {
  id: string;
  referee_name?: string | null;
  status: string;
  pts_referrer: number;
  created_at: string;
};
type Me = {
  code: string;
  share_url: string;
  share_message: string;
  referrer_reward_pts: number;
  referee_reward_pts: number;
  expiry_days: number;
  total_referred: number;
  total_rewarded: number;
  pts_earned: number;
  history: Entry[];
};

export default function ReferralsScreen() {
  const router = useRouter();
  const [data, setData] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<Me>("/referrals/me");
      setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCopy = async () => {
    if (!data) return;
    await Clipboard.setStringAsync(data.code);
    Alert.alert("Code copied!", `${data.code} is ready to paste.`);
  };

  const onShare = async () => {
    if (!data) return;
    try {
      await Share.share({ message: data.share_message });
    } catch (e: any) {
      Alert.alert("Couldn't share", e?.message || "Try again.");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }
  if (!data) return null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable testID="ref-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Invite friends</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Gift size={28} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Give pts. Get pts.</Text>
          <Text style={styles.heroSub}>
            Share your code with friends. They get +{data.referee_reward_pts} pts.
            You get +{data.referrer_reward_pts} pts when their first order ships.
          </Text>
        </View>

        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Your code</Text>
          <Text style={styles.codeValue} testID="ref-code">{data.code}</Text>
          <View style={styles.actionsRow}>
            <Pressable testID="ref-copy" onPress={onCopy} style={styles.copyBtn}>
              <Copy size={14} color={colors.primary} />
              <Text style={styles.copyText}>Copy code</Text>
            </Pressable>
            <Pressable testID="ref-share" onPress={onShare} style={styles.shareBtn}>
              <Share2 size={14} color="#fff" />
              <Text style={styles.shareText}>Share invite</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statBig}>{data.total_referred}</Text>
            <Text style={styles.statLabel}>Invited</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statBig, { color: "#10B981" }]}>{data.total_rewarded}</Text>
            <Text style={styles.statLabel}>Rewarded</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statBig, { color: "#7C3AED" }]}>+{data.pts_earned}</Text>
            <Text style={styles.statLabel}>Points earned</Text>
          </View>
        </View>

        <Text style={styles.histTitle}>History</Text>
        {data.history.length === 0 ? (
          <View style={styles.empty}>
            <UserPlus size={28} color={colors.textFaint} />
            <Text style={styles.emptyText}>
              No invites yet. Share your code to start earning! ✨
            </Text>
          </View>
        ) : (
          data.history.map((h) => (
            <View key={h.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{h.referee_name || "A friend"}</Text>
                <Text style={styles.rowDate}>
                  {new Date(h.created_at).toLocaleDateString()}
                </Text>
              </View>
              <View
                style={[
                  styles.statusChip,
                  h.status === "rewarded" ? styles.statusGood : h.status === "expired" ? styles.statusBad : styles.statusPending,
                ]}
              >
                <Text style={styles.statusText}>
                  {h.status === "rewarded" ? `+${h.pts_referrer} pts` : h.status === "expired" ? "Expired" : "Pending"}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.md },
  hero: { backgroundColor: "#7C3AED", borderRadius: radius.lg, padding: spacing.lg, alignItems: "center", gap: 8 },
  heroIcon: { width: 56, height: 56, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  heroSub: { color: "rgba(255,255,255,0.9)", textAlign: "center", fontSize: 13, lineHeight: 19 },
  codeCard: { backgroundColor: "#fff", borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: 6 },
  codeLabel: { color: colors.textMuted, fontWeight: "700", fontSize: 11, letterSpacing: 1 },
  codeValue: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: 4 },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.primary },
  copyText: { color: colors.primary, fontWeight: "800", fontSize: 13 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.primary },
  shareText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  statCard: { flex: 1, backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  statBig: { fontWeight: "800", fontSize: 22, color: colors.text },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  histTitle: { fontWeight: "800", color: colors.text, fontSize: 16, marginTop: spacing.sm },
  empty: { padding: spacing.lg, alignItems: "center", gap: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  rowName: { fontWeight: "700", color: colors.text, fontSize: 14 },
  rowDate: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusGood: { backgroundColor: "#ECFDF5" },
  statusPending: { backgroundColor: colors.surfaceMuted },
  statusBad: { backgroundColor: "#FEE2E2" },
  statusText: { fontWeight: "800", fontSize: 11, color: colors.text },
});
