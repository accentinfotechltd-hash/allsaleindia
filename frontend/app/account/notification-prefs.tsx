/**
 * Notification preferences screen — per-category mute toggles.
 *
 * Buyers see: Order updates, Returns & refunds, Reviews, Support tickets,
 *             Back in stock, Promotions & deals.
 * Sellers additionally see: Seller alerts (new orders, payouts, POD).
 *
 * Toggling a switch optimistically updates UI, PUTs to
 * `/me/notification-prefs`, and rolls back on failure with a toast. The
 * actual mute logic lives server-side inside `create_notification`, so
 * disabling a category will stop *future* in-app notifications from
 * landing in the bell — existing items stay visible.
 */
import { useFocusEffect, useRouter } from "expo-router";
import {
  Bell,
  BellOff,
  ChevronLeft,
  Info,
} from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useToast } from "@/src/components/UiOverlayProvider";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Category = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
};

type GetResponse = {
  role: "buyer" | "seller";
  categories: Category[];
};

export default function NotificationPrefsScreen() {
  const router = useRouter();
  const { show } = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [role, setRole] = useState<"buyer" | "seller">("buyer");
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<GetResponse>("/me/notification-prefs");
      setCategories(data.categories || []);
      setRole(data.role || "buyer");
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggle = useCallback(
    async (key: string, next: boolean) => {
      setUpdatingKey(key);
      const prev = categories;
      // Optimistic update
      setCategories((cs) =>
        cs.map((c) => (c.key === key ? { ...c, enabled: next } : c))
      );
      try {
        await api("/me/notification-prefs", {
          method: "PUT",
          body: { prefs: { [key]: next } },
        });
      } catch (e) {
        // Roll back on failure
        setCategories(prev);
        const msg = e instanceof Error ? e.message : "Update failed";
        show({ title: msg, kind: "error" });
      } finally {
        setUpdatingKey(null);
      }
    },
    [categories, show]
  );

  const mutedCount = categories.filter((c) => !c.enabled).length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          testID="notif-prefs-back-btn"
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={10}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <View style={styles.heroIcon}>
              {mutedCount === 0 ? (
                <Bell size={22} color={colors.primary} />
              ) : (
                <BellOff size={22} color="#A16207" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>
                {mutedCount === 0
                  ? "All categories on"
                  : `${mutedCount} ${mutedCount === 1 ? "category" : "categories"} muted`}
              </Text>
              <Text style={styles.heroSub}>
                Choose what shows up in your bell. Existing notifications stay
                visible — these toggles control future ones.
              </Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>
              In-app · {role === "seller" ? "Seller" : "Buyer"}
            </Text>
          </View>

          <View style={styles.list}>
            {categories.map((c, idx) => (
              <View
                key={c.key}
                style={[
                  styles.row,
                  idx === 0 && styles.rowFirst,
                  idx === categories.length - 1 && styles.rowLast,
                ]}
              >
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={styles.rowLabel}>{c.label}</Text>
                  <Text style={styles.rowDescription}>{c.description}</Text>
                </View>
                <Switch
                  testID={`notif-pref-toggle-${c.key}`}
                  value={c.enabled}
                  onValueChange={(next) => toggle(c.key, next)}
                  disabled={updatingKey === c.key}
                  trackColor={{
                    false: colors.border,
                    true: colors.primary,
                  }}
                  thumbColor="#fff"
                />
              </View>
            ))}
          </View>

          <View style={styles.infoCard}>
            <Info size={14} color={colors.textMuted} />
            <Text style={styles.infoText}>
              Critical security alerts and order issues will still reach you
              by email, even if muted here.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
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
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontWeight: "800", color: colors.text, fontSize: 14 },
  heroSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    lineHeight: 15,
  },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  list: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowFirst: { borderTopWidth: 0 },
  rowLast: {},
  rowLabel: { fontWeight: "700", color: colors.text, fontSize: 14 },
  rowDescription: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 3,
    lineHeight: 15,
  },
  infoCard: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },
});
