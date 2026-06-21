import { useRouter } from "expo-router";
import {
  Activity,
  ChevronLeft,
  Eye,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AdminForbidden,
  AdminUnauthorized,
  adminApi,
} from "@/src/lib/adminApi";
import { useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { colors, radius, spacing } from "@/src/lib/theme";

type Funnel = {
  experiment: string;
  window_days: number;
  conversion_event: string | null;
  variants: Record<
    string,
    { exposures: number; conversions: number; rate: number }
  >;
  total_exposures: number;
  total_conversions: number;
};

type RecentEvent = {
  id: string;
  name: string;
  props: Record<string, any>;
  session_id: string | null;
  page: string | null;
  user_id: string | null;
  created_at: string;
};

const SUGGESTED_EXPERIMENTS = [
  "personalised_rail_v1",
  "hero_cta_v1",
  "free_ship_threshold_v1",
];

const SUGGESTED_CONVERSION_EVENTS = [
  "checkout.complete",
  "cart.add",
  "checkout.start",
];

const WINDOW_OPTIONS = [
  { value: 1, label: "24h" },
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

export default function AdminAnalytics() {
  const router = useRouter();
  const { show } = useToast();
  const { t } = useTranslation();

  const [experiment, setExperiment] = useState("personalised_rail_v1");
  const [conversionEvent, setConversionEvent] =
    useState<string>("checkout.complete");
  const [windowDays, setWindowDays] = useState(14);
  const [customExperiment, setCustomExperiment] = useState("");

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [recent, setRecent] = useState<RecentEvent[]>([]);
  const [loadingFunnel, setLoadingFunnel] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // ------------------ Load funnel ------------------
  const loadFunnel = useCallback(async () => {
    setLoadingFunnel(true);
    try {
      const params: Record<string, string | number> = {
        experiment,
        days: windowDays,
      };
      if (conversionEvent) params.conversion_event = conversionEvent;
      const data = await adminApi<Funnel>("/admin/events/funnel", {
        query: params,
      });
      setFunnel(data);
    } catch (e: any) {
      if (e instanceof AdminUnauthorized || e instanceof AdminForbidden) {
        show({ title: t("admin_analytics.err_manager_required"), kind: "error" });
        router.replace("/admin");
        return;
      }
      show({ title: e?.message || t("admin_analytics.err_load_funnel"), kind: "error" });
    } finally {
      setLoadingFunnel(false);
    }
  }, [experiment, conversionEvent, windowDays, router, show, t]);

  // ------------------ Load recent ------------------
  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const data = await adminApi<{ events: RecentEvent[] }>(
        "/admin/events/recent",
        { query: { limit: 20, name: "ab.exposure" } },
      );
      setRecent(data.events || []);
    } catch (e: any) {
      if (!(e instanceof AdminForbidden)) {
        show({ title: e?.message || t("admin_analytics.err_load_recent"), kind: "error" });
      }
    } finally {
      setLoadingRecent(false);
    }
  }, [show, t]);

  useEffect(() => {
    loadFunnel();
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment, conversionEvent, windowDays]);

  // ------------------ Derived ------------------
  const variantStats = useMemo(() => {
    if (!funnel) return [];
    return Object.entries(funnel.variants).map(([name, stats]) => ({
      name,
      ...stats,
      // Compute lift relative to the "control" variant if present.
      liftVsControl:
        funnel.variants.control && name !== "control" && conversionEvent
          ? funnel.variants.control.rate > 0
            ? (stats.rate - funnel.variants.control.rate) /
              funnel.variants.control.rate
            : null
          : null,
    }));
  }, [funnel, conversionEvent]);

  const onApplyCustom = () => {
    const v = customExperiment.trim();
    if (v) setExperiment(v);
  };

  // ------------------ Render ------------------
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("admin_analytics.title")}</Text>
        <Pressable
          onPress={() => {
            loadFunnel();
            loadRecent();
          }}
          style={styles.headerBtn}
        >
          <RefreshCw size={18} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Experiment picker */}
        <Text style={styles.sectionLabel}>{t("admin_analytics.label_experiment")}</Text>
        <View style={styles.pillRow}>
          {SUGGESTED_EXPERIMENTS.map((exp) => (
            <Pressable
              key={exp}
              onPress={() => setExperiment(exp)}
              style={[styles.pill, experiment === exp && styles.pillActive]}
            >
              <Text
                style={[
                  styles.pillText,
                  experiment === exp && styles.pillTextActive,
                ]}
                numberOfLines={1}
              >
                {exp}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.customRow}>
          <TextInput
            testID="analytics-custom-exp"
            value={customExperiment}
            onChangeText={setCustomExperiment}
            placeholder={t("admin_analytics.placeholder_experiment")}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            style={styles.customInput}
            onSubmitEditing={onApplyCustom}
          />
          <Pressable onPress={onApplyCustom} style={styles.customBtn}>
            <Text style={styles.customBtnText}>{t("admin_analytics.btn_set")}</Text>
          </Pressable>
        </View>
        <Text style={styles.currentExpTag}>
          {t("admin_analytics.showing_label")} <Text style={{ fontWeight: "800" }}>{experiment}</Text>
        </Text>

        {/* Window + Conversion picker */}
        <Text style={styles.sectionLabel}>{t("admin_analytics.label_window")}</Text>
        <View style={styles.pillRow}>
          {WINDOW_OPTIONS.map((w) => (
            <Pressable
              key={w.value}
              onPress={() => setWindowDays(w.value)}
              style={[
                styles.pill,
                windowDays === w.value && styles.pillActive,
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  windowDays === w.value && styles.pillTextActive,
                ]}
              >
                {w.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t("admin_analytics.label_conversion_event")}</Text>
        <View style={styles.pillRow}>
          <Pressable
            onPress={() => setConversionEvent("")}
            style={[
              styles.pill,
              conversionEvent === "" && styles.pillActive,
            ]}
          >
            <Text
              style={[
                styles.pillText,
                conversionEvent === "" && styles.pillTextActive,
              ]}
            >
              {t("admin_analytics.conv_none")}
            </Text>
          </Pressable>
          {SUGGESTED_CONVERSION_EVENTS.map((ev) => (
            <Pressable
              key={ev}
              onPress={() => setConversionEvent(ev)}
              style={[
                styles.pill,
                conversionEvent === ev && styles.pillActive,
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  conversionEvent === ev && styles.pillTextActive,
                ]}
              >
                {ev}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* FUNNEL RESULTS */}
        <View style={styles.headlineRow}>
          <Activity size={18} color={colors.primary} />
          <Text style={styles.headline}>{t("admin_analytics.funnel_title")}</Text>
          {loadingFunnel && (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
        </View>

        {!funnel || (!funnel.total_exposures && !loadingFunnel) ? (
          <View style={styles.emptyCard}>
            <Eye size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{t("admin_analytics.empty_title")}</Text>
            <Text style={styles.emptyBody}>
              {t("admin_analytics.empty_body_prefix")}
              <Text style={{ fontWeight: "700" }}>
                {`{ experiment: "${experiment}", variant: "control" | "treatment" }`}
              </Text>
              {t("admin_analytics.empty_body_suffix")}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.headerStatsRow}>
              <SummaryStat
                label={t("admin_analytics.stat_total_exposures")}
                value={funnel.total_exposures}
              />
              {!!conversionEvent && (
                <SummaryStat
                  label={t("admin_analytics.stat_conversions", { event: conversionEvent })}
                  value={funnel.total_conversions}
                />
              )}
              <SummaryStat label={t("admin_analytics.stat_window")} value={`${windowDays}d`} text />
            </View>

            {variantStats.map((v) => (
              <VariantCard
                key={v.name}
                name={v.name}
                exposures={v.exposures}
                conversions={v.conversions}
                rate={v.rate}
                conversionEvent={conversionEvent}
                liftVsControl={v.liftVsControl}
              />
            ))}

            {variantStats.length >= 2 && conversionEvent && (
              <SignificanceHint stats={variantStats as any} />
            )}
          </>
        )}

        {/* RECENT EXPOSURES (debug tail) */}
        <View style={styles.headlineRow}>
          <Zap size={18} color={colors.primary} />
          <Text style={styles.headline}>{t("admin_analytics.recent_title")}</Text>
          {loadingRecent && (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
        </View>

        {recent.length === 0 ? (
          <Text style={styles.subtleNote}>{t("admin_analytics.recent_empty")}</Text>
        ) : (
          recent.slice(0, 8).map((e) => (
            <View key={e.id} style={styles.eventRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {String(e.props?.experiment || t("admin_analytics.unknown_label"))} ·{" "}
                  <Text style={{ fontWeight: "800" }}>
                    {String(e.props?.variant || "?")}
                  </Text>
                </Text>
                <Text style={styles.eventMeta}>
                  {e.session_id?.slice(0, 12)}…{" "}
                  {e.props?.country ? `· ${e.props.country}` : ""}{" "}
                  {e.page ? `· ${e.page}` : ""}
                </Text>
              </View>
              <Text style={styles.eventTime}>{shortTime(e.created_at, t)}</Text>
            </View>
          ))
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function SummaryStat({
  label,
  value,
  text,
}: {
  label: string;
  value: number | string;
  text?: boolean;
}) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, text && { fontSize: 18 }]}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </Text>
    </View>
  );
}

function VariantCard({
  name,
  exposures,
  conversions,
  rate,
  conversionEvent,
  liftVsControl,
}: {
  name: string;
  exposures: number;
  conversions: number;
  rate: number;
  conversionEvent: string;
  liftVsControl: number | null;
}) {
  const { t } = useTranslation();
  const isWinner =
    liftVsControl !== null && liftVsControl > 0.01 && conversions >= 10;
  const isLoser =
    liftVsControl !== null && liftVsControl < -0.01 && conversions >= 10;

  return (
    <View
      style={[
        styles.variantCard,
        isWinner && styles.variantCardWinner,
        isLoser && styles.variantCardLoser,
      ]}
    >
      <View style={styles.variantHead}>
        <Text style={styles.variantName}>{name}</Text>
        {liftVsControl !== null && (
          <View style={styles.liftChip}>
            {liftVsControl >= 0 ? (
              <TrendingUp size={12} color="#10B981" />
            ) : (
              <TrendingDown size={12} color="#DC2626" />
            )}
            <Text
              style={[
                styles.liftText,
                { color: liftVsControl >= 0 ? "#10B981" : "#DC2626" },
              ]}
            >
              {t("admin_analytics.lift_vs_control", { pct: (liftVsControl * 100).toFixed(1) })}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.variantStats}>
        <View style={styles.variantStatCol}>
          <Text style={styles.variantStatLabel}>{t("admin_analytics.variant_exposures")}</Text>
          <Text style={styles.variantStatValue}>
            {exposures.toLocaleString()}
          </Text>
        </View>
        {!!conversionEvent && (
          <>
            <View style={styles.variantStatCol}>
              <Text style={styles.variantStatLabel}>{t("admin_analytics.variant_conversions")}</Text>
              <Text style={styles.variantStatValue}>
                {conversions.toLocaleString()}
              </Text>
            </View>
            <View style={styles.variantStatCol}>
              <Text style={styles.variantStatLabel}>{t("admin_analytics.variant_rate")}</Text>
              <Text style={[styles.variantStatValue, { color: colors.primary }]}>
                {(rate * 100).toFixed(2)}%
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function SignificanceHint({
  stats,
}: {
  stats: Array<{ name: string; exposures: number; conversions: number }>;
}) {
  const { t } = useTranslation();
  const minConv = Math.min(...stats.map((s) => s.conversions));
  const minExp = Math.min(...stats.map((s) => s.exposures));
  let msg = "";
  let kind: "success" | "warn" = "warn";
  if (minExp < 100) {
    msg = t("admin_analytics.sig_small");
  } else if (minConv < 30) {
    msg = t("admin_analytics.sig_thin");
  } else if (minExp >= 1000 && minConv >= 50) {
    msg = t("admin_analytics.sig_healthy");
    kind = "success";
  } else {
    msg = t("admin_analytics.sig_gathering");
  }
  return (
    <View style={[styles.hintCard, kind === "success" && styles.hintCardOk]}>
      <Text style={styles.hintText}>{msg}</Text>
    </View>
  );
}

function shortTime(iso: string, t: (k: string) => string): string {
  try {
    const d = new Date(iso);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return t("admin_analytics.time_just_now");
    if (diffMin < 60) return `${diffMin}m`;
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h`;
    return `${Math.floor(diffMin / (60 * 24))}d`;
  } catch {
    return "";
  }
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
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "800",
    color: colors.text,
    fontSize: 16,
  },
  scroll: { padding: spacing.md, paddingBottom: 64 },

  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "transparent",
    maxWidth: "100%",
  },
  pillActive: { backgroundColor: "#EEF2FF", borderColor: colors.primary },
  pillText: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  pillTextActive: { color: colors.primary },

  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.text,
    fontSize: 13,
  },
  customBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  customBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  currentExpTag: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
  },

  headlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  headline: { flex: 1, fontWeight: "800", color: colors.text, fontSize: 14 },

  emptyCard: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyTitle: { fontWeight: "800", color: colors.text },
  emptyBody: { color: colors.textMuted, textAlign: "center", fontSize: 12, lineHeight: 18 },

  headerStatsRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  summaryStat: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  summaryLabel: { color: colors.textMuted, fontSize: 10, marginBottom: 4, fontWeight: "700" },
  summaryValue: { color: colors.text, fontWeight: "800", fontSize: 20 },

  variantCard: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  variantCardWinner: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  variantCardLoser: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A5" },
  variantHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  variantName: {
    flex: 1,
    fontWeight: "800",
    color: colors.text,
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  liftChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  liftText: { fontSize: 11, fontWeight: "800" },
  variantStats: { flexDirection: "row", gap: spacing.md },
  variantStatCol: { flex: 1 },
  variantStatLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700", marginBottom: 2 },
  variantStatValue: { color: colors.text, fontWeight: "800", fontSize: 16 },

  hintCard: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  hintCardOk: { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  hintText: { color: colors.text, fontSize: 12, lineHeight: 18 },

  subtleNote: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: spacing.md },

  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: 6,
    gap: spacing.sm,
  },
  eventTitle: { color: colors.text, fontSize: 12 },
  eventMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  eventTime: { color: colors.textMuted, fontSize: 11, fontWeight: "600" },
});
