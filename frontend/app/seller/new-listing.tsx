import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronLeft, Image as ImageIcon, Plus, Sparkles, X } from "lucide-react-native";
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
import { useTranslation } from "@/src/i18n";

const MAX_PHOTOS = 10;
const DEFAULT_CATEGORIES = ["Ethnic Wear", "Home & Decor", "Spices & Tea", "Jewelry", "Beauty", "Electronics"];

export default function NewListing() {
  const { show } = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [priceNzd, setPriceNzd] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  /**
   * Parallel array of original local URIs (file:// on native or
   * data:/blob: on web) for each picked photo. We use this — NOT the CDN
   * URLs in ``photos`` — as the source for "✨ AI fill from photos" so we
   * can re-read the original bytes as base64 even if expo-image-picker
   * didn't return base64 (which happens intermittently on Android).
   * Entries are kept aligned with ``photos`` by index.
   */
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [picking, setPicking] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  // New: colors, sizes, stock
  const [colorsList, setColorsList] = useState<string[]>([]);
  const [colorDraft, setColorDraft] = useState("");
  const [sizesList, setSizesList] = useState<string[]>([]);
  const [sizeDraft, setSizeDraft] = useState("");
  const [stockCount, setStockCount] = useState("25");

  const pickPhotos = async () => {
    if (photos.length >= MAX_PHOTOS) {
      show({ title: t("seller_new_listing.photo_limit_title"), message: t("seller_new_listing.photo_limit_msg", { max: MAX_PHOTOS }), kind: "error" });
      return;
    }
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) {
          show({ title: t("seller_new_listing.photos_perm_title"), message: t("seller_new_listing.photos_perm_msg"), kind: "error" });
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
        if (!a.base64 && !a.uri) continue;
        const mime = a.mimeType || "image/jpeg";
        const dataUri = a.base64 ? `data:${mime};base64,${a.base64}` : a.uri!;
        // Save the ORIGINAL local URI (or data URI fallback) for AI fill —
        // expo-image-picker on Android sometimes returns null base64, so we
        // read the file on demand later via FileSystem.
        const sourceUri = a.uri || dataUri;
        try {
          const res = await api<{ url: string; provider: string }>("/uploads/image", {
            method: "POST",
            body: { data: dataUri },
          });
          setPhotos((prev) => [...prev, res.url].slice(0, MAX_PHOTOS));
          setPhotoUris((prev) => [...prev, sourceUri].slice(0, MAX_PHOTOS));
        } catch (e: any) {
          // Fall back to local data URI so the form is not dead-ended.
          setPhotos((prev) => [...prev, dataUri].slice(0, MAX_PHOTOS));
          setPhotoUris((prev) => [...prev, sourceUri].slice(0, MAX_PHOTOS));
          show({ title: t("seller_new_listing.upload_warning_title"), message: e?.message || t("seller_new_listing.upload_warning_msg"), kind: "error" });
        }
      }
    } catch (e: any) {
      show({ title: t("seller_new_listing.couldnt_open_photos"), message: e?.message || t("seller_new_listing.try_again"), kind: "error" });
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
      if (!a?.base64 && !a?.uri) return;
      const mime = a.mimeType || "image/jpeg";
      const dataUri = a.base64 ? `data:${mime};base64,${a.base64}` : a.uri!;
      const sourceUri = a.uri || dataUri;
      try {
        const res = await api<{ url: string; provider: string }>("/uploads/image", {
          method: "POST",
          body: { data: dataUri },
        });
        setPhotos((prev) => [...prev, res.url].slice(0, MAX_PHOTOS));
        setPhotoUris((prev) => [...prev, sourceUri].slice(0, MAX_PHOTOS));
      } catch (e: any) {
        setPhotos((prev) => [...prev, dataUri].slice(0, MAX_PHOTOS));
        setPhotoUris((prev) => [...prev, sourceUri].slice(0, MAX_PHOTOS));
        show({ title: t("seller_new_listing.upload_warning_title"), message: e?.message || t("seller_new_listing.upload_warning_msg"), kind: "error" });
      }
    } catch (e: any) {
      show({ title: t("seller_new_listing.couldnt_open_camera"), message: e?.message || t("seller_new_listing.try_again"), kind: "error" });
    } finally {
      setPicking(false);
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos(photos.filter((_, i) => i !== idx));
    setPhotoUris((prev) => prev.filter((_, i) => i !== idx));
  };

  /**
   * One-tap AI fill: send the already-uploaded CDN photo URLs straight to
   * `/api/seller/products/ai-draft` — the backend fetches and base64-encodes
   * them. This is way more reliable than reading file:// URIs on Android
   * (which expo-file-system handles inconsistently across SDK versions).
   */
  const runAiFill = async () => {
    // Prefer CDN URLs (https) — they're already public and the backend
    // fetches them. Fall back to local URIs only if no CDN url exists yet.
    const sources: string[] = photos
      .map((p, i) => (p?.startsWith("http") ? p : photoUris[i] || p))
      .filter((s): s is string => !!s)
      .slice(0, 3);
    if (sources.length === 0) {
      show({
        title: "Add photos first",
        message: "Snap or pick 1-3 product photos and the AI will draft the listing for you.",
        kind: "info",
      });
      return;
    }
    setAiBusy(true);
    setErr("");
    try {
      const res = await api<{
        draft: {
          name: string;
          description: string;
          category: string;
          subcategory: string | null;
          bullets: string[];
          colors: string[];
          sizes: string[];
          materials: string[];
          suggested_price_inr: number | null;
          confidence: string;
          notes_for_seller: string;
        };
        model: string;
        took_ms: number;
      }>("/seller/products/ai-draft", {
        method: "POST",
        body: { images: sources, seller_hint: name || undefined },
      });
      const d = res.draft;
      // Only overwrite fields the seller hasn't already typed into.
      if (!name && d.name) setName(d.name);
      if (!description && d.description) setDescription(d.description);
      if (d.category && categories.includes(d.category)) setCategory(d.category);
      if (!priceNzd && d.suggested_price_inr) {
        setPriceNzd(String(Math.max(1, Math.round(d.suggested_price_inr / 51))));
      }
      if (colorsList.length === 0 && d.colors?.length) setColorsList(d.colors.slice(0, 10));
      if (sizesList.length === 0 && d.sizes?.length) setSizesList(d.sizes.slice(0, 12));
      show({
        title: "AI draft ready",
        message: `${d.confidence === "high" ? "High confidence" : "Review the fields"} — drafted in ${(res.took_ms / 1000).toFixed(1)}s`,
        kind: "success",
      });
    } catch (e: any) {
      show({
        title: "AI fill failed",
        message: e?.message || "Try again, or fill the form manually.",
        kind: "error",
      });
    } finally {
      setAiBusy(false);
    }
  };

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
      setErr(t("seller_new_listing.err_name_desc"));
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setErr(t("seller_new_listing.err_price"));
      return;
    }
    if (photos.length === 0) {
      setErr(t("seller_new_listing.err_photos"));
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
      setErr(e?.message || t("seller_new_listing.err_default"));
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
        <Text style={styles.title}>{t("seller_new_listing.title")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>{t("seller_new_listing.photos_label", { count: photos.length, max: MAX_PHOTOS })}</Text>
          <Text style={styles.photoHint}>
            {t("seller_new_listing.photos_hint", { max: MAX_PHOTOS })}
          </Text>
          <View style={styles.photoGrid}>
            {photos.map((uri, idx) => (
              <View key={`${idx}-${uri.slice(0, 16)}`} style={styles.photoTile} testID={`new-listing-photo-${idx}`}>
                <Image source={{ uri }} style={styles.photoTileImg} />
                {idx === 0 ? (
                  <View style={styles.coverBadge}>
                    <Text style={styles.coverBadgeText}>{t("seller_new_listing.cover_badge")}</Text>
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
                    <Text style={styles.photoAddText}>{t("seller_new_listing.photo_gallery")}</Text>
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
                <Text style={styles.photoAddText}>{t("seller_new_listing.photo_camera")}</Text>
              </Pressable>
            ) : null}
          </View>

          {/* AI auto-fill — shows the moment the seller has at least one
              photo, regardless of whether expo-image-picker returned base64
              (which it sometimes doesn't on Android). When tapped, we
              re-read the photo URIs as base64 via FileSystem/fetch. */}
          {photos.length > 0 ? (
            <Pressable
              testID="new-listing-ai-fill"
              onPress={runAiFill}
              disabled={aiBusy || busy}
              style={({ pressed }) => [
                styles.aiFillBtn,
                pressed && { opacity: 0.85 },
                (aiBusy || busy) && { opacity: 0.7 },
              ]}
            >
              {aiBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Sparkles size={18} color="#fff" />
                  <Text style={styles.aiFillBtnText}>
                    {photos.length === 1
                      ? "AI fill from photo"
                      : `AI fill from ${Math.min(photos.length, 3)} photos`}
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}

          <Field label={t("seller_new_listing.field_name")} testID="new-listing-name" value={name} onChangeText={setName} placeholder={t("seller_new_listing.name_placeholder")} />

          <Text style={styles.label}>{t("seller_new_listing.field_category")}</Text>
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
            label={t("seller_new_listing.field_price")}
            testID="new-listing-price"
            value={priceNzd}
            onChangeText={setPriceNzd}
            placeholder={t("seller_new_listing.price_placeholder")}
            keyboardType="decimal-pad"
          />

          <Field
            label={t("seller_new_listing.field_stock")}
            testID="new-listing-stock"
            value={stockCount}
            onChangeText={setStockCount}
            placeholder={t("seller_new_listing.stock_placeholder")}
            keyboardType="decimal-pad"
          />
          {parseInt(stockCount, 10) === 0 ? (
            <Text style={styles.stockHint}>
              {t("seller_new_listing.stock_oos_hint")}
            </Text>
          ) : null}

          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>{t("seller_new_listing.field_colors")}</Text>
            <View style={styles.tokenRow}>
              <TextInput
                testID="new-listing-color-input"
                value={colorDraft}
                onChangeText={setColorDraft}
                placeholder={t("seller_new_listing.color_placeholder")}
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
              <Text style={styles.stockHint}>{t("seller_new_listing.colors_hint")}</Text>
            )}
          </View>

          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>{t("seller_new_listing.field_sizes")}</Text>
            <View style={styles.tokenRow}>
              <TextInput
                testID="new-listing-size-input"
                value={sizeDraft}
                onChangeText={setSizeDraft}
                placeholder={t("seller_new_listing.size_placeholder")}
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
              <Text style={styles.stockHint}>{t("seller_new_listing.sizes_hint")}</Text>
            )}
          </View>

          <View style={{ marginBottom: spacing.md }}>
            <Text style={styles.label}>{t("seller_new_listing.field_description")}</Text>
            <TextInput
              testID="new-listing-description"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={5}
              style={[styles.input, { height: 120, paddingTop: 12, textAlignVertical: "top" }]}
              placeholder={t("seller_new_listing.description_placeholder")}
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
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{t("seller_new_listing.publish_btn")}</Text>}
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
  aiFillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#7B3FE4",
    height: 46,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  aiFillBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
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
