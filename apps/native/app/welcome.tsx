import { Redirect, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Heart, ImageIcon, Mic, NotebookPen } from "lucide-react-native";

import { useAppState } from "../src/state/AppState";
import {
  GlassButton,
  GlassCard,
  PrimaryButton,
  ScreenBackground,
} from "../src/ui/Glass";
import { SplashScreen } from "../src/ui/Splash";
import { palette, radius } from "../src/theme";

const FEATURES = [
  {
    icon: <NotebookPen color={palette.moss} size={18} />,
    text: "A note from an ordinary, perfect moment",
  },
  {
    icon: <ImageIcon color={palette.gold} size={18} />,
    text: "A photo or a video, kept safely together",
  },
  {
    icon: <Mic color={palette.berry} size={18} />,
    text: "A voice note, so she hears you one day",
  },
];

export default function Welcome() {
  const router = useRouter();
  const { authStatus, isReady, isRestoringSession } = useAppState();

  if (authStatus === "loading" || isRestoringSession) {
    return <SplashScreen />;
  }

  if (authStatus === "signed-out") {
    return <Redirect href="/login" />;
  }

  if (isReady) {
    return <Redirect href="/" />;
  }

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.mark}>
              <Heart color="#fff" fill="#fff" size={22} />
            </View>
            <Text style={styles.kicker}>Dinomay</Text>
            <Text style={styles.title}>
              A quiet place for the moments you want her to keep.
            </Text>
            <Text style={styles.subtitle}>
              Two parents, one shared wall. Capture a memory in seconds — it
              lands gently in her inbox when she&apos;s ready.
            </Text>
          </View>

          <GlassCard intensity={36} style={styles.featureCard}>
            {FEATURES.map((feature, index) => (
              <View
                key={feature.text}
                style={[
                  styles.feature,
                  index > 0 ? styles.featureDivider : null,
                ]}
              >
                <View style={styles.featureIcon}>{feature.icon}</View>
                <Text style={styles.featureText}>{feature.text}</Text>
              </View>
            ))}
          </GlassCard>

          <View style={styles.actions}>
            <PrimaryButton
              label="Create your family"
              onPress={() => router.push("/create-family")}
              tone="berry"
            />
            <GlassButton
              label="I have an invite code"
              onPress={() => router.push("/join")}
            />
          </View>

          <Text style={styles.footnote}>
            Private by design — only you and the other parent can see this wall.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flexGrow: 1,
    gap: 26,
    justifyContent: "center",
    padding: 24,
    paddingVertical: 36,
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
  featureCard: {
    padding: 8,
  },
  feature: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  featureDivider: {
    borderTopColor: "rgba(37,45,43,0.08)",
    borderTopWidth: 1,
  },
  featureIcon: {
    alignItems: "center",
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  featureText: {
    color: palette.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
  actions: {
    gap: 12,
  },
  footnote: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "center",
  },
});
