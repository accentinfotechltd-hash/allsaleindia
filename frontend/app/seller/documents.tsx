import * as ImagePicker from "expo-image-picker";
import { Link, useRouter } from "expo-router";
import { Check, CheckCircle2, FileText, ShieldCheck, Upload } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";
import { useToast } from "@/src/components/UiOverlayProvider";

type DocSlot = "id_proof" | "business_proof";

export default function SellerDocumentsScreen() {
  const { show } = useToast();
  const router = useRouter();
  const [idProof, setIdProof] = useState<string | null>(null);
  const [bizProof, setBizProof] = useState<string | null>(null);
  const [agreePolicy, setAgreePolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  useEffect(() => {
    api<{ status: string; rejection_reason: string | null }>("/seller/me/status")
      .then((r) => {
        setCurrentStatus(r.status);
        setRejectionReason(r.rejection_reason);
      })
      .catch(() => {});
  }, []);

  const pick = useCallback(async (slot: DocSlot) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show({ title: "Permission needed", message: "We need access to your photos to upload your documents.", kind: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.75,
      base64: true,
      selectionLimit: 1,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const mime = result.assets[0].mimeType || "image/jpeg";
    const dataUri = `data:${mime};base64,${result.assets[0].base64}`;
    if (slot === "id_proof") setIdProof(dataUri);
    else setBizProof(dataUri);
  }, []);

  const submit = useCallback(async () => {
    if (!idProof || !bizProof) {
      show({ title: "Both documents required", message: "Please upload your photo ID and business proof to continue.", kind: "error" });
      return;
    }
    if (!agreePolicy) {
      show({ title: "Seller Policy required", message: "Please read and accept the Seller Policy, Payment Hold Policy, and Return Policy to submit.", kind: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await api<{ status: string }>("/seller/documents", {
        method: "POST",
        body: {
          id_proof_url: idProof,
          business_proof_url: bizProof,
        },
      });
      toast.show({
        title: "Documents submitted ✓",
        body: "Your application is under review. We'll respond within 7 business days.",
        kind: "success",
      });
      router.replace("/seller/dashboard");
    } catch (e: any) {
      show({ title: "Upload failed", message: e?.message || "Please try again.", kind: "error" });
    } finally {
      setSubmitting(false);
    }
  }, [idProof, bizProof, router]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ShieldCheck size={24} color={colors.primary} />
          <Text style={styles.title}>Verify your business</Text>
          <Text style={styles.subtitle}>
            Allsale only lists products from verified Indian businesses. Please upload the
            two documents below — our team reviews within 7 business days.
          </Text>
        </View>

        {currentStatus === "rejected" && rejectionReason ? (
          <View style={styles.rejectBanner}>
            <Text style={styles.rejectTitle}>Previously rejected</Text>
            <Text style={styles.rejectText}>{rejectionReason}</Text>
          </View>
        ) : null}

        <DocSlotCard
          testID="upload-id-proof"
          icon="id"
          label="Photo ID"
          hint="Aadhaar, PAN card, Driving licence or Passport"
          value={idProof}
          onPick={() => pick("id_proof")}
        />

        <DocSlotCard
          testID="upload-business-proof"
          icon="biz"
          label="Business proof"
          hint="GST certificate, Shop & Establishment licence, or MSME / Udyam certificate"
          value={bizProof}
          onPick={() => pick("business_proof")}
        />

        <View style={styles.privacyBox}>
          <Text style={styles.privacyTitle}>How we use your documents</Text>
          <Text style={styles.privacyText}>
            • Stored securely on Cloudinary{"\n"}
            • Only reviewed by Allsale&apos;s compliance team{"\n"}
            • Never shared with buyers or third parties{"\n"}
            • Used only to verify your business identity
          </Text>
        </View>

        <Pressable
          testID="seller-policy-checkbox"
          onPress={() => setAgreePolicy((v) => !v)}
          style={styles.policyRow}
        >
          <View style={[styles.checkbox, agreePolicy && styles.checkboxOn]}>
            {agreePolicy ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
          </View>
          <Text style={styles.policyText}>
            I have read and accept Allsale&apos;s{" "}
            <Link href="/help/seller-policy" asChild>
              <Text style={styles.policyLink}>Seller Policy</Text>
            </Link>
            {", "}
            <Link href="/help/payment-policy" asChild>
              <Text style={styles.policyLink}>Payment Hold Policy</Text>
            </Link>
            {", "}
            <Link href="/help/return-policy" asChild>
              <Text style={styles.policyLink}>Return Policy</Text>
            </Link>
            {", and "}
            <Link href="/help/cancellation-policy" asChild>
              <Text style={styles.policyLink}>Cancellation Policy</Text>
            </Link>
            . Payments are held until the return window closes (typically 14 days post-delivery).
          </Text>
        </Pressable>

        <Pressable
          testID="seller-docs-submit"
          disabled={!idProof || !bizProof || !agreePolicy || submitting}
          onPress={submit}
          style={({ pressed }) => [
            styles.submitBtn,
            (!idProof || !bizProof || !agreePolicy) && styles.submitDisabled,
            pressed && !submitting && { opacity: 0.85 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Upload size={18} color="#fff" />
              <Text style={styles.submitText}>Submit for review</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.footnote}>
          By submitting, you confirm the documents are genuine and that all business
          details provided are accurate.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function DocSlotCard({
  testID,
  icon,
  label,
  hint,
  value,
  onPick,
}: {
  testID: string;
  icon: "id" | "biz";
  label: string;
  hint: string;
  value: string | null;
  onPick: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPick}
      style={({ pressed }) => [styles.docCard, value && styles.docCardFilled, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.docHeader}>
        {value ? (
          <CheckCircle2 size={20} color={colors.success} />
        ) : (
          <FileText size={20} color={colors.primary} />
        )}
        <Text style={styles.docLabel}>{label}</Text>
      </View>
      <Text style={styles.docHint}>{hint}</Text>
      {value ? (
        <View style={styles.previewRow}>
          <Image source={{ uri: value }} style={styles.previewImg} resizeMode="cover" />
          <Text style={styles.replaceText}>Tap to replace</Text>
        </View>
      ) : (
        <View style={styles.uploadCta}>
          <Upload size={16} color={colors.primary} />
          <Text style={styles.uploadCtaText}>Choose photo from gallery</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  header: { gap: 6, marginBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 8 },
  subtitle: { fontSize: 13.5, lineHeight: 20, color: colors.textMuted },
  rejectBanner: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  rejectTitle: { fontSize: 13, fontWeight: "800", color: colors.danger, marginBottom: 4 },
  rejectText: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  docCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    gap: 8,
  },
  docCardFilled: { borderColor: colors.success, backgroundColor: "#F0FDF4" },
  docHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  docLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  docHint: { fontSize: 12.5, color: colors.textMuted, lineHeight: 17 },
  uploadCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  uploadCtaText: { fontSize: 13, fontWeight: "700", color: colors.primary },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  previewImg: { width: 60, height: 60, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  replaceText: { fontSize: 12.5, color: colors.textMuted, fontWeight: "600" },
  privacyBox: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  privacyTitle: { fontSize: 13, fontWeight: "800", color: colors.text, marginBottom: 4 },
  privacyText: { fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  submitBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.sm,
  },
  submitDisabled: { backgroundColor: "#CBD5E1" },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  footnote: { fontSize: 11.5, color: colors.textMuted, textAlign: "center", lineHeight: 17, marginTop: 4 },
  policyRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4, paddingHorizontal: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  policyText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.text },
  policyLink: { color: colors.primary, fontWeight: "700", textDecorationLine: "underline" },
});
