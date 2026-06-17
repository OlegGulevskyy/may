import { useCallback } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
} from "react-native";

import { tapFeedback } from "./haptics";

export function HapticPressable({
  accessibilityRole,
  disabled,
  onPress,
  ...props
}: PressableProps) {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (!disabled && accessibilityRole === "button") {
        tapFeedback();
      }
      onPress?.(event);
    },
    [accessibilityRole, disabled, onPress],
  );

  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      onPress={onPress ? handlePress : undefined}
    />
  );
}
