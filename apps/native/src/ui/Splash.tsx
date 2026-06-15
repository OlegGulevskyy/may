import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { palette } from "../theme";
import { ScreenBackground } from "./Glass";

export function SplashScreen() {
  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <View style={styles.splash}>
        <Text style={styles.mark}>May</Text>
        <ActivityIndicator color={palette.inkMuted} />
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  splash: {
    alignItems: "center",
    flex: 1,
    gap: 18,
    justifyContent: "center",
  },
  mark: {
    color: palette.berry,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
