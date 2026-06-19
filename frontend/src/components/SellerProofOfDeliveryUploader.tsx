import * as ImagePicker from "expo-image-picker";
import { Camera, CheckCircle2, ImagePlus, X } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/src/lib/api";
import { useToast } from "@/src/components/UiOverlayProvider";
import { colors, radius, spacing } from "@/src/lib/theme";

type Props = {
  orderId: string;
  /** Show as a delivered-proof inline confirmation if already uploaded. */
  existingProofImage?: string | null;
  existingProofUploadedBy?: "carrier" | "seller" | null;
  onUploaded?: () => void;
};

export default function SellerProofOfDeliveryUploader({
  orderId,
  existingProofImage,
  existingProofUploadedBy,
  onUploaded,
}: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);

  const pickFromGallery = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        toast.show({
          title: "Permission needed",
          message: "Allow photo access to attach a delivery photo.",
          kind: "error",
        });
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
        allowsEditing: true,
        aspect: [4, 3],
      });
      if (!res.canceled && res.assets[0]?.base64) {
        const a = res.assets[0];
        const mime = a.mimeType || "image/jpeg";
        setPicked(`data:${mime};base64,${a.base64}`);
      }
    } catch (e: any) {
      toast.show({ title: "Couldn't open gallery", message: e?.message || "", kind: "error" });
    }
  }, [toast]);

  const pickFromCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== "granted") {
        toast.show({
          title: "Camera permission needed",
          message: "Allow camera access to take a delivery photo.",
          kind: "error",
        });
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        quality: 0.7,
        base64: true,
        allowsEditing: true,
        aspect: [4, 3],
      });
      if (!res.canceled && res.assets[0]?.base64) {
        const a = res.assets[0];
        const mime = a.mimeType || "image/jpeg";
        setPicked(`data:${mime};base64,${a.base64}`);
      }
    } catch (e: any) {
      toast.show({ title: "Couldn't open camera", message: e?.message || "", kind: "error" });
    }
  }, [toast]);

  const upload = useCallback(async () => {
    if (!picked) return;
    setUploading(true);
    try {
      await api(`/seller/orders/${orderId}/proof-of-delivery`, {
        method: "POST",
        body: { image: picked, note: note.trim() || undefined },
      });
      toast.show({
        title: "Delivery proof shared",
        message: "Buyer has been notified.",
        kind: "success",
      });
      setOpen(false);
      setPicked(null);
      setNote("");
      if (onUploaded) onUploaded();
    } catch (e: any) {
      toast.show({
        title: "Upload failed",
        message: e?.message || "Please try again.",
        kind: "error",
      });
    } finally {
      setUploading(false);
    }
  }, [picked, note, orderId, toast, onUploaded]);

  // Already uploaded — show a compact confirmation strip
  if (existingProofImage) {
    return (
      <View style={styles.uploadedRow} testID="seller-proof-uploaded">
        <CheckCircle2 size={14} color={colors.success} />
        <Text style={styles.uploadedText}>
          Proof shared {existingProofUploadedBy === "carrier" ? "by courier" : "by you"}
        </Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        testID="seller-proof-upload-btn"
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
      >
        <ImagePlus size={14} color={colors.primary} />
        <Text style={styles.btnText}>Upload delivery proof</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Upload delivery proof</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <X size={20} color={colors.text} />
              </Pressable>
            </View>

            {picked ? (
              <Image source={{ uri: picked }} style={styles.preview} resizeMode="cover" />
            ) : (
              <View style={styles.placeholder}>
                <ImagePlus size={32} color={colors.textMuted} />
                <Text style={styles.placeholderText}>Add a photo so the buyer sees it on their order</Text>
              </View>
            )}

            <View style={styles.pickRow}>
              <Pressable onPress={pickFromCamera} style={styles.pickBtn} testID="seller-proof-camera">
                <Camera size={16} color={colors.text} />
                <Text style={styles.pickBtnText}>Camera</Text>
              </Pressable>
              <Pressable onPress={pickFromGallery} style={styles.pickBtn} testID="seller-proof-gallery">
                <ImagePlus size={16} color={colors.text} />
                <Text style={styles.pickBtnText}>Gallery</Text>
              </Pressable>
            </View>

            <TextInput
              placeholder="Optional note (e.g. 'Left at the front porch')"
              placeholderTextColor={colors.textMuted}
              value={note}
              onChangeText={setNote}
              maxLength={300}
              style={styles.input}
              testID="seller-proof-note"
            />

            <Pressable
              onPress={upload}
              disabled={!picked || uploading}
              style={[styles.submit, (!picked || uploading) && { opacity: 0.6 }]}
              testID="seller-proof-submit"
            >
              {uploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitText}>Send to buyer & mark delivered</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
    alignSelf: "flex-start",
  },
  btnText: { color: colors.primary, fontSize: 12, fontWeight: "800" },

  uploadedRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.successSoft,
    alignSelf: "flex-start",
  },
  uploadedText: { color: colors.success, fontSize: 12, fontWeight: "700" },

  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  preview: { width: "100%", height: 220, borderRadius: radius.md, backgroundColor: colors.surface },
  placeholder: {
    height: 220,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  placeholderText: { color: colors.textMuted, textAlign: "center", fontSize: 13 },
  pickRow: { flexDirection: "row", gap: spacing.sm },
  pickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  input: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.text,
  },
  submit: {
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
