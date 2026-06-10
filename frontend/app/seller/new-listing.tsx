import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
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

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

const DEFAULT_CATEGORIES = ["Ethnic Wear", "Home & Decor", "Spices & Tea", "Jewelry", "Beauty", "Electronics"];

export default function NewListing() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [priceNzd, setPriceNzd] = useState("");
  const [image, setImage] = useState("");
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const list = await api<string[]>("/categories", { auth: false });
        const merged = Array.from(new Set([...list, ...DEFAULT_CATEGORIES]));
        setCategories(merged);
      } catch {
        // ignored
      }
    })();
  }, []);

  const submit = async () => {
    setErr("");
    const price = parseFloat(priceNzd);
    if (!name.trim() || description.trim().length < 10 || !image.trim()) {
      setErr("Name, description (10+ chars) and image URL are required");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setErr("Enter a valid price in NZD");
      return;
    }
    setBusy(true);
    try {
      await api("/seller/products", {
        method: "POST",
        body: {
          name: name.trim(),
          description: description.trim(),
          category,
          price_nzd: price,
          image: image.trim(),
        },
      });
      router.replace("/seller/dashboard");
    } catch (e: any) {
      setErr(e?.message || "Could not create listing");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable testID="new-listing-back" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>New listing</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {image.trim() ? (
            <View style={styles.preview}>
              <Image source={{ uri: image.trim() }} style={styles.previewImg} />
            </View>
          ) : null}

          <Field
            label="Image URL"
            testID="new-listing-image"
            value={image}
            onChangeText={setImage}
            placeholder="https://..."
            autoCapitalize="none"
          />
          <Field label="Product name" testID="new-listing-name" value={name} onChangeText={setName} placeholder="e.g. Handmade Brass Lamp" />

          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {categories.map((c) => {
              const active = c === category;
              return (
                <Pressable
                  key={c}
                  testID={`new-listing-cat-${c.toLowerCase().replace(/\s+/g, "-")}`}
                  onPress={() => setCategory(c)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Field
            label="Price (NZD)"
            testID="new-listing-price"
            value={priceNzd}
            onChangeText={setPriceNzd}
            placeholder="49.00"
            keyboardType="decimal-pad"
          />

          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              testID="new-listing-description"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              style={[styles.input, { height: 120, paddingTop: 12, textAlignVertical: "top" }]}
              placeholder="Tell buyers about materials, dimensions, what makes it special."
              placeholderTextColor={colors.textFaint}
            />
          </View>

          {err ? <Text style={styles.error} testID="new-listing-error">{err}</Text> : null}

          <Pressable
            testID="new-listing-submit-btn"
            disabled={busy}
            onPress={submit}
            style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.98 }] }, busy && { opacity: 0.7 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>Publish listing</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  testID,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  testID: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words";
  keyboardType?: "default" | "decimal-pad";
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCapitalize={autoCapitalize || "sentences"}
        keyboardType={keyboardType || "default"}
        style={styles.input}
      />
    </View>
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
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  preview: {
    aspectRatio: 1.5,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  previewImg: { width: "100%", height: "100%" },
  label: { fontSize: 12, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 14,
    color: colors.text,
    backgroundColor: "#fff",
  },
  chipsRow: { gap: 8, paddingBottom: spacing.md },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
  cta: {
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
