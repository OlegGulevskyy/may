import { StyleSheet, Text, TextInput, View } from "react-native";
import type { KeyboardTypeOptions } from "react-native";

import { palette, radius } from "../theme";

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  autoCapitalize = "sentences",
  keyboardType = "default",
  autoFocus = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  hint?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoFocus={autoFocus}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.inkFaint}
        style={styles.input}
        value={value}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 8,
  },
  label: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
    borderRadius: radius.medium,
    borderWidth: 1,
    color: palette.ink,
    fontSize: 18,
    fontWeight: "600",
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  hint: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    paddingHorizontal: 2,
  },
});
