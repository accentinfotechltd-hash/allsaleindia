/** Shared business-info form fields used in seller signup and upgrade flows. */
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { colors, radius, spacing } from "@/src/lib/theme";

export type BusinessForm = {
  company_name: string;
  gstin: string;
  pan: string;
  cin: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  contact_name: string;
  contact_phone: string;
};

export const EMPTY_BUSINESS: BusinessForm = {
  company_name: "",
  gstin: "",
  pan: "",
  cin: "",
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
      [k]: ["gstin", "pan", "cin"].includes(k) ? v.toUpperCase() : v,
    }));
  return { form, set, setForm };
}

export function BusinessFields({
  form,
  set,
  prefix = "biz",
}: {
  form: BusinessForm;
  set: (k: keyof BusinessForm) => (v: string) => void;
  prefix?: string;
}) {
  return (
    <View>
      <Section title="Business identity" />
      <Field label="Company name" testID={`${prefix}-company_name`} value={form.company_name} onChangeText={set("company_name")} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field
            label="GSTIN (15 chars)"
            testID={`${prefix}-gstin`}
            value={form.gstin}
            onChangeText={set("gstin")}
            placeholder="27ABCDE1234F1Z5"
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
      <Field
        label="CIN (optional, 21 chars)"
        testID={`${prefix}-cin`}
        value={form.cin}
        onChangeText={set("cin")}
        placeholder="U74999MH2020PTC123456"
        autoCapitalize="characters"
        maxLength={21}
      />

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
