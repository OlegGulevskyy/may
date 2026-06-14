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
};

export const radius = {
  small: 14,
  medium: 18,
  large: 26,
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
};
