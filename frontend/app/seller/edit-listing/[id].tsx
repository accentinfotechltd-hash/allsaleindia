import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronLeft, Image as ImageIcon, Plus, X } from "lucide-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const MAX_PHOTOS = 10;

type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  price_nzd: number;
  image: string;
  images?: string[];
  colors: string[];
  sizes: string[];
  stock_count: number;
};

export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priceNzd, setPriceNzd] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [colorsList, setColorsList] = useState<string[]>([]);
  const [colorDraft, setColorDraft] = useState("");
  const [sizesList, setSizesList] = useState<string[]>([]);
  const [sizeDraft, setSizeDraft] = useState("");
  const [stockCount, setStockCount] = useState("0");

  useEffect(() => {
    (async () => {
      if (!id) return;
      try {
        const p = await api<Product>(`/products/${id}`, { auth: false });
        setName(p.name);
        setDescription(p.description);
        setCategory(p.category);
        setPriceNzd(String(p.price_nzd));
        setColorsList(p.colors || []);
        setSizesList(p.sizes || []);
        setStockCount(String(p.stock_count ?? 0));
        const imgs = (p.images && p.images.length > 0) ? p.images : (p.image ? [p.image] : []);
        setPhotos(imgs);
      } catch (e: any) {
        setErr(e?.message || "Failed to load listing");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const pickPhotos = useCallback(async () => {
    if (photos.length >= MAX_PHOTOS) return;
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const remaining = MAX_PHOTOS - photos.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      for (const a of result.assets) {
        if (!a.base64) continue;
        const mime = a.mimeType || "image/jpeg";
        const dataUri = `data:${mime};base64,${a.base64}`;
        try {
          const res = await api<{ url: string }>("/uploads/image", {
            method: "POST",
            body: { data: dataUri },
          });
          setPhotos((prev) => [...prev, res.url].slice(0, MAX_PHOTOS));
        } catch {
          setPhotos((prev) => [...prev, dataUri].slice(0, MAX_PHOTOS));
        }
      }
    } catch (e: any) {
      toast.show({ title: "Couldn't open photos", body: e?.message || "Try again.", kind: "error" });
    } finally {
      setPicking(false);
    }
  }, [photos.length]);

  const takePhoto = useCallback(async () => {
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
        const res = await api<{ url: string }>("/uploads/image", {
          method: "POST",
          body: { data: dataUri },
        });
        setPhotos((prev) => [...prev, res.url].slice(0, MAX_PHOTOS));
      } catch {
        setPhotos((prev) => [...prev, dataUri].slice(0, MAX_PHOTOS));
      }
    } finally {
      setPicking(false);
    }
  }, [photos.length]);

  const removePhoto = (idx: number) => setPhotos(photos.filter((_, i) => i !== idx));
  const addColor = () => {
    const v = colorDraft.trim();
    if (!v) return;
    if (colorsList.find((c) => c.toLowerCase() === v.toLowerCase())) { setColorDraft(""); return; }
    if (colorsList.length >= 10) return;
    setColorsList([...colorsList, v]); setColorDraft("");
  };
  const removeColor = (c: string) => setColorsList(colorsList.filter((x) => x !== c));
  const addSize = () => {
    const v = sizeDraft.trim();
    if (!v) return;
    if (sizesList.find((s) => s.toLowerCase() === v.toLowerCase())) { setSizeDraft(""); return; }
    if (sizesList.length >= 12) return;
    setSizesList([...sizesList, v]); setSizeDraft("");
  };
  const removeSize = (s: string) => setSizesList(sizesList.filter((x) => x !== s));

  const save = async () => {
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
      setErr("At least one product photo is required");
      return;
    }
    const stock = Math.max(0, parseInt(stockCount, 10) || 0);
    setBusy(true);
    try {
      await api(`/seller/products/${id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          description: description.trim(),
          category,
          price_nzd: price,
          images: photos,
          colors: colorsList,
          sizes: sizesList,
          stock_count: stock,
        },
      });
      toast.show({ title: "Listing updated", body: "Your changes are now live.", kind: "success" });
      router.back();
    } catch (e: any) {
      setErr(e?.message || "Could not save changes");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="edit-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Edit listing</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Product photos ({photos.length}/{MAX_PHOTOS})</Text>
          <Text style={styles.hint}>First photo is the cover.</Text>
          <View style={styles.photoGrid}>
            {photos.map((uri, idx) => (
              <View key={`${idx}-${uri.slice(0, 16)}`} style={styles.photoTile} testID={`edit-photo-${idx}`}>
                <Image source={{ uri }} style={styles.photoTileImg} />
                {idx === 0 ? <View style={styles.coverBadge}><Text style={styles.coverBadgeText}>Cover</Text></View> : null}
                <Pressable testID={`edit-photo-remove-${idx}`} onPress={() => removePhoto(idx)} style={styles.photoRemove} hitSlop={6}>
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable testID="edit-photo-add" onPress={pickPhotos} disabled={picking} style={({ pressed }) => [styles.photoTile, styles.photoAddTile, pressed && { opacity: 0.85 }]}>
                {picking ? <ActivityIndicator color={colors.primary} /> : (<><ImageIcon size={22} color={colors.primary} /><Text style={styles.photoAddText}>Gallery</Text></>)}
              </Pressable>
            ) : null}
            {photos.length < MAX_PHOTOS && Platform.OS !== "web" ? (
              <Pressable testID="edit-photo-camera" onPress={takePhoto} disabled={picking} style={({ pressed }) => [styles.photoTile, styles.photoAddTile, pressed && { opacity: 0.85 }]}>
                <Camera size={22} color={colors.primary} />
                <Text style={styles.photoAddText}>Camera</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.label}>Product name</Text>
          <TextInput testID="edit-name" value={name} onChangeText={setName} style={styles.input} />

          <Text style={styles.label}>Description</Text>
          <TextInput testID="edit-description" value={description} onChangeText={setDescription} multiline style={[styles.input, { minHeight: 88, textAlignVertical: "top" }]} />

          <Text style={styles.label}>Category</Text>
          <TextInput testID="edit-category" value={category} onChangeText={setCategory} style={styles.input} />

          <Text style={styles.label}>Price (NZD)</Text>
          <TextInput testID="edit-price" value={priceNzd} onChangeText={setPriceNzd} keyboardType="decimal-pad" style={styles.input} />

          <Text style={styles.label}>Stock count</Text>
          <TextInput testID="edit-stock" value={stockCount} onChangeText={setStockCount} keyboardType="decimal-pad" style={styles.input} />
          {parseInt(stockCount, 10) === 0 ? (
            <Text style={styles.hint}>0 stock = buyers see this as &ldquo;Out of stock&rdquo;.</Text>
          ) : null}

          <Text style={styles.label}>Colors</Text>
          <View style={styles.tokenRow}>
            <TextInput testID="edit-color-input" value={colorDraft} onChangeText={setColorDraft} placeholder="e.g. Indigo" placeholderTextColor={colors.textFaint} onSubmitEditing={addColor} returnKeyType="done" style={[styles.input, { flex: 1 }]} />
            <Pressable testID="edit-color-add" onPress={addColor} style={styles.addBtn}><Plus size={16} color="#fff" /></Pressable>
          </View>
          {colorsList.length > 0 ? (
            <View style={styles.chips}>
              {colorsList.map((c) => (
                <View key={c} style={styles.tokenChip}>
                  <Text style={styles.tokenChipText}>{c}</Text>
                  <Pressable onPress={() => removeColor(c)} hitSlop={8}><X size={14} color={colors.text} /></Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.label}>Sizes</Text>
          <View style={styles.tokenRow}>
            <TextInput testID="edit-size-input" value={sizeDraft} onChangeText={setSizeDraft} placeholder="e.g. S, M, L" placeholderTextColor={colors.textFaint} onSubmitEditing={addSize} returnKeyType="done" style={[styles.input, { flex: 1 }]} />
            <Pressable testID="edit-size-add" onPress={addSize} style={styles.addBtn}><Plus size={16} color="#fff" /></Pressable>
          </View>
          {sizesList.length > 0 ? (
            <View style={styles.chips}>
              {sizesList.map((s) => (
                <View key={s} style={styles.tokenChip}>
                  <Text style={styles.tokenChipText}>{s}</Text>
                  <Pressable onPress={() => removeSize(s)} hitSlop={8}><X size={14} color={colors.text} /></Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {err ? <Text style={styles.error}>{err}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable testID="edit-save-btn" disabled={busy} onPress={save} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }, busy && { opacity: 0.6 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save changes</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "800", color: colors.text },
  label: { marginTop: spacing.md, marginBottom: 6, fontSize: 12, fontWeight: "800", color: colors.text, letterSpacing: 0.4 },
  hint: { fontSize: 11, color: colors.textFaint, marginBottom: spacing.sm },
  input: { backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border },
  tokenRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.text, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tokenChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.primarySoft },
  tokenChipText: { fontSize: 12, color: colors.text, fontWeight: "700" },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoTile: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surface, overflow: "hidden", position: "relative" },
  photoTileImg: { width: "100%", height: "100%" },
  photoAddTile: { borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary, alignItems: "center", justifyContent: "center", gap: 4 },
  photoAddText: { fontSize: 11, fontWeight: "700", color: colors.primary },
  photoRemove: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  coverBadge: { position: "absolute", bottom: 4, left: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.7)" },
  coverBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.md },
  footer: { padding: spacing.md, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  saveBtn: { height: 52, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
