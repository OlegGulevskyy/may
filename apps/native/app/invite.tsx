import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { Check, Send, Share2, Sparkles } from "lucide-react-native";

import { pendingInviteFor } from "@may/core";

import { useAppState } from "../src/state/AppState";
import {
  BackBar,
  GlassCard,
  PrimaryButton,
  ScreenBackground,
} from "../src/ui/Glass";
import { Field } from "../src/ui/Field";
import { SplashScreen } from "../src/ui/Splash";
import { palette, radius } from "../src/theme";

export default function Invite() {
  const router = useRouter();
  const { authStatus, family, addInvite, isRestoringSession } = useAppState();
  const [label, setLabel] = useState("Mom");
  const [isCreating, setIsCreating] = useState(false);

  if (authStatus === "loading" || isRestoringSession) {
    return <SplashScreen />;
  }

  if (authStatus === "signed-out") {
    return <Redirect href="/login" />;
  }

  if (!family) {
    return <Redirect href="/welcome" />;
  }

  const pending = pendingInviteFor(family);
  const partner = family.members.find((member) => member.role === "partner");

  const enterWall = () => router.replace("/");
  const createInvite = async () => {
    if (isCreating || label.trim().length === 0) {
      return;
    }

    try {
      setIsCreating(true);
      await addInvite(label);
    } catch (error) {
      Alert.alert(
        "Could not create the invite",
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  // 1 — Partner already joined: celebrate, then into the wall.
  if (partner) {
    return (
      <Shell onBack={() => router.back()}>
        <View style={styles.intro}>
          <View style={styles.successBadge}>
            <Check color="#fff" size={26} />
          </View>
          <Text style={styles.title}>{partner.displayName} joined</Text>
          <Text style={styles.subtitle}>
            You&apos;re both on the wall now. Every memory either of you adds is
            shared instantly, just between the two of you.
          </Text>
        </View>
        <PrimaryButton label="Open the wall" onPress={enterWall} tone="berry" />
      </Shell>
    );
  }

  // 2 — No invite yet: pick a warm label and generate one.
  if (!pending) {
    return (
      <Shell onBack={() => router.back()}>
        <View style={styles.intro}>
          <Text style={styles.title}>Invite the other parent</Text>
          <Text style={styles.subtitle}>
            Create a private code to share with {family.childName}&apos;s other
            parent so you can both add to the wall.
          </Text>
        </View>

        <Field
          autoCapitalize="words"
          label="Who is this for?"
          onChangeText={setLabel}
          placeholder="e.g. Mom"
          value={label}
        />

        <PrimaryButton
          disabled={label.trim().length === 0 || isCreating}
          label={isCreating ? "Creating..." : "Create the invite"}
          onPress={createInvite}
          tone="berry"
        />
        <Pressable
          accessibilityRole="button"
          onPress={enterWall}
          style={styles.skip}
        >
          <Text style={styles.skipText}>Skip for now</Text>
        </Pressable>
      </Shell>
    );
  }

  // 3 — Invite exists: show the code and share it.
  const inviteLink = Linking.createURL("join", {
    queryParams: { code: pending.code },
  });

  const share = async () => {
    await Share.share({
      message: `Join our May wall for ${family.childName}. Open May and enter code ${pending.code}, or tap: ${inviteLink}`,
    }).catch(() => undefined);
  };

  return (
    <Shell onBack={() => router.back()}>
      <View style={styles.intro}>
        <Text style={styles.title}>Invite {pending.label}</Text>
        <Text style={styles.subtitle}>
          Share this code. When they enter it in May, they&apos;ll join your
          wall for {family.childName}.
        </Text>
      </View>

      <GlassCard intensity={44} lifted style={styles.codeCard}>
        <Text style={styles.codeLabel}>Invite code</Text>
        <Text style={styles.code}>{pending.code}</Text>
        <View style={styles.waiting}>
          <Sparkles color={palette.gold} size={15} />
          <Text style={styles.waitingText}>
            Waiting for {pending.label} to join…
          </Text>
        </View>
      </GlassCard>

      <View style={styles.actions}>
        <PrimaryButton
          icon={<Share2 color="#fff" size={18} />}
          label="Share invite"
          onPress={share}
          tone="berry"
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={enterWall}
        style={styles.skip}
      >
        <Send color={palette.inkMuted} size={15} />
        <Text style={styles.skipText}>Go to the wall</Text>
      </Pressable>
    </Shell>
  );
}

function Shell({
  children,
  onBack,
}: {
  children: React.ReactNode;
  onBack: () => void;
}) {
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
            <BackBar onBack={onBack} />
            {children}
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
    gap: 22,
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
  successBadge: {
    alignItems: "center",
    backgroundColor: palette.moss,
    borderRadius: radius.large,
    height: 60,
    justifyContent: "center",
    width: 60,
  },
  codeCard: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 26,
  },
  codeLabel: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  code: {
    color: palette.ink,
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: 4,
  },
  waiting: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginTop: 4,
  },
  waitingText: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  actions: {
    gap: 12,
  },
  demoNote: {
    backgroundColor: palette.glassFaint,
    borderRadius: radius.medium,
    padding: 14,
  },
  demoNoteText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  skip: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    paddingVertical: 8,
  },
  skipText: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "800",
  },
});
