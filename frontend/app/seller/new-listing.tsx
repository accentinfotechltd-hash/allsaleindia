import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronLeft, Image as ImageIcon, Plus, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
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
import { useToast } from "@/src/components/UiOverlayProvider";

const MAX_PHOTOS = 10;
const DEFAULT_CATEGORIES = ["Ethnic Wear", "Home & Decor", "Spices & Tea", "Jewelry", "Beauty", "Electronics"];

export default function NewListing() {
  const { show } = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [priceNzd, setPriceNzd] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(false);

  // New: colors, sizes, stock
  const [colorsList, setColorsList] = useState<string[]>([]);
  const [colorDraft, setColorDraft] = useState("");
  const [sizesList, setSizesList] = useState<string[]>([]);
  const [sizeDraft, setSizeDraft] = useState("");
  const [stockCount, setStockCount] = useState("25");

  const pickPhotos = async () => {
    if (photos.length >= MAX_PHOTOS) {
      show({ title: "Photo limit reached", message: `You can add up to ${MAX_PHOTOS} photos per listing.`, kind: "error" });
      return;
    }
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          show({ title: "Photos permission needed", message: "Open Settings to allow photo access so you can upload product images.", kind: "error" });
        }
        return;
      }
      const remaining = MAX_PHOTOS - photos.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      // Upload each picked image to Cloudinary via our backend, then
      // store the returned secure URL. We show the data URI immediately
      // for snappy UI feedback, then swap it for the CDN URL on success.
      for (const a of result.assets) {
        if (!a.base64) continue;
        const mime = a.mimeType || "image/jpeg";
        const dataUri = `data:${mime};base64,${a.base64}`;
        try {
          const res = await api<{ url: string; provider: string }>("/uploads/image", {
            method: "POST",
            body: { data: dataUri },
          });
          setPhotos((prev) => [...prev, res.url].slice(0, MAX_PHOTOS));
        } catch (e: any) {
          // Fall back to local data URI so the form is not dead-ended.
          setPhotos((prev) => [...prev, dataUri].slice(0, MAX_PHOTOS));
          show({ title: "Upload warning", message: e?.message || "Upload failed; using local copy.", kind: "error" });
        }
      }
    } catch (e: any) {
      show({ title: "Couldn't open photos", message: e?.message || "Try again.", kind: "error" });
    } finally {
      setPicking(false);
    }
  };

  const takePhoto = async () => {
    if (photos.length >= MAX_PHOTOS) return;
    setPicking(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      const a = result.assets[0];
      if (!a?.base64) return;
      const mime = a.mimeType || "image/jpeg";
      const dataUri = `data:${mime};base64,${a.base64}`;
      try {
        const res = await api<{ url: string; provider: string }>("/uploads/image", {
          method: "POST",
          body: { data: dataUri },
        });
        setPhotos((prev) => [...prev, res.url].slice(0, MAX_PHOTOS));
      } catch (e: any) {
        setPhotos((prev) => [...prev, dataUri].slice(0, MAX_PHOTOS));
        show({ title: "Upload warning", message: e?.message || "Upload failed; using local copy.", kind: "error" });
      }
    } catch (e: any) {
      show({ title: "Couldn't open camera", message: e?.message || "Try again.", kind: "error" });
    } finally {
      setPicking(false);
    }
  };

  const removePhoto = (idx: number) => setPhotos(photos.filter((_, i) => i !== idx));

  const addColor = () => {
    const v = colorDraft.trim();
    if (!v) return;
    if (colorsList.find((c) => c.toLowerCase() === v.toLowerCase())) {
      setColorDraft("");
      return;
    }
    if (colorsList.length >= 10) return;
    setColorsList([...colorsList, v]);
    setColorDraft("");
  };
  const removeColor = (c: string) => setColorsList(colorsList.filter((x) => x !== c));

  const addSize = () => {
    const v = sizeDraft.trim();
    if (!v) return;
    if (sizesList.find((s) => s.toLowerCase() === v.toLowerCase())) {
      setSizeDraft("");
      return;
    }
    if (sizesList.length >= 12) return;
    setSizesList([...sizesList, v]);
    setSizeDraft("");
  };
  const removeSize = (s: string) => setSizesList(sizesList.filter((x) => x !== s));

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
    if (!name.trim() || description.trim().length < 10) {
      setErr("Name and description (10+ chars) are required");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setErr("Enter a valid price in NZD");
      return;
    }
    if (photos.length === 0) {
      setErr("Please add at least one product photo.");
      return;
    }
    setBusy(true);
    try {
      const stock = Math.max(0, parseInt(stockCount, 10) || 0);
      await api("/seller/products", {
        method: "POST",
        body: {
          name: name.trim(),
          description: description.trim(),
          category,
          price_nzd: price,
          images: photos,
          image: photos[0],
          colors: colorsList,
          sizes: sizesList,
          stock_count: stock,
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
          <Text style={styles.label}>Product photos ({photos.length}/{MAX_PHOTOS})</Text>
          <Text style={styles.photoHint}>
            First photo is the cover. Add up to {MAX_PHOTOS} photos.
          </Text>
          <View style={styles.photoGrid}>
            {photos.map((uri, idx) => (
              <View key={`${idx}-${uri.slice(0, 16)}`} style={styles.photoTile} testID={`new-listing-photo-${idx}`}>
                <Image source={{ uri }} style={styles.photoTileImg} />
                {idx === 0 ? (
                  <View style={styles.coverBadge}>
                    <Text style={styles.coverBadgeText}>Cover</Text>
                  </View>
                ) : null}
                <Pressable
                  testID={`new-listing-photo-remove-${idx}`}
                  onPress={() => removePhoto(idx)}
                  style={styles.photoRemove}
                  hitSlop={6}
                >
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable
                testID="new-listing-photo-add"
                onPress={pickPhotos}
                disabled={picking}
                style={({ pressed }) => [
                  styles.photoTile,
                  styles.photoAddTile,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {picking ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <ImageIcon size={22} color={colors.primary} />
                    <Text style={styles.photoAddText}>Gallery</Text>
                  </>
                )}
              </Pressable>
            ) : null}
            {photos.length < MAX_PHOTOS && Platform.OS !== "web" ? (
              <Pressable
                testID="new-listing-photo-camera"
                onPress={takePhoto}
                disabled={picking}
                style={({ pressed }) => [
                  styles.photoTile,
                  styles.photoAddTile,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Camera size={22} color={colors.primary} />
                <Text style={styles.photoAddText}>Camera</Text>
              </Pressable>
            ) : null}
          </View>

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

          <Field
            label="Stock count"
            testID="new-listing-stock"
            value={stockCount}
            onChangeText={setStockCount}
            placeholder="25"
            keyboardType="decimal-pad"
          />
          {parseInt(stockCount, 10) === 0 ? (
            <Text style={styles.stockHint}>
              0 stock means buyers will see this as &ldquo;Out of stock&rdquo;.
            </Text>
          ) : null}

          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>Colors available</Text>
            <View style={styles.tokenRow}>
              <TextInput
                testID="new-listing-color-input"
                value={colorDraft}
                onChangeText={setColorDraft}
                placeholder="e.g. Indigo"
                placeholderTextColor={colors.textFaint}
                onSubmitEditing={addColor}
                returnKeyType="done"
                style={[styles.input, { flex: 1 }]}
              />
              <Pressable
                testID="new-listing-color-add"
                onPress={addColor}
                style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
              >
                <Plus size={16} color="#fff" />
              </Pressable>
            </View>
            {colorsList.length > 0 ? (
              <View style={[styles.chipsRow, { marginTop: 8, paddingHorizontal: 0, flexWrap: "wrap" }]}>
                {colorsList.map((c) => (
                  <View key={c} style={styles.tokenChip} testID={`new-listing-color-token-${c.toLowerCase().replace(/\s/g, "-")}`}>
                    <Text style={styles.tokenChipText}>{c}</Text>
                    <Pressable onPress={() => removeColor(c)} hitSlop={8}>
                      <X size={14} color={colors.text} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.stockHint}>Optional. Up to 10 colors.</Text>
            )}
          </View>

          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>Sizes available</Text>
            <View style={styles.tokenRow}>
              <TextInput
                testID="new-listing-size-input"
                value={sizeDraft}
                onChangeText={setSizeDraft}
                placeholder="e.g. S, M, L, XL or Free Size"
                placeholderTextColor={colors.textFaint}
                onSubmitEditing={addSize}
                returnKeyType="done"
                style={[styles.input, { flex: 1 }]}
              />
              <Pressable
                testID="new-listing-size-add"
                onPress={addSize}
                style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
              >
                <Plus size={16} color="#fff" />
              </Pressable>
            </View>
            {sizesList.length > 0 ? (
              <View style={[styles.chipsRow, { marginTop: 8, paddingHorizontal: 0, flexWrap: "wrap" }]}>
                {sizesList.map((s) => (
                  <View key={s} style={styles.tokenChip} testID={`new-listing-size-token-${s.toLowerCase().replace(/\s/g, "-")}`}>
                    <Text style={styles.tokenChipText}>{s}</Text>
                    <Pressable onPress={() => removeSize(s)} hitSlop={8}>
                      <X size={14} color={colors.text} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.stockHint}>Optional. Leave empty for one-size items.</Text>
            )}
          </View>

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
  tokenRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
  tokenChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
  },
  tokenChipText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  stockHint: { fontSize: 11, color: colors.textFaint, marginTop: -spacing.sm, marginBottom: spacing.md },
  photoHint: { fontSize: 11, color: colors.textFaint, marginTop: -spacing.sm, marginBottom: spacing.sm },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  photoTile: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
    position: "relative",
  },
  photoTileImg: { width: "100%", height: "100%" },
  photoAddTile: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  photoAddText: { fontSize: 11, fontWeight: "700", color: colors.primary },
  photoRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  coverBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  coverBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
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
