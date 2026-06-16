import { useMemo, useState } from "react";
import { Redirect, useRouter } from "expo-router";
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

import { useAppState } from "../src/state/AppState";
import { BackBar, PrimaryButton, ScreenBackground } from "../src/ui/Glass";
import { Field } from "../src/ui/Field";
import { SplashScreen } from "../src/ui/Splash";
import { palette } from "../src/theme";

const looksLikeEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

export default function CreateFamily() {
  const router = useRouter();
  const { authStatus, createProfileAndFamily, isReady, isRestoringSession } =
    useAppState();

  const [yourName, setYourName] = useState("");
  const [childName, setChildName] = useState("");
  const [childEmail, setChildEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () =>
      yourName.trim().length > 0 &&
      childName.trim().length > 0 &&
      looksLikeEmail(childEmail),
    [childEmail, childName, yourName],
  );

  if (authStatus === "loading" || isRestoringSession) {
    return <SplashScreen />;
  }

  if (authStatus === "signed-out") {
    return <Redirect href="/login" />;
  }

  if (isReady) {
    return <Redirect href="/" />;
  }

  const submit = async () => {
    if (!canSubmit || isSubmitting) {
      return;
    }
    try {
      setIsSubmitting(true);
      await createProfileAndFamily({ yourName, childName, childEmail });
      router.replace("/invite");
    } catch (error) {
      Alert.alert("Could not create the family", getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
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
              <Text style={styles.title}>Create your family</Text>
              <Text style={styles.subtitle}>
                This is your private wall. Tell us who you are and whose inbox
                these memories are for.
              </Text>
            </View>

            <View style={styles.form}>
              <Field
                autoCapitalize="words"
                autoFocus
                label="Your name"
                onChangeText={setYourName}
                placeholder="e.g. Oleg"
                value={yourName}
              />
              <Field
                autoCapitalize="words"
                label="Your child's name"
                onChangeText={setChildName}
                placeholder="e.g. Dinomay"
                value={childName}
              />
              <Field
                autoCapitalize="none"
                hint="Memories are delivered here later — she doesn't use the app."
                keyboardType="email-address"
                label="Her Gmail inbox"
                onChangeText={setChildEmail}
                placeholder="her.name@gmail.com"
                value={childEmail}
              />
            </View>

            <PrimaryButton
              disabled={!canSubmit || isSubmitting}
              label={isSubmitting ? "Creating..." : "Create the wall"}
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
