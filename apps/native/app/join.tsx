import { useMemo, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { normalizeInviteCode } from "@may/core";

import { useAppState } from "../src/state/AppState";
import { BackBar, PrimaryButton, ScreenBackground } from "../src/ui/Glass";
import { Field } from "../src/ui/Field";
import { SplashScreen } from "../src/ui/Splash";
import { palette } from "../src/theme";

export default function Join() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { authStatus, isRestoringSession, joinWithCode } = useAppState();

  const [yourName, setYourName] = useState("");
  const [code, setCode] = useState(
    params.code ? normalizeInviteCode(params.code) : "",
  );
  const [isJoining, setIsJoining] = useState(false);

  const canSubmit = useMemo(
    () => yourName.trim().length > 0 && code.trim().length > 0,
    [code, yourName],
  );

  if (authStatus === "loading" || isRestoringSession) {
    return <SplashScreen />;
  }

  if (authStatus === "signed-out") {
    return <Redirect href="/login" />;
  }

  const submit = async () => {
    if (!canSubmit || isJoining) {
      return;
    }
    try {
      setIsJoining(true);
      const joined = await joinWithCode({ yourName, code });
      if (joined) {
        router.replace("/");
        return;
      }
      Alert.alert(
        "That code didn't match",
        "Double-check the code with the parent who invited you.",
      );
    } catch (error) {
      Alert.alert(
        "Could not join the wall",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <BackBar onBack={() => router.back()} />

            <View style={styles.intro}>
              <Text style={styles.title}>Join a wall</Text>
              <Text style={styles.subtitle}>
                Enter the invite code the other parent shared with you, and add
                your name to the wall.
              </Text>
            </View>

            <View style={styles.form}>
              <Field
                autoCapitalize="words"
                autoFocus
                label="Your name"
                onChangeText={setYourName}
                placeholder="e.g. Mom"
                value={yourName}
              />
              <Field
                autoCapitalize="characters"
                label="Invite code"
                onChangeText={(value) => setCode(normalizeInviteCode(value))}
                placeholder="MAY-XXXXX"
                value={code}
              />
            </View>

            <PrimaryButton
              disabled={!canSubmit || isJoining}
              label={isJoining ? "Joining..." : "Join the wall"}
              onPress={submit}
              tone="berry"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: 26,
    padding: 24,
    paddingBottom: 36,
  },
  intro: {
    gap: 12,
  },
  title: {
    color: palette.ink,
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
  },
  subtitle: {
    color: palette.inkMuted,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 23,
  },
  form: {
    gap: 18,
  },
});
