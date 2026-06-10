import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAuth } from "@/src/contexts/AuthContext";
import { colors, radius } from "@/src/lib/theme";

function GoogleGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.4 0 19.5-7.5 19.5-19.5 0-1.2-.2-2.3-.4-3.5z"
      />
      <Path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 16 18.9 13 24 13c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5c-7.4 0-13.8 4.1-17.1 10.2z"
      />
      <Path
        fill="#4CAF50"
        d="M24 43.5c5 0 9.6-1.9 13-5l-6-4.9c-2 1.4-4.5 2.4-7 2.4-5.2 0-9.6-3.1-11.3-7.5l-6.5 5C9.7 39.4 16.3 43.5 24 43.5z"
      />
      <Path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6 4.9c-.4.4 6.7-4.9 6.7-14.4 0-1.2-.2-2.3-.4-3.5z"
      />
    </Svg>
  );
}

export function GoogleSignInButton({
  label = "Continue with Google",
  redirectTo,
  testID = "google-signin-btn",
}: {
  label?: string;
  redirectTo?: string;
  testID?: string;
}) {
  const { loginWithGoogle, googleSigningIn } = useAuth();
  const router = useRouter();

  const onPress = async () => {
    try {
      const { cancelled } = await loginWithGoogle();
      if (!cancelled && redirectTo) router.replace(redirectTo as any);
    } catch {
      // Silently fail — caller can surface errors if needed.
    }
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={googleSigningIn}
      style={({ pressed }) => [
        styles.btn,
        pressed && { transform: [{ scale: 0.98 }] },
        googleSigningIn && { opacity: 0.7 },
      ]}
    >
      {googleSigningIn ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={styles.row}>
          <GoogleGlyph />
          <Text style={styles.text}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { color: colors.text, fontSize: 15, fontWeight: "700" },
});
