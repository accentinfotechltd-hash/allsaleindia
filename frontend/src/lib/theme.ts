export const colors = {
  bg: "#FFFFFF",
  surface: "#F9FAFB",
  surfaceMuted: "#F3F4F6",
  text: "#0A0A0A",
  textMuted: "#52525B",
  textFaint: "#9CA3AF",
  border: "#E5E7EB",
  primary: "#FF6200",
  primaryDark: "#E65800",
  primarySoft: "#FFF1E6",
  success: "#10B981",
  successSoft: "#ECFDF5",
  error: "#EF4444",
  accent: "#0055FF",
  black: "#0A0A0A",
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  floating: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};

export function formatNZD(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatINR(n: number): string {
  // No decimals for INR.
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
