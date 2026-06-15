import { useState } from "react";
import { Redirect } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Heart, LogIn } from "lucide-react-native";

import { useAppState } from "../src/state/AppState";
import { GlassCard, PrimaryButton, ScreenBackground } from "../src/ui/Glass";
import { SplashScreen } from "../src/ui/Splash";
import { palette, radius } from "../src/theme";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export default function Login() {
  const { authStatus, signInWithGoogle } = useAppState();
  const [isSigningIn, setIsSigningIn] = useState(false);

  if (authStatus === "loading") {
    return <SplashScreen />;
  }

  if (authStatus === "signed-in") {
    return <Redirect href="/" />;
  }

  const submit = async () => {
    if (isSigningIn) {
      return;
    }

    try {
      setIsSigningIn(true);
      await signInWithGoogle();
    } catch (error) {
      Alert.alert("Could not sign in", getErrorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.hero}>
            <View style={styles.mark}>
              <Heart color="#fff" fill="#fff" size={22} />
            </View>
            <Text style={styles.kicker}>May</Text>
            <Text style={styles.title}>Sign in to your family wall.</Text>
            <Text style={styles.subtitle}>
              Use Google so your wall follows you after reinstalling the app or
              setting up a new phone.
            </Text>
          </View>

          <GlassCard intensity={36} style={styles.card}>
            <PrimaryButton
              disabled={isSigningIn}
              icon={<LogIn color="#fff" size={18} />}
              label={isSigningIn ? "Signing in..." : "Continue with Google"}
              onPress={submit}
              tone="berry"
            />
          </GlassCard>
        </View>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    gap: 28,
    justifyContent: "center",
    padding: 24,
  },
  hero: {
    gap: 14,
  },
  mark: {
    alignItems: "center",
    backgroundColor: palette.berry,
    borderRadius: radius.large,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  kicker: {
    color: palette.berry,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    color: palette.ink,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 40,
  },
  subtitle: {
    color: palette.inkMuted,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 24,
  },
  card: {
    gap: 14,
    padding: 16,
  },
});
