import { MapPin, Search, X } from "lucide-react-native";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

export type ResolvedAddress = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;        // ISO-2
  formatted: string;
  lat?: number | null;
  lng?: number | null;
};

type Props = {
  label?: string;
  testID?: string;
  initialValue?: string;
  /** ISO-2 country code to bias suggestions (optional). */
  country?: string;
  onResolved: (addr: ResolvedAddress) => void;
  /** Fires on every keystroke so the parent can mirror the raw line1. */
  onChangeText?: (text: string) => void;
};

type Suggestion = {
  place_id: string;
  primary_text: string;
  secondary_text: string;
  description: string;
};

/** Tiny non-crypto session-token generator. Google uses this to bill
 * autocomplete + a single details call as one "session". */
function makeSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Google Places-powered address autocomplete input.
 *
 *   • Debounces user input by 250ms.
 *   • Calls the server-side proxy (`/geo/places/autocomplete`) — key never
 *     ships to the device.
 *   • On select, calls `/geo/places/details` and emits a normalised address
 *     object (line1, city, region, postal_code, ISO-2 country, lat/lng).
 *   • Session token is generated once per "input session" and rotated after
 *     each successful resolve to keep billing at the optimal tier.
 */
export default function PlacesAutocomplete({
  label = "Street address",
  testID = "places-autocomplete",
  initialValue = "",
  country,
  onResolved,
  onChangeText,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionToken = useRef<string>(makeSessionToken());
  // Latch the latest accepted suggestion so we suppress re-querying after pick.
  const justResolved = useRef(false);

  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
  }, []);

  const queryParam = useMemo(() => {
    return country ? `&country=${encodeURIComponent(country.toLowerCase())}` : "";
  }, [country]);

  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (q.trim().length < 3) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const resp = await api<{ results: Suggestion[] }>(
          `/geo/places/autocomplete?q=${encodeURIComponent(q.trim())}&session_token=${sessionToken.current}${queryParam}`,
        );
        setSuggestions(resp.results || []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [queryParam],
  );

  const onChange = (text: string) => {
    setValue(text);
    onChangeText?.(text);
    if (justResolved.current) {
      // Skip the auto-query that the resolved value would trigger.
      justResolved.current = false;
      return;
    }
    setOpen(true);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => fetchSuggestions(text), 250);
  };

  const onPick = async (s: Suggestion) => {
    Keyboard.dismiss();
    setOpen(false);
    setResolving(true);
    try {
      const resp = await api<{
        place_id: string;
        formatted_address: string;
        address: Omit<ResolvedAddress, "formatted" | "lat" | "lng">;
        lat?: number | null;
        lng?: number | null;
      }>(
        `/geo/places/details?place_id=${encodeURIComponent(s.place_id)}&session_token=${sessionToken.current}`,
      );
      const resolved: ResolvedAddress = {
        ...resp.address,
        formatted: resp.formatted_address,
        lat: resp.lat ?? null,
        lng: resp.lng ?? null,
      };
      const displayLine1 = resolved.line1 || s.primary_text || s.description;
      justResolved.current = true;
      setValue(displayLine1);
      setSuggestions([]);
      onResolved(resolved);
    } catch {
      // Bubble silently — caller can fall back to manual entry.
    } finally {
      setResolving(false);
      // Rotate the token — next typing session is billed separately.
      sessionToken.current = makeSessionToken();
    }
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <Search size={14} color={colors.textMuted} style={{ marginRight: 6 }} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => value.length >= 3 && setOpen(true)}
          placeholder="Start typing your street…"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="words"
          testID={`${testID}-input`}
        />
        {resolving ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : value ? (
          <Pressable
            onPress={() => {
              setValue("");
              setSuggestions([]);
              setOpen(false);
              onChangeText?.("");
            }}
            hitSlop={8}
            testID={`${testID}-clear`}
          >
            <X size={14} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {open && (suggestions.length > 0 || loading) ? (
        <View style={styles.dropdown}>
          {loading ? (
            <View style={styles.suggestionRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>Searching…</Text>
            </View>
          ) : (
            suggestions.map((s) => (
              <Pressable
                key={s.place_id}
                testID={`${testID}-suggestion-${s.place_id.slice(0, 12)}`}
                onPress={() => onPick(s)}
                style={({ pressed }) => [
                  styles.suggestionRow,
                  pressed && { backgroundColor: colors.surface },
                ]}
              >
                <MapPin size={14} color={colors.primary} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.primaryText} numberOfLines={1}>
                    {s.primary_text || s.description}
                  </Text>
                  {s.secondary_text ? (
                    <Text style={styles.secondaryText} numberOfLines={1}>
                      {s.secondary_text}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, position: "relative" },
  label: { fontSize: 12, fontWeight: "600", color: colors.text, marginBottom: 6 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    backgroundColor: "#fff",
    gap: 6,
  },
  input: { flex: 1, fontSize: 14, color: colors.text },
  dropdown: {
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "flex-start",
  },
  primaryText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  secondaryText: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  loadingText: { color: colors.textMuted, fontSize: 12 },
});
