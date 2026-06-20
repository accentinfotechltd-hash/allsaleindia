import { useRouter } from "expo-router";
import { Bell, BellOff, ChevronLeft, Search, Trash2 } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useConfirm, useToast } from "@/src/components/UiOverlayProvider";
import { useTranslation } from "@/src/i18n";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type SavedSearch = {
  id: string;
  name: string;
  q?: string | null;
  category?: string | null;
  subcategory?: string | null;
  filters?: Record<string, any>;
  notify: boolean;
  created_at: string;
};

export default function SavedSearchesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { show } = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: SavedSearch[] }>("/me/saved-searches");
      setItems(r.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onOpen = (s: SavedSearch) => {
    const params: Record<string, string> = {};
    if (s.q) params.q = s.q;
    if (s.category) {
      router.push({
        pathname: "/category/[name]",
        params: { name: s.category, ...params },
      });
    } else if (s.q) {
      router.push({
        pathname: "/(tabs)/categories",
        params: { q: s.q },
      });
    } else {
      router.push("/(tabs)/categories");
    }
  };

  const onDelete = async (s: SavedSearch) => {
    const ok = await confirm({
      title: t("buyer_saved_searches.delete_title", { name: s.name }),
      message: t("buyer_saved_searches.delete_msg"),
      confirmLabel: t("buyer_saved_searches.delete_btn"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/me/saved-searches/${s.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== s.id));
      show({ title: t("buyer_saved_searches.removed_toast"), kind: "success" });
    } catch (e: any) {
      show({ title: e?.message || t("buyer_saved_searches.delete_failed"), kind: "error" });
    }
  };

  const onToggleNotify = async (s: SavedSearch) => {
    const next = !s.notify;
    try {
      await api(`/me/saved-searches/${s.id}/notify`, {
        method: "PATCH",
        body: { notify: next },
      });
      setItems((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, notify: next } : x)),
      );
    } catch (e: any) {
      show({ title: e?.message || t("buyer_saved_searches.update_failed"), kind: "error" });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="saved-searches-back"
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t("buyer_saved_searches.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Search size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{t("buyer_saved_searches.empty_title")}</Text>
          <Text style={styles.emptyBody}>{t("buyer_saved_searches.empty_body")}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.lg, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`saved-search-row-${item.id}`}
              onPress={() => onOpen(item)}
              style={({ pressed }) => [
                styles.row,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    item.q && `"${item.q}"`,
                    item.category,
                    item.subcategory,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Pressable
                onPress={() => onToggleNotify(item)}
                style={styles.action}
                testID={`saved-search-notify-${item.id}`}
                hitSlop={6}
              >
                {item.notify ? (
                  <Bell size={16} color={colors.primary} />
                ) : (
                  <BellOff size={16} color={colors.textMuted} />
                )}
              </Pressable>
              <Pressable
                onPress={() => onDelete(item)}
                style={styles.action}
                testID={`saved-search-delete-${item.id}`}
                hitSlop={6}
              >
                <Trash2 size={16} color={colors.error} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", fontWeight: "800", color: colors.text, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 10 },
  emptyTitle: { fontWeight: "800", color: colors.text, fontSize: 16, marginTop: spacing.md },
  emptyBody: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { fontWeight: "800", color: colors.text, fontSize: 14 },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  action: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
