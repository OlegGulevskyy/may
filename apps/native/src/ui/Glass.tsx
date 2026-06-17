import type { ReactNode } from "react";
import {
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
import { HapticPressable as Pressable } from "./HapticPressable";

type ExpoGlassEffectModule = typeof import("expo-glass-effect");
type NativeGlassView = ExpoGlassEffectModule["GlassView"];

declare const require: (
  moduleName: "expo-glass-effect",
) => ExpoGlassEffectModule;

let glassEffectModule: ExpoGlassEffectModule | null | undefined;

function getGlassEffectModule() {
  if (glassEffectModule !== undefined) {
    return glassEffectModule;
  }

  try {
    glassEffectModule = require("expo-glass-effect");
  } catch {
    glassEffectModule = null;
  }

  return glassEffectModule;
}

function getNativeGlassView(): NativeGlassView | null {
  const glassEffect = getGlassEffectModule();

  try {
    if (
      glassEffect?.isLiquidGlassAvailable() &&
      glassEffect.isGlassEffectAPIAvailable()
    ) {
      return glassEffect.GlassView;
    }
  } catch {
    return null;
  }

  return null;
}

/** Lightweight back affordance for pushed onboarding screens. */
export function BackBar({ onBack }: { onBack: () => void }) {
  const NativeGlassView = getNativeGlassView();

  return (
    <Pressable
      accessibilityLabel="Go back"
      accessibilityRole="button"
      hitSlop={10}
      onPress={onBack}
      style={({ pressed }) => [
        styles.backBar,
        NativeGlassView ? styles.nativeBackBar : styles.fallbackBackBar,
        pressed ? styles.pressed : null,
      ]}
    >
      {NativeGlassView ? (
        <NativeGlassView
          colorScheme="light"
          glassEffectStyle="regular"
          pointerEvents="none"
          style={styles.backBarGlass}
        />
      ) : null}
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

/** Native Liquid Glass on supported iOS, with a frosted fallback elsewhere. */
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
  const NativeGlassView = getNativeGlassView();

  if (NativeGlassView) {
    return (
      <NativeGlassView
        colorScheme="light"
        glassEffectStyle="regular"
        style={[
          styles.card,
          styles.nativeCard,
          lifted ? shadow.lifted : null,
          style,
        ]}
        tintColor="rgba(255,255,255,0.14)"
      >
        {children}
      </NativeGlassView>
    );
  }

  return (
    <BlurView
      intensity={intensity}
      style={[
        styles.card,
        styles.fallbackCard,
        lifted ? shadow.lifted : shadow.soft,
        style,
      ]}
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
  const NativeGlassView = getNativeGlassView();

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glassButton,
        NativeGlassView ? styles.nativeGlassButton : styles.fallbackGlassButton,
        disabled ? styles.primaryDisabled : null,
        pressed && !disabled ? styles.pressed : null,
        style,
      ]}
    >
      {NativeGlassView ? (
        <NativeGlassView
          colorScheme="light"
          glassEffectStyle="regular"
          pointerEvents="none"
          style={styles.glassButtonGlass}
        />
      ) : null}
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
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    overflow: "hidden",
    width: 42,
  },
  nativeBackBar: {
    borderColor: "rgba(255,255,255,0.36)",
  },
  fallbackBackBar: {
    backgroundColor: palette.glass,
    borderColor: palette.rimSoft,
  },
  backBarGlass: {
    borderRadius: radius.pill,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  card: {
    borderRadius: radius.large,
    borderWidth: 1,
    overflow: "hidden",
  },
  nativeCard: {
    borderColor: "rgba(255,255,255,0.34)",
  },
  fallbackCard: {
    borderColor: palette.rimSoft,
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
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 54,
    overflow: "hidden",
    paddingHorizontal: 22,
  },
  nativeGlassButton: {
    borderColor: "rgba(255,255,255,0.42)",
  },
  fallbackGlassButton: {
    backgroundColor: palette.glass,
    borderColor: palette.rim,
  },
  glassButtonGlass: {
    borderRadius: radius.medium,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  glassButtonLabel: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
