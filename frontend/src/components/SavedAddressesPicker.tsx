import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MapPin, Plus, Star } from "lucide-react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export type SavedAddress = {
  id: string;
  label: string;
  full_name: string;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code: string;
  country: string;
  is_default: boolean;
};

type Props = {
  selectedId: string | null;
  onSelect: (addr: SavedAddress | null) => void;
};

/**
 * Horizontal picker of the buyer's saved shipping addresses. Tapping a chip
 * fires `onSelect(addr)` so the parent can pre-fill its form fields. The
 * "Use new address" chip clears any selection by emitting `null`.
 *
 * Renders nothing if the user has no saved addresses (silently degrades to
 * the existing manual entry flow).
 */
export default function SavedAddressesPicker({ selectedId, onSelect }: Props) {
  const [items, setItems] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ addresses: SavedAddress[] }>("/account/addresses");
      const list = data.addresses || [];
      setItems(list);
      // Auto-select default on first mount if nothing chosen yet.
      if (!selectedId && list.length > 0) {
        const def = list.find((a) => a.is_default) || list[0];
        onSelect(def);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
    // selectedId / onSelect intentionally NOT in deps - auto-select only once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (items.length === 0) return null;

  return (
    <View style={styles.wrap} testID="saved-addr-picker">
      <View style={styles.headerRow}>
        <MapPin size={14} color={colors.primary} />
        <Text style={styles.headerText}>Use a saved address</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingVertical: 4, gap: 8 }}
      >
        {items.map((a) => {
          const active = a.id === selectedId;
          return (
            <Pressable
              key={a.id}
              testID={`saved-addr-chip-${a.id}`}
              onPress={() => onSelect(a)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <View style={styles.chipHead}>
                <Text
                  style={[styles.chipLabel, active && styles.chipLabelActive]}
                  numberOfLines={1}
                >
                  {a.label}
                </Text>
                {a.is_default && (
                  <Star
                    size={10}
                    color={active ? "#fff" : "#92400E"}
                    fill={active ? "#fff" : "#FCD34D"}
                  />
                )}
              </View>
              <Text
                style={[styles.chipLine, active && styles.chipLineActive]}
                numberOfLines={1}
              >
                {a.full_name}
              </Text>
              <Text
                style={[styles.chipLine, active && styles.chipLineActive]}
                numberOfLines={1}
              >
                {a.line1}
              </Text>
              <Text
                style={[styles.chipMeta, active && styles.chipLineActive]}
                numberOfLines={1}
              >
                {a.city}
                {a.state ? `, ${a.state}` : ""} · {a.postal_code}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          testID="saved-addr-new"
          onPress={() => onSelect(null)}
          style={[
            styles.chip,
            styles.chipNew,
            !selectedId && styles.chipNewActive,
          ]}
        >
          <Plus
            size={18}
            color={!selectedId ? "#fff" : colors.primary}
          />
          <Text
            style={[
              styles.chipNewText,
              !selectedId && { color: "#fff" },
            ]}
          >
            Use new
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  loadingRow: {
    paddingVertical: spacing.sm,
    alignItems: "flex-start",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  headerText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "700",
  },
  chip: {
    width: 180,
    minHeight: 92,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 10,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  chipLabel: {
    flex: 1,
    fontWeight: "800",
    color: colors.text,
    fontSize: 13,
  },
  chipLabelActive: { color: "#fff" },
  chipLine: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 15,
  },
  chipLineActive: { color: "#fff", opacity: 0.95 },
  chipMeta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  chipNew: {
    width: 110,
    minHeight: 92,
    borderStyle: "dashed",
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  chipNewActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderStyle: "solid",
  },
  chipNewText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 12,
  },
});
