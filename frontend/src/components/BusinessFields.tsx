/** Shared business-info form fields used in seller signup and upgrade flows. */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing } from "@/src/lib/theme";

export type BusinessType =
  | "sole_proprietorship"
  | "partnership_firm"
  | "llp"
  | "private_limited"
  | "public_limited"
  | "opc"
  | "section_8";

export const BUSINESS_TYPES: {
  key: BusinessType;
  short: string;
  full: string;
  mca: "cin" | "llpin" | "none";
  hint: string;
}[] = [
  {
    key: "sole_proprietorship",
    short: "Sole Prop",
    full: "Sole Proprietorship",
    mca: "none",
    hint: "Not registered on MCA. GSTIN is OPTIONAL (only required if your annual turnover crosses ₹40 lakh). PAN is required.",
  },
  {
    key: "partnership_firm",
    short: "Partnership",
    full: "Partnership Firm",
    mca: "none",
    hint: "Registered with the Registrar of Firms (state). GSTIN & PAN required.",
  },
  {
    key: "llp",
    short: "LLP",
    full: "Limited Liability Partnership",
    mca: "llpin",
    hint: "Registered with MCA — your 7-character LLPIN is required.",
  },
  {
    key: "private_limited",
    short: "Pvt Ltd",
    full: "Private Limited Company",
    mca: "cin",
    hint: "Registered with MCA — your 21-character CIN is required.",
  },
  {
    key: "public_limited",
    short: "Public Ltd",
    full: "Public Limited Company",
    mca: "cin",
    hint: "Registered with MCA — your 21-character CIN is required.",
  },
  {
    key: "opc",
    short: "OPC",
    full: "One Person Company",
    mca: "cin",
    hint: "Registered with MCA — your 21-character CIN is required.",
  },
  {
    key: "section_8",
    short: "Section 8",
    full: "Section 8 Company (Non-profit)",
    mca: "cin",
    hint: "Registered with MCA — your 21-character CIN is required.",
  },
];

export type BusinessForm = {
  business_type: BusinessType;
  company_name: string;
  gstin: string;
  pan: string;
  cin: string;
  llpin: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  contact_name: string;
  contact_phone: string;
};

export const EMPTY_BUSINESS: BusinessForm = {
  business_type: "private_limited",
  company_name: "",
  gstin: "",
  pan: "",
  cin: "",
  llpin: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  pincode: "",
  contact_name: "",
  contact_phone: "",
};

export function useBusinessForm() {
  const [form, setForm] = useState<BusinessForm>(EMPTY_BUSINESS);
  const set = (k: keyof BusinessForm) => (v: string) =>
    setForm((f) => ({
      ...f,
      [k]: ["gstin", "pan", "cin", "llpin"].includes(k) ? v.toUpperCase() : v,
    }));
  const setType = (t: BusinessType) =>
    setForm((f) => ({ ...f, business_type: t, cin: "", llpin: "" }));
  return { form, set, setType, setForm };
}

export function BusinessFields({
  form,
  set,
  setType,
  prefix = "biz",
}: {
  form: BusinessForm;
  set: (k: keyof BusinessForm) => (v: string) => void;
  setType: (t: BusinessType) => void;
  prefix?: string;
}) {
  const activeType = BUSINESS_TYPES.find((b) => b.key === form.business_type) || BUSINESS_TYPES[3];

  return (
    <View>
      <Section title="Business type" />
      <Text style={styles.helper}>Pick the entity type that matches your registered business.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        {BUSINESS_TYPES.map((bt) => {
          const active = bt.key === form.business_type;
          return (
            <Pressable
              key={bt.key}
              testID={`${prefix}-business_type-${bt.key}`}
              onPress={() => setType(bt.key)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{bt.short}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.hintBox} testID={`${prefix}-business_type-hint`}>
        <Text style={styles.hintTitle}>{activeType.full}</Text>
        <Text style={styles.hintText}>{activeType.hint}</Text>
      </View>

      <Section title="Business identity" />
      <Field label="Company name" testID={`${prefix}-company_name`} value={form.company_name} onChangeText={set("company_name")} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field
            label={
              form.business_type === "sole_proprietorship"
                ? "GSTIN (optional)"
                : "GSTIN (15 chars)"
            }
            testID={`${prefix}-gstin`}
            value={form.gstin}
            onChangeText={set("gstin")}
            placeholder={
              form.business_type === "sole_proprietorship"
                ? "Leave blank if not registered"
                : "27ABCDE1234F1Z5"
            }
            autoCapitalize="characters"
            maxLength={15}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="PAN (10 chars)"
            testID={`${prefix}-pan`}
            value={form.pan}
            onChangeText={set("pan")}
            placeholder="ABCDE1234F"
            autoCapitalize="characters"
            maxLength={10}
          />
        </View>
      </View>

      {activeType.mca === "cin" ? (
        <Field
          label="CIN (21 chars)"
          testID={`${prefix}-cin`}
          value={form.cin}
          onChangeText={set("cin")}
          placeholder="U74999MH2020PTC123456"
          autoCapitalize="characters"
          maxLength={21}
        />
      ) : null}

      {activeType.mca === "llpin" ? (
        <Field
          label="LLPIN (7 chars: AAA-1234 or AAA1234)"
          testID={`${prefix}-llpin`}
          value={form.llpin}
          onChangeText={set("llpin")}
          placeholder="AAB-1234"
          autoCapitalize="characters"
          maxLength={8}
        />
      ) : null}

      <Section title="Registered address (India)" />
      <Field label="Address line 1" testID={`${prefix}-address_line1`} value={form.address_line1} onChangeText={set("address_line1")} />
      <Field label="Address line 2 (optional)" testID={`${prefix}-address_line2`} value={form.address_line2} onChangeText={set("address_line2")} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="City" testID={`${prefix}-city`} value={form.city} onChangeText={set("city")} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="State" testID={`${prefix}-state`} value={form.state} onChangeText={set("state")} />
        </View>
      </View>
      <Field
        label="Pincode (6 digits)"
        testID={`${prefix}-pincode`}
        value={form.pincode}
        onChangeText={set("pincode")}
        keyboardType="number-pad"
        maxLength={6}
      />

      <Section title="Authorized contact" />
      <Field label="Contact name" testID={`${prefix}-contact_name`} value={form.contact_name} onChangeText={set("contact_name")} />
      <Field
        label="Contact phone"
        testID={`${prefix}-contact_phone`}
        value={form.contact_phone}
        onChangeText={set("contact_phone")}
        keyboardType="phone-pad"
        placeholder="+91 98123 45678"
      />
    </View>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title.toUpperCase()}</Text>;
}

function Field({
  label,
  testID,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
  keyboardType,
  maxLength,
}: {
  label: string;
  testID: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "number-pad" | "phone-pad";
  maxLength?: number;
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
        maxLength={maxLength}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12 },
  section: { fontSize: 11, fontWeight: "800", color: colors.primary, letterSpacing: 1.5, marginTop: spacing.lg, marginBottom: spacing.md },
  helper: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  chipsRow: { gap: 8, paddingBottom: spacing.sm },
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
  hintBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    marginTop: spacing.sm,
  },
  hintTitle: { fontSize: 13, fontWeight: "800", color: colors.text },
  hintText: { fontSize: 12, color: colors.text, marginTop: 4, lineHeight: 18 },
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
});
