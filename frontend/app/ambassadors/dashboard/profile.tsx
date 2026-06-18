import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { AmbassadorMe, getMe, updateMe } from "@/src/lib/ambassadors";
import { colors, radius, spacing } from "@/src/lib/theme";

/**
 * Deep-linkable profile editor (`/ambassadors/dashboard/profile`).
 * Same form as the inline editor on the main dashboard, but as a standalone
 * route so users can bookmark / share “update your details” links.
 */
export default function AmbassadorProfile() {
  const router = useRouter();
  const toast = useToast();
  const [me, setMe] = useState<AmbassadorMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [handle, setHandle] = useState("");
  const [phone, setPhone] = useState("");
  const [audience, setAudience] = useState("");
  const [ccy, setCcy] = useState("NZD");
  const [platform, setPlatform] = useState<string>("instagram");

  const load = useCallback(async () => {
    try {
      const m = await getMe();
      setMe(m);
      setHandle(m.social_handle || "");
      setPhone(m.phone || "");
      setAudience(m.audience_size != null ? String(m.audience_size) : "");
      setCcy(m.payout_currency);
      setPlatform(m.primary_platform || "instagram");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.toLowerCase().includes("not enrolled")) router.replace("/ambassadors");
      else toast.show({ title: "Couldn't load profile", body: msg, kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !me) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const isIndia = me.country === "IN";
  const canSave =
    handle !== (me.social_handle || "") ||
    phone !== (me.phone || "") ||
    audience !== (me.audience_size != null ? String(me.audience_size) : "") ||
    ccy !== me.payout_currency ||
    platform !== (me.primary_platform || "");

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const patch: Record<string, any> = {};
      if (handle !== (me.social_handle || "")) patch.social_handle = handle.trim() || null;
      if (phone !== (me.phone || "")) patch.phone = phone.trim() || null;
      if (audience !== (me.audience_size != null ? String(me.audience_size) : "")) {
        const n = parseInt(audience.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(n)) patch.audience_size = n;
      }
      if (ccy !== me.payout_currency) patch.payout_currency = ccy;
      if (platform !== (me.primary_platform || "")) patch.primary_platform = platform;
      const fresh = await updateMe(patch);
      setMe(fresh);
      toast.show({ title: "Profile saved ✓", kind: "success" });
    } catch (e: any) {
      toast.show({ title: "Couldn't save", body: e?.message, kind: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="amb-profile-back">
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.readOnlyCard}>
            <Text style={styles.readOnlyLabel}>Read-only — contact support to change</Text>
            <Text style={styles.readOnlyRow}>Email · {me.email}</Text>
            <Text style={styles.readOnlyRow}>Country · {me.country}</Text>
            <Text style={styles.readOnlyRow}>Code · {me.code}{me.code_b2b ? `  ·  ${me.code_b2b}` : ""}</Text>
            <Text style={styles.readOnlyRow}>Program · {me.program}</Text>
          </View>

          <Text style={styles.label}>Social handle</Text>
          <TextInput
            testID="amb-profile-handle"
            style={styles.input}
            value={handle}
            onChangeText={setHandle}
            placeholder="@sarahjenkins"
            autoCapitalize="none"
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.label}>Primary platform</Text>
          <View style={styles.chipRow}>
            {["instagram", "tiktok", "youtube", "facebook", "other"].map((p) => (
              <Pressable
                key={p}
                testID={`amb-profile-platform-${p}`}
                onPress={() => setPlatform(p)}
                style={[styles.chip, platform === p && styles.chipActive]}
              >
                <Text style={[styles.chipText, platform === p && styles.chipTextActive]}>
                  {p[0].toUpperCase() + p.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Phone</Text>
          <TextInput
            testID="amb-profile-phone"
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+64 21 555 1234"
            keyboardType="phone-pad"
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.label}>Audience size</Text>
          <TextInput
            testID="amb-profile-audience"
            style={styles.input}
            value={audience}
            onChangeText={setAudience}
            placeholder="14500"
            keyboardType="number-pad"
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.label}>Payout currency</Text>
          <View style={styles.chipRow}>
            {(isIndia ? ["INR"] : ["NZD", "AUD", "USD", "GBP", "CAD"]).map((c) => (
              <Pressable
                key={c}
                testID={`amb-profile-ccy-${c}`}
                onPress={() => !isIndia && setCcy(c)}
                disabled={isIndia}
                style={[
                  styles.chip,
                  ccy === c && styles.chipActive,
                  isIndia && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.chipText, ccy === c && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          {isIndia && (
            <Text style={styles.hint}>India is INR-only (Razorpay constraint).</Text>
          )}
          {!isIndia && me.unpaid_balance + me.pending_commission > 0 && ccy !== me.payout_currency && (
            <Text style={styles.warn}>
              ⚠  You have a pending balance. Withdraw or wait for it to clear before changing currency.
            </Text>
          )}

          <Pressable
            testID="amb-profile-save"
            disabled={!canSave || saving}
            onPress={onSave}
            style={[styles.saveBtn, (!canSave || saving) && { opacity: 0.5 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.saveText}>{canSave ? "Save changes" : "No changes"}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl * 2 },
  readOnlyCard: { backgroundColor: colors.surfaceMuted, padding: spacing.md, borderRadius: radius.md, gap: 3, marginBottom: spacing.sm },
  readOnlyLabel: { color: colors.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  readOnlyRow: { color: colors.textMuted, fontSize: 12 },
  label: { fontWeight: "700", color: colors.text, fontSize: 12, marginTop: spacing.sm, letterSpacing: 0.3 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, color: colors.text },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: colors.primary, fontWeight: "800" },
  hint: { color: colors.textFaint, fontSize: 11, marginTop: 4 },
  warn: { color: "#92400E", backgroundColor: "#FEF3C7", padding: spacing.sm, borderRadius: radius.md, fontSize: 11, marginTop: spacing.xs },
  saveBtn: { backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 999, alignItems: "center", marginTop: spacing.lg },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});
