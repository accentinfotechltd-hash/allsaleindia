import { Tabs } from "expo-router";
import { Home, LayoutGrid, ShoppingBag, User } from "lucide-react-native";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCart } from "@/src/contexts/CartContext";
import { colors } from "@/src/lib/theme";

function CartIcon({ color, size }: { color: string; size: number }) {
  const { itemCount } = useCart();
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ShoppingBag size={size} color={color} strokeWidth={2.2} />
      {itemCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{itemCount > 9 ? "9+" : itemCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", marginBottom: Platform.OS === "ios" ? 0 : 4 },
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: "Categories",
          tabBarIcon: ({ color, size }) => <LayoutGrid size={size} color={color} strokeWidth={2.2} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarIcon: ({ color, size }) => <CartIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => <User size={size} color={color} strokeWidth={2.2} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
});
