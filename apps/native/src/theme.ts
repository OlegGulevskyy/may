import { Platform } from "react-native";

export const palette = {
  berry: "#b04c40",
  gold: "#b7852d",
  ink: "#252d2b",
  inkFaint: "rgba(37,45,43,0.36)",
  inkMuted: "rgba(37,45,43,0.62)",
  moss: "#5b7e66",
  porcelain: "#f8efe4",
  surface: "#efe5da",
  // Liquid-glass surface tokens — translucent whites layered over the warm
  // gradient background so panels pick up the colour bleeding through.
  glass: "rgba(255,255,255,0.5)",
  glassStrong: "rgba(255,255,255,0.68)",
  glassFaint: "rgba(255,255,255,0.34)",
  rim: "rgba(255,255,255,0.9)",
  rimSoft: "rgba(255,255,255,0.55)",
};

export const radius = {
  small: 14,
  medium: 18,
  large: 28,
  xl: 36,
  pill: 999,
};

// Warm, archival background. The base sweeps porcelain → soft moss → porcelain;
// the overlay adds a faint diagonal of brand colour so glass panels shimmer.
export const gradients = {
  screen: ["#f7efe6", "#eef4ee", "#f5eee7", "#f2ece6"] as const,
  screenOverlay: [
    "rgba(183,133,45,0.12)",
    "rgba(255,255,255,0)",
    "rgba(91,126,102,0.13)",
  ] as const,
  highlight: ["rgba(255,255,255,0.6)", "rgba(255,255,255,0)"] as const,
  ink: ["#2f3a37", "#252d2b"] as const,
  berry: ["#c25a4d", "#a8443a"] as const,
};

export const shadow = {
  soft: Platform.select({
    ios: {
      shadowColor: "#514139",
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 0.12,
      shadowRadius: 32,
    },
    android: {
      elevation: 4,
    },
    default: {},
  }),
  lifted: Platform.select({
    ios: {
      shadowColor: "#3d2f29",
      shadowOffset: { width: 0, height: 22 },
      shadowOpacity: 0.18,
      shadowRadius: 38,
    },
    android: {
      elevation: 8,
    },
    default: {},
  }),
};
