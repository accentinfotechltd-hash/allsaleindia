import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import {
  Bell,
  Building2,
  Camera,
  ChevronLeft,
  ImageIcon,
  KeyRound,
  Landmark,
  LogOut,
  Mail,
  Phone,
  Plane,
  Save,
  ShieldAlert,
  Store,
  Truck,
  User as UserIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, setToken } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type NotificationPrefs = {
  new_order_email: boolean;
  new_order_inapp: boolean;
  return_request_email: boolean;
  return_request_inapp: boolean;
  payout_email: boolean;
  payout_inapp: boolean;
  low_stock_email: boolean;
  low_stock_inapp: boolean;
};

type Settings = {
  user_id: string;
  email: string;
  company_name: string;
  verification_status: string;
  store_display_name: string | null;
  store_logo_url: string | null;
  store_banner_url: string | null;
  store_bio: string | null;
  contact_name: string;
  contact_phone: string;
  support_email: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  pincode: string;
  bank_holder_name: string | null;
  bank_name: string | null;
  bank_ifsc: string | null;
  bank_account_last4: string | null;
  vacation_mode: boolean;
  vacation_until: string | null;
  vacation_message: string | null;
  shipping_handling_days: number;
  notification_prefs: NotificationPrefs;
};

export default function SellerProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Settings | null>(null);
  const [bankAccountInput, setBankAccountInput] = useState("");

  // Password modal state
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<Settings>("/seller/profile/settings");
      setData(s);
    } catch (e: any) {
      Alert.alert("Could not load settings", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setData((cur) => (cur ? { ...cur, [key]: value } : cur));
  };

  const togglePref = (key: keyof NotificationPrefs) => {
    if (!data) return;
    setData({
      ...data,
      notification_prefs: {
        ...data.notification_prefs,
        [key]: !data.notification_prefs[key],
      },
    });
  };

  const pickImage = useCallback(
    async (slot: "logo" | "banner") => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to upload your store images.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: slot === "logo" ? [1, 1] : [16, 9],
        quality: 0.7,
        base64: true,
      });
      if (result.canceled || !result.assets[0]?.base64) return;
      const mime = result.assets[0].mimeType || "image/jpeg";
      const dataUri = `data:${mime};base64,${result.assets[0].base64}`;
      try {
        const up = await api<{ url: string }>("/uploads/image", {
          method: "POST",
          body: { data: dataUri, folder: `allsale/sellers/${slot}` },
        });
        if (slot === "logo") set("store_logo_url", up.url);
        else set("store_banner_url", up.url);
      } catch (e: any) {
        Alert.alert("Upload failed", e?.message || "Please try again.");
      }
    },
    [],
  );

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        store_display_name: data.store_display_name?.trim() || null,
        store_logo_url: data.store_logo_url || null,
        store_banner_url: data.store_banner_url || null,
        store_bio: data.store_bio?.trim() || null,
        contact_name: data.contact_name.trim(),
        contact_phone: data.contact_phone.trim(),
        support_email: data.support_email?.trim() || null,
        address_line1: data.address_line1.trim(),
        address_line2: data.address_line2?.trim() || null,
        city: data.city.trim(),
        state: data.state.trim(),
        pincode: data.pincode.trim(),
        bank_holder_name: data.bank_holder_name?.trim() || null,
        bank_name: data.bank_name?.trim() || null,
        bank_ifsc: data.bank_ifsc?.trim().toUpperCase() || null,
        vacation_mode: data.vacation_mode,
        vacation_message: data.vacation_message?.trim() || null,
        shipping_handling_days: data.shipping_handling_days,
        notification_prefs: data.notification_prefs,
      };
      if (bankAccountInput.trim()) {
        payload.bank_account_number = bankAccountInput.trim();
      }
      const fresh = await api<Settings>("/seller/profile/settings", {
        method: "PATCH",
        body: payload,
      });
      setData(fresh);
      setBankAccountInput("");
      Alert.alert("Saved", "Your store profile has been updated.");
    } catch (e: any) {
      Alert.alert("Could not save", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [data, bankAccountInput]);

  const changePassword = useCallback(async () => {
    if (!pwOld || pwNew.length < 8) {
      Alert.alert("Check your input", "Enter your current password and a new password ≥ 8 chars with a number.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await api<{ access_token: string }>("/seller/profile/password", {
        method: "POST",
        body: { current_password: pwOld, new_password: pwNew },
      });
      await setToken(res.access_token);
      setPwOld("");
      setPwNew("");
      Alert.alert("Password updated", "All other devices have been signed out.");
    } catch (e: any) {
      Alert.alert("Could not change password", e?.message || "Please try again.");
    } finally {
      setPwSaving(false);
    }
  }, [pwOld, pwNew]);

  const signOutAll = useCallback(() => {
    Alert.alert(
      "Sign out all other devices?",
      "You will stay signed in here. All other devices must sign in again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out everywhere",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await api<{ access_token: string }>(
                "/seller/profile/sign-out-all",
                { method: "POST" },
              );
              await setToken(res.access_token);
              Alert.alert("Done", "All other sessions have been revoked.");
            } catch (e: any) {
              Alert.alert("Failed", e?.message || "Please try again.");
            }
          },
        },
      ],
    );
  }, []);

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Header onBack={() => router.back()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Storefront identity */}
          <Section icon={<Store size={18} color={colors.primary} />} title="Storefront">
            <Pressable testID="profile-banner-picker" onPress={() => pickImage("banner")} style={styles.bannerSlot}>
              {data.store_banner_url ? (
                <Image source={{ uri: data.store_banner_url }} style={styles.bannerImg} />
              ) : (
                <View style={styles.bannerEmpty}>
                  <ImageIcon size={20} color={colors.textMuted} />
                  <Text style={styles.bannerHint}>Tap to upload a store banner (16:9)</Text>
                </View>
              )}
              <View style={styles.bannerCameraBadge}>
                <Camera size={14} color="#fff" />
              </View>
            </Pressable>

            <View style={styles.logoRow}>
              <Pressable testID="profile-logo-picker" onPress={() => pickImage("logo")} style={styles.logoSlot}>
                {data.store_logo_url ? (
                  <Image source={{ uri: data.store_logo_url }} style={styles.logoImg} />
                ) : (
                  <ImageIcon size={20} color={colors.textMuted} />
                )}
                <View style={styles.logoCameraBadge}>
                  <Camera size={11} color="#fff" />
                </View>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Field
                  label="Store display name"
                  value={data.store_display_name || ""}
                  placeholder={data.company_name}
                  onChangeText={(t) => set("store_display_name", t)}
                  testID="profile-store-name"
                />
              </View>
            </View>

            <Field
              label="Store bio (max 300 chars)"
              value={data.store_bio || ""}
              placeholder="Authentic Indian handicrafts — handmade in Jaipur"
              onChangeText={(t) => set("store_bio", t.slice(0, 300))}
              multiline
              numberOfLines={3}
              testID="profile-store-bio"
            />
            <Text style={styles.counter}>{(data.store_bio || "").length}/300</Text>
          </Section>

          {/* Contact & support */}
          <Section icon={<UserIcon size={18} color={colors.primary} />} title="Contact & support">
            <Field
              label="Contact name"
              value={data.contact_name}
              onChangeText={(t) => set("contact_name", t)}
              leftIcon={<UserIcon size={16} color={colors.textMuted} />}
              testID="profile-contact-name"
            />
            <Field
              label="Contact phone"
              value={data.contact_phone}
              onChangeText={(t) => set("contact_phone", t)}
              keyboardType="phone-pad"
              leftIcon={<Phone size={16} color={colors.textMuted} />}
              testID="profile-contact-phone"
            />
            <Field
              label="Support email (public)"
              value={data.support_email || ""}
              placeholder="support@yourstore.com"
              onChangeText={(t) => set("support_email", t)}
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon={<Mail size={16} color={colors.textMuted} />}
              testID="profile-support-email"
            />
            <View style={styles.readOnlyRow}>
              <Mail size={16} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.readOnlyLabel}>Login email</Text>
                <Text style={styles.readOnlyValue}>{data.email}</Text>
              </View>
            </View>
          </Section>

          {/* Business address */}
          <Section icon={<Building2 size={18} color={colors.primary} />} title="Business address">
            <View style={styles.warnBanner}>
              <ShieldAlert size={14} color={colors.primary} />
              <Text style={styles.warnText}>
                Editing the address re-triggers admin KYC review (7-day SLA).
              </Text>
            </View>
            <Field
              label="Address line 1"
              value={data.address_line1}
              onChangeText={(t) => set("address_line1", t)}
              testID="profile-address-line1"
            />
            <Field
              label="Address line 2 (optional)"
              value={data.address_line2 || ""}
              onChangeText={(t) => set("address_line2", t)}
              testID="profile-address-line2"
            />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field label="City" value={data.city} onChangeText={(t) => set("city", t)} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="State" value={data.state} onChangeText={(t) => set("state", t)} />
              </View>
            </View>
            <Field
              label="Pincode"
              value={data.pincode}
              onChangeText={(t) => set("pincode", t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              testID="profile-pincode"
            />
          </Section>

          {/* Payout */}
          <Section icon={<Landmark size={18} color={colors.primary} />} title="Payout (display only)">
            <Text style={styles.helpText}>
              Bank info is shown to admins for payout reconciliation. The actual transfer uses Stripe — only the last 4 digits of your account are stored.
            </Text>
            <Field
              label="Account holder name"
              value={data.bank_holder_name || ""}
              onChangeText={(t) => set("bank_holder_name", t)}
            />
            <Field
              label="Bank name"
              value={data.bank_name || ""}
              placeholder="State Bank of India"
              onChangeText={(t) => set("bank_name", t)}
            />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field
                  label="IFSC code"
                  value={data.bank_ifsc || ""}
                  placeholder="SBIN0001234"
                  autoCapitalize="characters"
                  onChangeText={(t) => set("bank_ifsc", t.toUpperCase().slice(0, 11))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={data.bank_account_last4 ? `Account (•••• ${data.bank_account_last4})` : "Account number"}
                  value={bankAccountInput}
                  placeholder={data.bank_account_last4 ? "Replace…" : "0123456789"}
                  onChangeText={(t) => setBankAccountInput(t.replace(/\D/g, "").slice(0, 20))}
                  keyboardType="number-pad"
                  secureTextEntry
                />
              </View>
            </View>
          </Section>

          {/* Operational */}
          <Section icon={<Plane size={18} color={colors.primary} />} title="Vacation mode">
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Pause my store</Text>
                <Text style={styles.switchSub}>Hides all my listings from buyers worldwide.</Text>
              </View>
              <Switch
                testID="profile-vacation-toggle"
                value={data.vacation_mode}
                onValueChange={(v) => set("vacation_mode", v)}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#fff"
              />
            </View>
            {data.vacation_mode ? (
              <Field
                label="Away message (shown to existing chats)"
                value={data.vacation_message || ""}
                placeholder="Back on 20 July — replies will resume then."
                onChangeText={(t) => set("vacation_message", t.slice(0, 200))}
                multiline
              />
            ) : null}
          </Section>

          <Section icon={<Truck size={18} color={colors.primary} />} title="Shipping handling time">
            <Text style={styles.helpText}>Used in buyer ETAs. Days to pack & dispatch after order is paid.</Text>
            <View style={styles.daysRow}>
              {[1, 2, 3, 5, 7].map((d) => (
                <Pressable
                  key={d}
                  testID={`profile-handling-${d}`}
                  onPress={() => set("shipping_handling_days", d)}
                  style={[
                    styles.dayChip,
                    data.shipping_handling_days === d && styles.dayChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayChipText,
                      data.shipping_handling_days === d && styles.dayChipTextActive,
                    ]}
                  >
                    {d} {d === 1 ? "day" : "days"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>

          {/* Notification prefs */}
          <Section icon={<Bell size={18} color={colors.primary} />} title="Notifications">
            <PrefRow label="New order" prefs={data.notification_prefs} onToggle={togglePref} keyBase="new_order" />
            <PrefRow label="Return request" prefs={data.notification_prefs} onToggle={togglePref} keyBase="return_request" />
            <PrefRow label="Payout sent" prefs={data.notification_prefs} onToggle={togglePref} keyBase="payout" />
            <PrefRow label="Low stock alert" prefs={data.notification_prefs} onToggle={togglePref} keyBase="low_stock" />
            <View style={styles.prefHeaderRow}>
              <Text style={[styles.prefHeader, { flex: 1 }]} />
              <Text style={styles.prefHeader}>Email</Text>
              <Text style={styles.prefHeader}>In-app</Text>
            </View>
          </Section>

          {/* Account */}
          <Section icon={<KeyRound size={18} color={colors.primary} />} title="Account">
            <Field
              label="Current password"
              value={pwOld}
              onChangeText={setPwOld}
              secureTextEntry
              placeholder="••••••••"
              testID="profile-pw-current"
            />
            <Field
              label="New password (≥ 8 chars, 1 number)"
              value={pwNew}
              onChangeText={setPwNew}
              secureTextEntry
              placeholder="••••••••"
              testID="profile-pw-new"
            />
            <Pressable
              testID="profile-pw-submit"
              disabled={pwSaving || !pwOld || pwNew.length < 8}
              onPress={changePassword}
              style={({ pressed }) => [
                styles.secondaryBtn,
                (pwSaving || !pwOld || pwNew.length < 8) && { opacity: 0.5 },
                pressed && !pwSaving && { opacity: 0.85 },
              ]}
            >
              {pwSaving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <>
                  <KeyRound size={16} color={colors.primary} />
                  <Text style={styles.secondaryText}>Update password</Text>
                </>
              )}
            </Pressable>
            <Pressable testID="profile-signout-all" onPress={signOutAll} style={styles.dangerBtn}>
              <LogOut size={16} color={colors.error} />
              <Text style={styles.dangerText}>Sign out all other devices</Text>
            </Pressable>
          </Section>

          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Save bar */}
      <SafeAreaView edges={["bottom"]} style={styles.saveBar}>
        <Pressable
          testID="profile-save"
          disabled={saving}
          onPress={save}
          style={({ pressed }) => [
            styles.saveBtn,
            saving && { opacity: 0.6 },
            pressed && !saving && { transform: [{ scale: 0.98 }] },
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Save size={18} color="#fff" />
              <Text style={styles.saveText}>Save changes</Text>
            </>
          )}
        </Pressable>
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable testID="profile-back" onPress={onBack} style={styles.backBtn}>
        <ChevronLeft size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>Store profile</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionIcon}>{icon}</View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={{ gap: spacing.md }}>{children}</View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  numberOfLines,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
  leftIcon,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  keyboardType?: any;
  autoCapitalize?: any;
  secureTextEntry?: boolean;
  leftIcon?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, multiline && { alignItems: "flex-start", paddingVertical: 10 }]}>
        {leftIcon ? <View style={{ marginRight: 8 }}>{leftIcon}</View> : null}
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          multiline={multiline}
          numberOfLines={numberOfLines}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry}
          style={[styles.input, multiline && { height: 80, textAlignVertical: "top" }]}
        />
      </View>
    </View>
  );
}

function PrefRow({
  label,
  prefs,
  onToggle,
  keyBase,
}: {
  label: string;
  prefs: NotificationPrefs;
  onToggle: (k: keyof NotificationPrefs) => void;
  keyBase: "new_order" | "return_request" | "payout" | "low_stock";
}) {
  const emailKey = `${keyBase}_email` as keyof NotificationPrefs;
  const inappKey = `${keyBase}_inapp` as keyof NotificationPrefs;
  return (
    <View style={styles.prefRow}>
      <Text style={[styles.prefLabel, { flex: 1 }]}>{label}</Text>
      <View style={styles.prefSwitchCell}>
        <Switch
          testID={`pref-${keyBase}-email`}
          value={prefs[emailKey]}
          onValueChange={() => onToggle(emailKey)}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.prefSwitchCell}>
        <Switch
          testID={`pref-${keyBase}-inapp`}
          value={prefs[inappKey]}
          onValueChange={() => onToggle(inappKey)}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor="#fff"
        />
      </View>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 17, fontWeight: "800", color: colors.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl * 4, gap: spacing.lg },
  section: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
  bannerSlot: {
    height: 120,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  bannerImg: { width: "100%", height: "100%" },
  bannerEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  bannerHint: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  bannerCameraBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logoSlot: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: { width: "100%", height: "100%" },
  logoCameraBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 },
  counter: { fontSize: 11, color: colors.textFaint, textAlign: "right", marginTop: -8 },
  row2: { flexDirection: "row", gap: spacing.md },
  readOnlyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  readOnlyLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700" },
  readOnlyValue: { fontSize: 14, color: colors.text, fontWeight: "600" },
  warnBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  warnText: { fontSize: 12, color: colors.primaryDark, flex: 1, fontWeight: "600" },
  helpText: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switchLabel: { fontSize: 14, fontWeight: "700", color: colors.text },
  switchSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  dayChipTextActive: { color: "#fff" },
  prefHeaderRow: { flexDirection: "row", alignItems: "center", marginTop: -4 },
  prefHeader: {
    width: 64,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    color: colors.textFaint,
    letterSpacing: 0.5,
  },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  prefLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  prefSwitchCell: { width: 64, alignItems: "center" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  secondaryText: { fontSize: 14, fontWeight: "800", color: colors.primary },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  dangerText: { fontSize: 14, fontWeight: "800", color: colors.error },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
