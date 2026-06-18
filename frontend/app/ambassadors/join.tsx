import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
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
import { useAuth } from "@/src/contexts/AuthContext";
import { setToken } from "@/src/lib/api";
import {
  COUNTRY_LABELS,
  getProgramConfig,
  joinProgram,
  ProgramConfig,
} from "@/src/lib/ambassadors";
import { colors, radius, spacing } from "@/src/lib/theme";

type Platform_ = "instagram" | "tiktok" | "youtube" | "facebook" | "other";

export default function AmbassadorJoin() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const [config, setConfig] = useState<ProgramConfig | null>(null);

  // Pre-fill from logged-in user if available.
  const [name, setName] = useState<string>(user?.full_name || "");
  const [email, setEmail] = useState<string>(user?.email || "");
  const [country, setCountry] = useState<string>((user?.country || "NZ").toUpperCase());
  const [socialHandle, setSocialHandle] = useState("");
  const [platform, setPlatform] = useState<Platform_>("instagram");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getProgramConfig().then(setConfig).catch(() => setConfig(null));
  }, []);

  const eligibleCountries = useMemo(() => {
    if (!config) return [];
    return [
      ...config.eligible_countries.B2C,
      ...config.eligible_countries.B2B,
    ].sort();
  }, [config]);

  const isIndia = country === "IN";

  const onSubmit = async () => {
    if (name.trim().length < 2) {
      toast.show({ title: "Name is required", kind: "error" });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      toast.show({ title: "Enter a valid email", kind: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await joinProgram({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        country,
        social_handle: socialHandle.trim() || undefined,
        primary_platform: platform,
      });
      // Persist the token so /ambassadors/dashboard's GET /me succeeds.
      await setToken(res.access_token);
      toast.show({
        title: "Welcome aboard! 🎉",
        body: res.needs_password_setup
          ? "Set a password from Settings to log back in on another device."
          : "You're now an Allsale Ambassador.",
        kind: "success",
      });
      router.replace("/ambassadors/dashboard");
    } catch (e: any) {
      const msg = e?.message || "Couldn't enrol. Please try again.";
      toast.show({ title: "Sign-up failed", body: msg, kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Apply to join</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>
            Tell us a little about you. We&apos;ll generate your code instantly.
          </Text>

          {/* Name */}
          <Text style={styles.label}>Your name</Text>
          <TextInput
            testID="amb-name"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Sarah Jenkins"
            autoCapitalize="words"
            placeholderTextColor={colors.textFaint}
          />

          {/* Email */}
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="amb-email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="sarah@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={colors.textFaint}
          />

          {/* Country chips */}
          <Text style={styles.label}>Country</Text>
          <View style={styles.countryWrap}>
            {eligibleCountries.map((c) => (
              <Pressable
                key={c}
                testID={`amb-country-${c}`}
                onPress={() => setCountry(c)}
                style={[styles.countryChip, country === c && styles.countryChipActive]}
              >
                <Text
                  style={[
                    styles.countryChipText,
                    country === c && styles.countryChipTextActive,
                  ]}
                >
                  {COUNTRY_LABELS[c] ?? c}
                </Text>
              </Pressable>
            ))}
          </View>

          {isIndia && (
            <View style={styles.indiaBanner}>
              <Text style={styles.indiaBannerTitle}>🇮🇳  Dual code for India</Text>
              <Text style={styles.indiaBannerText}>
                You&apos;ll get a customer code (₹5% off + 5% commission) AND a seller-recruit code
                (₹5K bounty + 10% rev-share). Drive sales abroad and sellers at home.
              </Text>
            </View>
          )}

          {/* Social handle */}
          <Text style={styles.label}>Social handle (optional)</Text>
          <TextInput
            testID="amb-handle"
            style={styles.input}
            value={socialHandle}
            onChangeText={setSocialHandle}
            placeholder="@sarahjenkins"
            autoCapitalize="none"
            placeholderTextColor={colors.textFaint}
          />

          {/* Primary platform */}
          <Text style={styles.label}>Primary platform</Text>
          <View style={styles.platformWrap}>
            {(["instagram", "tiktok", "youtube", "facebook", "other"] as Platform_[]).map(
              (p) => (
                <Pressable
                  key={p}
                  testID={`amb-platform-${p}`}
                  onPress={() => setPlatform(p)}
                  style={[styles.platformChip, platform === p && styles.platformChipActive]}
                >
                  <Text
                    style={[
                      styles.platformChipText,
                      platform === p && styles.platformChipTextActive,
                    ]}
                  >
                    {p[0].toUpperCase() + p.slice(1)}
                  </Text>
                </Pressable>
              )
            )}
          </View>

          <Pressable
            testID="amb-submit"
            disabled={submitting}
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={onSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Join now</Text>
            )}
          </Pressable>
          <Text style={styles.disclaimer}>
            By joining you agree to the Ambassador Programme T&amp;Cs.
            Codes are unique and stable — once issued they don&apos;t change.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "800",
    color: colors.text,
    fontSize: 16,
  },
  scroll: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl * 2 },
  lead: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },
  label: {
    fontWeight: "700",
    color: colors.text,
    fontSize: 12,
    marginTop: spacing.md,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  countryWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  countryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  countryChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  countryChipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  countryChipTextActive: { color: colors.primary, fontWeight: "800" },
  indiaBanner: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: 4,
  },
  indiaBannerTitle: { fontWeight: "800", color: colors.text, fontSize: 13 },
  indiaBannerText: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  platformWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  platformChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  platformChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  platformChipText: { fontSize: 12, color: colors.text, fontWeight: "600" },
  platformChipTextActive: { color: colors.primary, fontWeight: "800" },
  submitBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  disclaimer: {
    color: colors.textFaint,
    textAlign: "center",
    fontSize: 11,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
});
