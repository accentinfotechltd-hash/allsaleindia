import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/contexts/AuthContext";
import OnboardingTour from "@/src/components/OnboardingTour";
import { CartProvider } from "@/src/contexts/CartContext";
import { RegionProvider } from "@/src/contexts/RegionContext";
import { WishlistProvider } from "@/src/contexts/WishlistContext";
import { UiOverlayProvider } from "@/src/components/UiOverlayProvider";
import { loadStoredLanguage } from "@/src/i18n";
import { captureRefFromUrl } from "@/src/lib/ref";
import { initSentry, wrap as sentryWrap } from "@/src/lib/sentry";

// Initialise Sentry as early as possible — no-op when DSN is empty so
// dev / Expo Go / preview builds never crash on missing config.
initSentry();

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    loadStoredLanguage();
  }, []);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // Ambassador deeplink capture — handles both cold-start (app launched via
  // tap on a link) and warm-start (link tapped while app is in foreground).
  // Silently no-ops when the URL has no ?ref= or the code is invalid.
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) void captureRefFromUrl(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      void captureRefFromUrl(url);
    });
    return () => sub.remove();
  }, []);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <UiOverlayProvider>
          <AuthProvider>
            <RegionProvider>
              <CartProvider>
                <WishlistProvider>
                  <StatusBar style="dark" />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#fff" } }} />
                  <OnboardingTour />
                </WishlistProvider>
              </CartProvider>
            </RegionProvider>
          </AuthProvider>
        </UiOverlayProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Wrap the root with Sentry for performance & profiling. `sentryWrap` is a
// safe no-op when DSN is empty, so this stays cheap in dev / preview.
export default sentryWrap(RootLayout);
