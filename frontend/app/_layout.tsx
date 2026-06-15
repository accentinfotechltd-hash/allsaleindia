import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/contexts/AuthContext";
import { CartProvider } from "@/src/contexts/CartContext";
import { RegionProvider } from "@/src/contexts/RegionContext";
import { WishlistProvider } from "@/src/contexts/WishlistContext";
import { UiOverlayProvider } from "@/src/components/UiOverlayProvider";
import { loadStoredLanguage } from "@/src/i18n";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    loadStoredLanguage();
  }, []);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

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
                </WishlistProvider>
              </CartProvider>
            </RegionProvider>
          </AuthProvider>
        </UiOverlayProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
