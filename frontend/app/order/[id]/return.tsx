import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Film,
  ImagePlus,
  PackageX,
  Play,
  Sparkles,
  ThumbsDown,
  X,
  XCircle,
} from "lucide-react-native";
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
import { colors, formatNZD, radius, spacing } from "@/src/lib/theme";

type Order = {
  id: string;
  status: string;
  items: { product_id: string; name: string; image: string; price_nzd: number; quantity: number }[];
  return_window_until?: string;
};

const REASONS: { value: string; label: string; sub: string; sellerPays: boolean; Icon: any }[] = [
  {
    value: "damaged_on_arrival",
    label: "Damaged on arrival",
    sub: "Item arrived broken or visibly damaged",
    sellerPays: true,
    Icon: PackageX,
  },
  {
    value: "wrong_item",
    label: "Wrong item received",
    sub: "You received something different than ordered",
    sellerPays: true,
    Icon: AlertCircle,
  },
  {
    value: "not_as_described",
    label: "Not as described",
    sub: "Item doesn't match the listing details",
    sellerPays: true,
    Icon: ThumbsDown,
  },
  {
    value: "defective",
    label: "Defective / not working",
    sub: "Item doesn't function as intended",
    sellerPays: true,
    Icon: XCircle,
  },
  {
    value: "changed_my_mind",
    label: "Changed my mind",
    sub: "You pay return shipping + 15% restocking fee",
    sellerPays: false,
    Icon: Sparkles,
  },
];

export default function ReturnRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [reason, setReason] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]); // Cloudinary URLs
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const MAX_PHOTOS = 4;
  const MAX_VIDEO_SECONDS = 30;

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const o = await api<Order>(`/orders/${id}`);
      setOrder(o);
      // default: select all items
      setSelectedIds(o.items.map((i) => i.product_id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleItem = (pid: string) => {
    setSelectedIds((prev) =>
      prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]
    );
  };

  const pickPhoto = useCallback(async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert("Limit reached", `You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    // Request gallery permission first.
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      const ask = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!ask.granted) {
        Alert.alert(
          "Photos access needed",
          "Please allow photo library access in Settings to attach proof images.",
        );
        return;
      }
    } else if (!perm.granted) {
      Alert.alert(
        "Photos access needed",
        "Please allow photo library access in Settings to attach proof images.",
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsMultipleSelection: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const dataUri = asset.base64
      ? `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`
      : asset.uri;
    setUploadingPhoto(true);
    try {
      const uploaded = await api<{ url: string }>("/uploads/image", {
        method: "POST",
        body: { data: dataUri, folder: "allsale/returns" },
      });
      setPhotos((prev) => [...prev, uploaded.url]);
    } catch (e: any) {
      Alert.alert("Couldn't upload photo", e?.message || "Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  }, [photos]);

  const removePhoto = (idx: number) =>
    setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const pickVideo = useCallback(async () => {
    if (videoUrl) {
      Alert.alert("Only one video allowed", "Remove the current video to add a new one.");
      return;
    }
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      const ask = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!ask.granted) {
        Alert.alert(
          "Photos access needed",
          "Please allow photo library access in Settings to attach a proof video.",
        );
        return;
      }
    } else if (!perm.granted) {
      Alert.alert(
        "Photos access needed",
        "Please allow photo library access in Settings to attach a proof video.",
      );
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.6,
      base64: true,
      videoMaxDuration: MAX_VIDEO_SECONDS,
      allowsMultipleSelection: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    if (asset.duration && asset.duration / 1000 > MAX_VIDEO_SECONDS + 2) {
      Alert.alert(
        "Video too long",
        `Please keep proof clips under ${MAX_VIDEO_SECONDS} seconds.`,
      );
      return;
    }
    const dataUri = asset.base64
      ? `data:${asset.mimeType || "video/mp4"};base64,${asset.base64}`
      : asset.uri;
    setUploadingVideo(true);
    try {
      const uploaded = await api<{ url: string }>("/uploads/video", {
        method: "POST",
        body: { data: dataUri, folder: "allsale/returns" },
      });
      setVideoUrl(uploaded.url);
    } catch (e: any) {
      Alert.alert("Couldn't upload video", e?.message || "Please try again.");
    } finally {
      setUploadingVideo(false);
    }
  }, [videoUrl]);

  const submit = useCallback(async () => {
    if (!order || !reason) return;
    if (selectedIds.length === 0) {
      Alert.alert("Select items", "Please select at least one item to return.");
      return;
    }
    // Photo proof is required for seller-paid reasons.
    const requiresProof = reason !== "changed_my_mind";
    if (requiresProof && photos.length === 0) {
      Alert.alert(
        "Photo proof required",
        "Please attach at least one photo showing the issue with your item. This helps the seller approve your return faster.",
      );
      return;
    }
    setSubmitting(true);
    try {
      await api(`/returns/request`, {
        method: "POST",
        body: {
          order_id: order.id,
          reason,
          product_ids: selectedIds,
          note: note.trim() || undefined,
          photos,
          videos: videoUrl ? [videoUrl] : [],
        },
      });
      Alert.alert(
        "Return request submitted",
        "The seller has 48 hours to respond. You'll be notified the moment they do.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (e: any) {
      Alert.alert("Couldn't submit", e?.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [order, reason, selectedIds, note, photos, videoUrl, router]);

  const chosenReason = REASONS.find((r) => r.value === reason);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={{ color: colors.textMuted }}>Order not found.</Text>
      </SafeAreaView>
    );
  }
  if (order.status !== "delivered") {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Return request</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.notDelivered}>
            This order is not yet delivered. Returns are available within 7 days of delivery.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable testID="rtn-back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Return request</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl + 80 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.hero}>Why are you returning?</Text>
          <Text style={styles.heroSub}>
            Pick the closest match. Defective / damaged / wrong items are seller-paid; change of
            mind has a 15% restocking fee.
          </Text>

          <View style={styles.reasonsList}>
            {REASONS.map((r) => {
              const selected = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  testID={`rtn-reason-${r.value}`}
                  onPress={() => setReason(r.value)}
                  style={({ pressed }) => [
                    styles.reasonRow,
                    selected && styles.reasonRowSelected,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.reasonIcon, selected && { backgroundColor: colors.primary }]}>
                    <r.Icon size={16} color={selected ? "#fff" : colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reasonLabel}>{r.label}</Text>
                    <Text style={styles.reasonSub}>{r.sub}</Text>
                  </View>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <Check size={14} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>Items to return</Text>
          <View style={styles.itemsList}>
            {order.items.map((it) => {
              const checked = selectedIds.includes(it.product_id);
              return (
                <Pressable
                  key={it.product_id}
                  testID={`rtn-item-${it.product_id}`}
                  onPress={() => toggleItem(it.product_id)}
                  style={({ pressed }) => [styles.itemRow, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked ? <Check size={14} color="#fff" /> : null}
                  </View>
                  <Image source={{ uri: it.image }} style={styles.itemImg} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName} numberOfLines={2}>
                      {it.name}
                    </Text>
                    <Text style={styles.itemMeta}>
                      Qty {it.quantity} · {formatNZD(it.price_nzd * it.quantity)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.section}>
            Photo proof{" "}
            {reason && reason !== "changed_my_mind" ? (
              <Text style={styles.required}>*</Text>
            ) : (
              <Text style={styles.optional}> (optional)</Text>
            )}
          </Text>
          <Text style={styles.photosHint}>
            {reason && reason !== "changed_my_mind"
              ? "Attach 1–4 clear photos showing the issue. Sellers approve faster with good evidence."
              : "If you'd like to add context, you may attach up to 4 photos."}
          </Text>

          <View style={styles.photoRow}>
            {photos.map((url, idx) => (
              <View key={url + idx} style={styles.photoTile} testID={`rtn-photo-${idx}`}>
                <Image source={{ uri: url }} style={styles.photoImg} />
                <Pressable
                  testID={`rtn-photo-remove-${idx}`}
                  onPress={() => removePhoto(idx)}
                  style={styles.photoRemove}
                  hitSlop={8}
                >
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable
                testID="rtn-photo-add"
                onPress={pickPhoto}
                disabled={uploadingPhoto}
                style={({ pressed }) => [
                  styles.photoAdd,
                  pressed && { opacity: 0.85 },
                  uploadingPhoto && { opacity: 0.5 },
                ]}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <ImagePlus size={20} color={colors.primary} />
                    <Text style={styles.photoAddText}>
                      {photos.length === 0 ? "Add photo" : `Add (${photos.length}/${MAX_PHOTOS})`}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {/* Video tile (optional, max 1, 30s) */}
            {videoUrl ? (
              <View style={styles.photoTile} testID="rtn-video-tile">
                <View style={styles.videoPlaceholder}>
                  <Film size={20} color="#fff" />
                  <View style={styles.videoPlayBadge}>
                    <Play size={12} color="#fff" />
                  </View>
                </View>
                <Pressable
                  testID="rtn-video-remove"
                  onPress={() => setVideoUrl(null)}
                  style={styles.photoRemove}
                  hitSlop={8}
                >
                  <X size={12} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <Pressable
                testID="rtn-video-add"
                onPress={pickVideo}
                disabled={uploadingVideo}
                style={({ pressed }) => [
                  styles.photoAdd,
                  pressed && { opacity: 0.85 },
                  uploadingVideo && { opacity: 0.5 },
                ]}
              >
                {uploadingVideo ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Film size={20} color={colors.primary} />
                    <Text style={styles.photoAddText}>Add video</Text>
                    <Text style={styles.videoLimit}>≤ 30 sec</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>

          <Text style={styles.section}>Notes for the seller (optional)</Text>
          <TextInput
            testID="rtn-note-input"
            value={note}
            onChangeText={setNote}
            placeholder="Anything else the seller should know..."
            placeholderTextColor={colors.textFaint}
            maxLength={600}
            multiline
            style={styles.notesInput}
          />

          {chosenReason ? (
            <View
              testID="rtn-summary-card"
              style={[
                styles.summaryCard,
                chosenReason.sellerPays ? styles.summaryGood : styles.summaryWarn,
              ]}
            >
              <Text style={styles.summaryTitle}>
                {chosenReason.sellerPays ? "Seller-paid return" : "Buyer-paid return"}
              </Text>
              <Text style={styles.summaryBody}>
                {chosenReason.sellerPays
                  ? "Full refund. Allsale will send a prepaid return label to your NZ address."
                  : "You pay return shipping back to our NZ hub. A 15% restocking fee will be deducted from your refund."}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            testID="rtn-submit-btn"
            disabled={!reason || submitting}
            onPress={submit}
            style={({ pressed }) => [
              styles.submitBtn,
              (!reason || submitting) && { opacity: 0.5 },
              pressed && { opacity: 0.9 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit return request</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  notDelivered: { color: colors.textMuted, textAlign: "center" },
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
  hero: { fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  heroSub: { fontSize: 13, color: colors.textMuted, marginTop: 6, lineHeight: 19 },
  reasonsList: { marginTop: spacing.lg, gap: 8 },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  reasonRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  reasonIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  reasonLabel: { fontSize: 14, fontWeight: "700", color: colors.text },
  reasonSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  section: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  itemsList: { gap: 8 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  itemImg: { width: 50, height: 50, borderRadius: radius.sm, backgroundColor: colors.surface },
  itemName: { fontSize: 13, color: colors.text, fontWeight: "600" },
  itemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  notesInput: {
    minHeight: 88,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    textAlignVertical: "top",
    backgroundColor: "#fff",
  },
  required: { color: colors.error, fontWeight: "800" },
  optional: { color: colors.textMuted, fontWeight: "600", fontSize: 11 },
  photosHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 17 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoTile: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  photoImg: { width: "100%", height: "100%" },
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
  photoAdd: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: "dashed",
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  photoAddText: { fontSize: 10, color: colors.primary, fontWeight: "700" },
  videoPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  videoPlayBadge: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoLimit: { fontSize: 9, color: colors.textMuted, fontWeight: "600" },
  summaryCard: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg },
  summaryGood: { backgroundColor: colors.successSoft },
  summaryWarn: { backgroundColor: "#FEF3C7" },
  summaryTitle: { fontSize: 13, fontWeight: "800", color: colors.text },
  summaryBody: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  footer: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submitBtn: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
