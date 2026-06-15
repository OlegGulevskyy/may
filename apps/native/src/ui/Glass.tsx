import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft } from "lucide-react-native";

import { gradients, palette, radius, shadow } from "../theme";

/** Lightweight back affordance for pushed onboarding screens. */
export function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Go back"
      accessibilityRole="button"
      hitSlop={10}
      onPress={onBack}
      style={({ pressed }) => [styles.backBar, pressed ? styles.pressed : null]}
    >
      <ChevronLeft color={palette.ink} size={22} />
    </Pressable>
  );
}

/**
 * Full-bleed warm gradient with a faint diagonal colour wash. Everything in the
 * app sits on top of this so the translucent glass surfaces pick up its colour.
 */
export function ScreenBackground({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.background, style]}>
      <LinearGradient
        colors={gradients.screen}
        end={{ x: 0.9, y: 1 }}
        start={{ x: 0.1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={gradients.screenOverlay}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

/**
 * A clean, mostly-opaque card. Unlike {@link GlassCard} it skips the blur and
 * gradient highlight, so content hierarchy reads clearly without competing
 * surfaces. This is the default surface for the wall and settings.
 */
export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

/**
 * A frosted panel: blurs the gradient behind it, with a bright rim and a top
 * highlight to read as a single curved sheet of glass.
 */
export function GlassCard({
  children,
  style,
  intensity = 42,
  highlight = true,
  lifted = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  highlight?: boolean;
  lifted?: boolean;
}) {
  return (
    <BlurView
      intensity={intensity}
      style={[styles.card, lifted ? shadow.lifted : shadow.soft, style]}
      tint="light"
    >
      {highlight ? (
        <LinearGradient
          colors={gradients.highlight}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
          start={{ x: 0, y: 0 }}
          style={styles.highlight}
        />
      ) : null}
      {children}
    </BlurView>
  );
}

export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  tone = "ink",
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: "ink" | "berry";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        disabled ? styles.primaryDisabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      <LinearGradient
        colors={tone === "berry" ? gradients.berry : gradients.ink}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {icon}
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function GlassButton({
  label,
  onPress,
  icon,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glassButton,
        disabled ? styles.primaryDisabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      {icon}
      <Text style={styles.glassButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: palette.porcelain,
  },
  backBar: {
    alignItems: "center",
    backgroundColor: palette.glass,
    borderColor: palette.rimSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  card: {
    borderColor: palette.rimSoft,
    borderRadius: radius.large,
    borderWidth: 1,
    overflow: "hidden",
  },
  surface: {
    backgroundColor: "rgba(255,255,255,0.74)",
    borderColor: "rgba(37,45,43,0.06)",
    borderRadius: radius.large,
    borderWidth: 1,
    ...shadow.soft,
  },
  highlight: {
    height: "56%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  primary: {
    alignItems: "center",
    borderRadius: radius.medium,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 54,
    overflow: "hidden",
    paddingHorizontal: 22,
    ...shadow.soft,
  },
  primaryLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  primaryDisabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  glassButton: {
    alignItems: "center",
    backgroundColor: palette.glass,
    borderColor: palette.rim,
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: 22,
  },
  glassButtonLabel: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
