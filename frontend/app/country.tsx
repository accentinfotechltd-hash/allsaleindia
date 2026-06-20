import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronRight, Globe2, Smartphone } from "lucide-react-native";

import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { useRegion } from "@/src/contexts/RegionContext";
import { colors, radius, spacing } from "@/src/lib/theme";

type GeoInfo = { country: string; currency: string; auto_detected: boolean };

const REGIONS: Array<{ code: string; flag: string; name: string; currency: string; subdomain: string; ship: string }> = [
  { code: "NZ", flag: "🇳🇿", name: "New Zealand", currency: "NZD", subdomain: "nz", ship: "7-14 days" },
  { code: "AU", flag: "🇦🇺", name: "Australia", currency: "AUD", subdomain: "au", ship: "7-14 days" },
  { code: "US", flag: "🇺🇸", name: "United States", currency: "USD", subdomain: "us", ship: "10-18 days" },
  { code: "GB", flag: "🇬🇧", name: "United Kingdom", currency: "GBP", subdomain: "uk", ship: "10-18 days" },
  { code: "CA", flag: "🇨🇦", name: "Canada", currency: "CAD", subdomain: "ca", ship: "10-18 days" },
  { code: "IN", flag: "🇮🇳", name: "India", currency: "INR", subdomain: "www", ship: "3-7 days" },
];

const BASE_DOMAIN = "allsale.co.nz";

export default function CountryPicker() {
  const router = useRouter();
  const { t } = useTranslation();
  const { setCountry } = useRegion();
  const [detected, setDetected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const g = await api<GeoInfo>("/geo/auto-redirect", { auth: false });
        if (g?.country) setDetected(g.country.toUpperCase());
      } catch {}
      finally { setLoading(false); }
    })();
  }, []);

  const choose = async (region: typeof REGIONS[0]) => {
    // Save choice
    try {
      // @ts-ignore — web only
      if (Platform.OS === "web" && typeof localStorage !== "undefined") {
        localStorage.setItem("allsale_region", region.code);
      }
    } catch {}
    await setCountry(region.code as any, true);

    // On web: hop to subdomain. On native: just continue into the app.
    if (Platform.OS === "web") {
      const target = `https://${region.subdomain}.${BASE_DOMAIN}/`;
      // @ts-ignore
      window.location.href = target;
    } else {
      router.replace("/(tabs)/home");
    }
  };

  const openStore = (target: "ios" | "android") => {
    const url = target === "ios"
      ? "https://apps.apple.com/app/allsale"
      : "https://play.google.com/store/apps/details?id=co.nz.allsale";
    Linking.openURL(url).catch(() => {});
  };

  const detectedRegion = REGIONS.find((r) => r.code === detected);
  const others = REGIONS.filter((r) => r.code !== detected);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Globe2 size={28} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>{t("buyer_country.hero_title")}</Text>
          <Text style={styles.heroSub}>{t("buyer_country.hero_sub")}</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            {detectedRegion ? (
              <>
                <Text style={styles.sectionLabel}>{t("buyer_country.detected_label")}</Text>
                <Pressable
                  testID={`country-detected-${detectedRegion.code}`}
                  onPress={() => choose(detectedRegion)}
                  style={({ pressed }) => [styles.bigCard, pressed && { opacity: 0.9 }]}
                >
                  <Text style={styles.bigFlag}>{detectedRegion.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bigName}>{detectedRegion.name}</Text>
                    <Text style={styles.bigMeta}>{t("buyer_country.detected_meta", { currency: detectedRegion.currency, ship: detectedRegion.ship })}</Text>
                  </View>
                  <ChevronRight size={22} color="#fff" />
                </Pressable>
              </>
            ) : null}

            <Text style={styles.sectionLabel}>{detectedRegion ? t("buyer_country.or_other_region") : t("buyer_country.choose_region")}</Text>
            <View style={styles.grid}>
              {others.map((r) => (
                <Pressable
                  key={r.code}
                  testID={`country-${r.code}`}
                  onPress={() => choose(r)}
                  style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.97 }] }]}
                >
                  <Text style={styles.flag}>{r.flag}</Text>
                  <Text style={styles.cardName}>{r.name}</Text>
                  <Text style={styles.cardCurrency}>{r.currency}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.appBanner}>
              <Smartphone size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.appBannerTitle}>{t("buyer_country.app_banner_title")}</Text>
                <Text style={styles.appBannerSub}>{t("buyer_country.app_banner_sub")}</Text>
              </View>
              <Pressable testID="app-ios" onPress={() => openStore("ios")} style={styles.storeBtn}>
                <Text style={styles.storeBtnText}>iOS</Text>
              </Pressable>
              <Pressable testID="app-android" onPress={() => openStore("android")} style={styles.storeBtn}>
                <Text style={styles.storeBtnText}>Android</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.lg, maxWidth: 720, alignSelf: "center", width: "100%" },
  hero: { alignItems: "center", gap: 12, paddingVertical: spacing.lg },
  heroIcon: { width: 56, height: 56, borderRadius: 999, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.8, textAlign: "center" },
  heroSub: { fontSize: 14, color: colors.textMuted, textAlign: "center", lineHeight: 21, paddingHorizontal: spacing.md },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: colors.textMuted, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.sm },
  bigCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: colors.primary, padding: spacing.lg, borderRadius: radius.lg },
  bigFlag: { fontSize: 42 },
  bigName: { color: "#fff", fontWeight: "800", fontSize: 18 },
  bigMeta: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { width: "31%", minWidth: 100, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", gap: 4 },
  flag: { fontSize: 32 },
  cardName: { fontWeight: "700", color: colors.text, fontSize: 12, textAlign: "center" },
  cardCurrency: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  appBanner: { flexDirection: "row", alignItems: "center", gap: 10, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft, marginTop: spacing.md },
  appBannerTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  appBannerSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  storeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.primary },
  storeBtnText: { color: "#fff", fontWeight: "800", fontSize: 11 },
});
