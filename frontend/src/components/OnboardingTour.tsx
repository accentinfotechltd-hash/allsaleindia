import { useRouter } from "expo-router";
import {
  Bell,
  Globe2,
  Heart,
  Package,
  Search,
  X,
} from "lucide-react-native";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/src/contexts/AuthContext";
import { api } from "@/src/lib/api";
import { colors, radius, spacing } from "@/src/lib/theme";

type Slide = {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent: string;
};

const SLIDES: Slide[] = [
  {
    icon: <Globe2 size={42} color="#7C3AED" />,
    title: "Welcome to Allsale 🇮🇳→🌏",
    body: "Buy authentic Indian products from verified sellers — shipping to NZ, AU, US, GB, CA & beyond.",
    accent: "#7C3AED",
  },
  {
    icon: <Search size={42} color="#F97316" />,
    title: "Discover anything",
    body: "Search saris, spices, brass, jewellery and more. Save your favourite filters to re-launch in one tap.",
    accent: "#F97316",
  },
  {
    icon: <Heart size={42} color="#EF4444" fill="#FECACA" />,
    title: "Wishlist & share",
    body: "Heart the things you love. Tap Share to send your wishlist to friends — no account needed to view.",
    accent: "#EF4444",
  },
  {
    icon: <Package size={42} color="#0EA5E9" />,
    title: "Track every step",
    body: "Real-time delivery tracking with ETAs, photo proof, and 'notify me' when items come back in stock.",
    accent: "#0EA5E9",
  },
  {
    icon: <Bell size={42} color="#10B981" />,
    title: "Stay in the loop",
    body: "Get notified on order updates, restock alerts, and exclusive flash sales from Indian sellers.",
    accent: "#10B981",
  },
];

/**
 * First-run welcome carousel. Shows once per user account when
 * `user.seen_onboarding` is false. Skip + finish both POST to
 * `/me/onboarding-complete` so subsequent launches stay clean across
 * devices.
 */
export default function OnboardingTour() {
  const { user, refreshMe } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user && !user.seen_onboarding) {
      // Tiny delay so it doesn't fight with route transitions.
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [user]);

  const dismiss = async (eventName: "skip" | "complete") => {
    setBusy(true);
    try {
      await api("/me/onboarding-complete", { method: "POST", body: {} });
      try {
        await refreshMe?.();
      } catch {
        /* refreshMe is optional */
      }
    } catch {
      // never block the user from seeing the app
    } finally {
      setBusy(false);
      setVisible(false);
      if (eventName === "complete") {
        // Drop them on home so the first action is delightful.
        router.push("/(tabs)/home");
      }
    }
  };

  if (!visible || !user) return null;

  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.scrim}>
        <View style={styles.card} testID="onboarding-card">
          <Pressable
            onPress={() => dismiss("skip")}
            style={styles.skipBtn}
            testID="onboarding-skip"
            hitSlop={8}
          >
            <X size={18} color={colors.textMuted} />
          </Pressable>

          <View
            style={[
              styles.iconWrap,
              { backgroundColor: slide.accent + "20" },
            ]}
          >
            {slide.icon}
          </View>

          <Text style={styles.title} testID="onboarding-title">
            {slide.title}
          </Text>
          <Text style={styles.body}>{slide.body}</Text>

          {/* Dot indicators */}
          <View style={styles.dotRow}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === step && {
                    backgroundColor: slide.accent,
                    width: 22,
                  },
                ]}
              />
            ))}
          </View>

          <View style={styles.actions}>
            {step > 0 ? (
              <Pressable
                onPress={() => setStep((s) => Math.max(0, s - 1))}
                style={[styles.btn, styles.btnSecondary]}
                testID="onboarding-back"
              >
                <Text style={styles.btnSecondaryText}>Back</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => dismiss("skip")}
                style={[styles.btn, styles.btnSecondary]}
                testID="onboarding-skip-bottom"
              >
                <Text style={styles.btnSecondaryText}>Skip</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() =>
                isLast ? dismiss("complete") : setStep((s) => s + 1)
              }
              disabled={busy}
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: slide.accent },
                busy && { opacity: 0.6 },
              ]}
              testID="onboarding-next"
            >
              <Text style={styles.btnPrimaryText}>
                {isLast ? "Start shopping →" : "Next"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: spacing.xl,
    alignItems: "center",
  },
  skipBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 6,
  },
  dotRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  dot: {
    height: 6,
    width: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    marginTop: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  btnSecondary: { backgroundColor: colors.surface },
  btnSecondaryText: { color: colors.text, fontWeight: "800", fontSize: 14 },
});
