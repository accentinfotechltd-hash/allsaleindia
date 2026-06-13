import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/contexts/AuthContext";
import { radius } from "@/src/lib/theme";

/**
 * Native "Sign in with Apple" button.
 *
 * Renders **only on iOS** (Apple Sign-In is not available on Android or web).
 * On supported platforms, fetches Apple's identity token via the native dialog,
 * forwards it to our backend `/api/auth/apple-session`, then completes the
 * sign-in via AuthContext.
 *
 * Required by Apple App Store policy whenever the app offers other third-party
 * social logins (Google, Facebook, etc.).
 */
export function AppleSignInButton({
  redirectTo,
  testID = "apple-signin-btn",
}: {
  redirectTo?: string;
  testID?: string;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const { loginWithApple } = useAuth();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    if (Platform.OS !== "ios") {
      setAvailable(false);
      return () => {};
    }
    AppleAuthentication.isAvailableAsync()
      .then((ok) => mounted && setAvailable(ok))
      .catch(() => mounted && setAvailable(false));
    return () => {
      mounted = false;
    };
  }, []);

  const onPress = async () => {
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error("Apple did not return an identity token");
      }
      const fullName =
        [credential.fullName?.givenName, credential.fullName?.familyName]
          .filter(Boolean)
          .join(" ")
          .trim() || null;
      await loginWithApple(credential.identityToken, fullName);
      if (redirectTo) router.replace(redirectTo as any);
    } catch (err: any) {
      // User cancelled — silent. Other errors — let caller see toast/log.
      if (err?.code === "ERR_REQUEST_CANCELED" || err?.code === "ERR_CANCELED") {
        // no-op
      }
    } finally {
      setLoading(false);
    }
  };

  if (!available) return null;

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.wrap}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={radius.lg}
        style={styles.btn}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  btn: { width: "100%", height: 48 },
  loadingWrap: { marginTop: 10, paddingVertical: 12, alignItems: "center" },
});
