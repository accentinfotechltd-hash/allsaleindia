import { useRouter } from "expo-router";
import { ChevronRight, Globe2, LogOut, MapPin, Package, Settings, ShieldCheck } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/contexts/AuthContext";
import { colors, radius, spacing } from "@/src/lib/theme";

export default function Account() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const initials = (user?.full_name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Account</Text>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} testID="account-name">{user?.full_name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
            <View style={styles.regionBadge}>
              <Globe2 size={11} color={colors.textMuted} />
              <Text style={styles.regionText}>Shipping to New Zealand</Text>
            </View>
          </View>
        </View>

        <View style={styles.menuGroup}>
          <Row
            icon={<Package size={18} color={colors.text} />}
            label="My orders"
            onPress={() => router.push("/orders")}
            testID="account-orders-btn"
          />
          <Row
            icon={<MapPin size={18} color={colors.text} />}
            label="Shipping addresses"
            onPress={() => {}}
            testID="account-addresses-btn"
            subtitle="Set up at checkout"
          />
          <Row
            icon={<ShieldCheck size={18} color={colors.text} />}
            label="Buyer protection"
            onPress={() => {}}
            testID="account-protection-btn"
            subtitle="Refund if item not delivered"
          />
          <Row
            icon={<Settings size={18} color={colors.text} />}
            label="Preferences"
            onPress={() => {}}
            testID="account-prefs-btn"
          />
        </View>

        <Pressable
          testID="account-logout-btn"
          onPress={async () => {
            await logout();
            router.replace("/(auth)/welcome");
          }}
          style={({ pressed }) => [styles.logout, pressed && { opacity: 0.8 }]}
        >
          <LogOut size={18} color={colors.error} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.footer}>Allsale · India → NZ · Authentic, fairly traded.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  subtitle,
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.8 },
  profileCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  name: { fontSize: 17, fontWeight: "800", color: colors.text, letterSpacing: -0.3 },
  email: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  regionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  regionText: { fontSize: 10, color: colors.textMuted, fontWeight: "600" },
  menuGroup: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  logout: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.error,
  },
  logoutText: { color: colors.error, fontWeight: "700", fontSize: 14 },
  footer: { textAlign: "center", color: colors.textFaint, fontSize: 11, marginTop: spacing.xl },
});
