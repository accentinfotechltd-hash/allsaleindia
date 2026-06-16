import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronLeft, X } from "lucide-react-native";
import React, { useEffect, useState } from "react";
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

import StarRating from "@/src/components/StarRating";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";
import { useToast } from "@/src/components/UiOverlayProvider";

const RATING_LABELS: Record<number, string> = {
  1: "Terrible",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

const MAX_PHOTOS = 6;

export default function WriteReviewScreen() {
  const { show } = useToast();
  const router = useRouter();
  const { product_id, order_id, product_name, product_image } =
    useLocalSearchParams<{
      product_id: string;
      order_id: string;
      product_name?: string;
      product_image?: string;
    }>();

  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!product_id || !order_id) {
      show({ title: "Missing info", message: "We couldn't load the review form.", kind: "error" });
      router.back();
    }
  }, [product_id, order_id]);

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        show({ title: "Permission needed", message: "Allow photo library access to attach review photos.", kind: "error" });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, MAX_PHOTOS - photos.length),
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      const newPhotos = (result.assets || [])
        .map((a) =>
          a.base64 ? `data:${a.mimeType || "image/jpeg"};base64,${a.base64}` : null,
        )
        .filter((p): p is string => Boolean(p));
      setPhotos((prev) => [...prev, ...newPhotos].slice(0, MAX_PHOTOS));
    } catch (e: any) {
      show({ title: "Couldn't add photo", message: e?.message || "Please try again.", kind: "error" });
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (rating === 0) {
      show({ title: "Pick a rating", message: "Tap the stars to rate this product.", kind: "error" });
      return;
    }
    if (comment.trim().length < 5) {
      show({ title: "Tell us more", message: "Please add a short comment (at least 5 characters) about your experience.", kind: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await api("/reviews", {
        method: "POST",
        body: {
          order_id,
          product_id,
          rating,
          title: title.trim() || undefined,
          comment: comment.trim(),
          photos,
        },
      });
      Alert.alert("Thanks for your review! ⭐", "It's live now.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e: any) {
      show({ title: "Couldn't submit", message: e?.message || "Please try again.", kind: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable
          testID="write-review-back"
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Write a review</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          {product_image ? (
            <View style={styles.productCard}>
              <Image source={{ uri: product_image }} style={styles.productImg} />
              <View style={{ flex: 1 }}>
                <Text style={styles.productName} numberOfLines={2}>
                  {product_name || "Product"}
                </Text>
                <Text style={styles.verifiedBadge}>✓ Verified purchase</Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.label}>Your rating</Text>
          <View style={styles.ratingPicker}>
            <StarRating
              value={rating}
              onChange={setRating}
              size={36}
              testID="write-review-stars"
            />
            <Text style={styles.ratingLabel}>
              {rating > 0 ? RATING_LABELS[rating] : "Tap to rate"}
            </Text>
          </View>

          <Text style={styles.label}>Title (optional)</Text>
          <TextInput
            testID="write-review-title"
            placeholder="Sum it up in a few words"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <Text style={styles.label}>Your review</Text>
          <TextInput
            testID="write-review-comment"
            placeholder="What did you like? What could be better? Was the quality and fit as expected?"
            value={comment}
            onChangeText={setComment}
            maxLength={2000}
            multiline
            textAlignVertical="top"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.textarea]}
          />
          <Text style={styles.charCount}>{comment.length}/2000</Text>

          <Text style={styles.label}>
            Photos <Text style={styles.optional}>(optional, up to {MAX_PHOTOS})</Text>
          </Text>
          <View style={styles.photoGrid}>
            {photos.map((p, i) => (
              <View key={i} style={styles.thumbWrap}>
                <Image source={{ uri: p }} style={styles.thumb} />
                <Pressable
                  onPress={() => removePhoto(i)}
                  style={styles.thumbRemove}
                  testID={`write-review-photo-remove-${i}`}
                >
                  <X size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_PHOTOS ? (
              <Pressable
                testID="write-review-add-photo"
                onPress={pickPhoto}
                style={({ pressed }) => [
                  styles.addPhoto,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Camera size={20} color={colors.primary} />
                <Text style={styles.addPhotoText}>Add</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>

        <SafeAreaView edges={["bottom"]} style={styles.bottomBar}>
          <Pressable
            disabled={submitting}
            onPress={submit}
            testID="write-review-submit"
            style={({ pressed }) => [
              styles.cta,
              pressed && { transform: [{ scale: 0.98 }] },
              submitting && { opacity: 0.7 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Post review</Text>
            )}
          </Pressable>
        </SafeAreaView>
      </KeyboardAvoidingView>
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
  },
  backBtn: {
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
  productCard: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  productImg: { width: 56, height: 56, borderRadius: radius.sm },
  productName: { fontWeight: "700", color: colors.text, fontSize: 14 },
  verifiedBadge: {
    marginTop: 4,
    color: colors.success,
    fontWeight: "700",
    fontSize: 12,
  },
  label: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    color: colors.text,
    fontWeight: "800",
    fontSize: 14,
  },
  optional: { color: colors.textMuted, fontWeight: "500" },
  ratingPicker: { alignItems: "center", gap: 6, paddingVertical: spacing.sm },
  ratingLabel: {
    marginTop: 4,
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: colors.text,
    fontSize: 15,
  },
  textarea: { minHeight: 120, paddingTop: 12 },
  charCount: {
    alignSelf: "flex-end",
    marginTop: 4,
    color: colors.textFaint,
    fontSize: 11,
  },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { width: 80, height: 80, position: "relative" },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: colors.primarySoft,
  },
  addPhotoText: { color: colors.primary, fontWeight: "700", fontSize: 12 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
