import { useEffect, useMemo, useRef } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Camera, Film, ImageIcon, Mic, Trash2, X } from "lucide-react-native";

import type { MemoryMedia, MemoryMediaKind } from "@may/core";

import { useComposerDraft } from "../src/hooks/useComposerDraft";
import { useAppState } from "../src/state/AppState";
import { useMemoryWallContext } from "../src/state/MemoryWallProvider";
import { ScreenBackground } from "../src/ui/Glass";
import { SplashScreen } from "../src/ui/Splash";
import { tapFeedback } from "../src/ui/haptics";
import { palette, radius, shadow } from "../src/theme";

const mediaTint: Record<MemoryMediaKind, string> = {
  image: palette.moss,
  video: palette.berry,
  audio: palette.ink,
};

export default function Compose() {
  const router = useRouter();
  const {
    authStatus,
    family,
    activeMemberId,
    setActiveMemberId,
    isRestoringSession,
  } = useAppState();
  const { sendMemory, drafts } = useMemoryWallContext();

  const { draftId: draftIdParam } = useLocalSearchParams<{
    draftId?: string;
  }>();
  const existing = useMemo(
    () =>
      draftIdParam
        ? drafts.items.find((draft) => draft.id === draftIdParam)
        : undefined,
    [draftIdParam, drafts.items],
  );

  // One stable draft id per compose session: resume the passed one, or mint a
  // fresh id the first time this screen renders.
  const draftIdRef = useRef<string>("");
  if (!draftIdRef.current) {
    draftIdRef.current = draftIdParam ?? drafts.newDraftId();
  }

  const {
    attachments,
    body,
    canSubmit,
    capture,
    isPicking,
    isRecording,
    pickFromLibrary,
    removeAttachment,
    reset,
    setBody,
    toggleRecording,
  } = useComposerDraft({ body: existing?.body, media: existing?.media });

  // Persist the in-progress draft when leaving without sending, so it can be
  // refined later. Empty drafts are discarded. Refs keep the unmount handler
  // pointed at the latest values without re-subscribing.
  const bodyRef = useRef(body);
  const mediaRef = useRef(attachments);
  const draftsRef = useRef(drafts);
  const submittedRef = useRef(false);
  bodyRef.current = body;
  mediaRef.current = attachments;
  draftsRef.current = drafts;

  useEffect(() => {
    return () => {
      if (submittedRef.current) {
        return;
      }
      const id = draftIdRef.current;
      const hasContent =
        bodyRef.current.trim().length > 0 || mediaRef.current.length > 0;
      if (hasContent) {
        draftsRef.current.save({
          id,
          body: bodyRef.current,
          media: mediaRef.current,
        });
      } else {
        draftsRef.current.remove(id);
      }
    };
  }, []);

  const activeMember = useMemo(
    () =>
      family?.members.find((member) => member.id === activeMemberId) ?? null,
    [family, activeMemberId],
  );

  if (authStatus === "loading" || isRestoringSession) {
    return <SplashScreen />;
  }
  if (authStatus === "signed-out") {
    return <Redirect href="/login" />;
  }
  if (!family || !activeMemberId) {
    return <Redirect href="/welcome" />;
  }

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    tapFeedback();
    submittedRef.current = true;
    drafts.remove(draftIdRef.current);
    sendMemory({ body, media: attachments });
    reset();
    router.back();
  };

  // Tap the author chip to hand the pen to the other parent.
  const switchAuthor = () => {
    const next = family.members.find((member) => member.id !== activeMemberId);
    if (next) {
      setActiveMemberId(next.id);
    }
  };

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.flex}
        >
          <View style={styles.topBar}>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.iconButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <X color={palette.ink} size={20} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={family.members.length < 2}
              onPress={switchAuthor}
              style={styles.authorChip}
            >
              <View style={styles.authorAvatar}>
                <Text style={styles.authorAvatarText}>
                  {activeMember?.initials ?? "?"}
                </Text>
              </View>
              <Text style={styles.authorChipText}>
                {activeMember?.displayName ?? "You"}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TextInput
              autoFocus
              multiline
              onChangeText={setBody}
              placeholder={`Write to ${family.childName}…`}
              placeholderTextColor={palette.inkFaint}
              style={styles.input}
              value={body}
            />

            {attachments.length > 0 ? (
              <View style={styles.attachments}>
                {attachments.map((attachment) => (
                  <AttachmentPreview
                    attachment={attachment}
                    key={attachment.id}
                    onRemove={() => removeAttachment(attachment.id)}
                  />
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.tools}>
              <ToolButton
                disabled={isPicking}
                icon={<Camera color={palette.ink} size={21} />}
                label="Take a photo"
                onPress={() => capture("image")}
              />
              <ToolButton
                disabled={isPicking}
                icon={<Film color={palette.ink} size={21} />}
                label="Record a video"
                onPress={() => capture("video")}
              />
              <ToolButton
                disabled={isPicking}
                icon={<ImageIcon color={palette.ink} size={21} />}
                label="Choose from library"
                onPress={pickFromLibrary}
              />
              <ToolButton
                active={isRecording}
                icon={
                  <Mic color={isRecording ? "#fff" : palette.ink} size={21} />
                }
                label={isRecording ? "Stop recording" : "Record a voice note"}
                onPress={toggleRecording}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={submit}
              style={({ pressed }) => [
                styles.sendButton,
                !canSubmit ? styles.sendButtonDisabled : null,
                pressed && canSubmit ? styles.pressed : null,
              ]}
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

function ToolButton({
  active,
  disabled,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolButton,
        active ? styles.toolButtonActive : null,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {icon}
    </Pressable>
  );
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: MemoryMedia;
  onRemove: () => void;
}) {
  return (
    <View style={styles.attachment}>
      {attachment.kind === "image" ? (
        <Image
          source={{ uri: attachment.uri }}
          style={styles.attachmentImage as ImageStyle}
        />
      ) : (
        <View
          style={[
            styles.attachmentIcon,
            { backgroundColor: mediaTint[attachment.kind] },
          ]}
        >
          {attachment.kind === "video" ? (
            <Film color="#fff" size={22} />
          ) : (
            <Mic color="#fff" size={22} />
          )}
        </View>
      )}
      <Pressable
        accessibilityLabel="Remove attachment"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onRemove}
        style={styles.attachmentRemove}
      >
        <Trash2 color="#fff" size={14} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  iconButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  authorChip: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
    borderRadius: radius.pill,
    flexDirection: "row",
    flexShrink: 1,
    gap: 8,
    paddingLeft: 4,
    paddingRight: 14,
    paddingVertical: 4,
  },
  authorAvatar: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  authorAvatarText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  authorChipText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  body: {
    flexGrow: 1,
    gap: 20,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  input: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 30,
    minHeight: 120,
    padding: 0,
  },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  attachment: {
    height: 92,
    width: 92,
  },
  attachmentImage: {
    backgroundColor: palette.surface,
    borderRadius: radius.medium,
    height: 92,
    width: 92,
  },
  attachmentIcon: {
    alignItems: "center",
    borderRadius: radius.medium,
    height: 92,
    justifyContent: "center",
    width: 92,
  },
  attachmentRemove: {
    alignItems: "center",
    backgroundColor: "rgba(31,28,24,0.66)",
    borderRadius: radius.pill,
    height: 26,
    justifyContent: "center",
    position: "absolute",
    right: 5,
    top: 5,
    width: 26,
  },
  footer: {
    gap: 14,
    paddingBottom: 10,
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  tools: {
    flexDirection: "row",
    gap: 12,
  },
  toolButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
    borderRadius: radius.pill,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  toolButtonActive: {
    backgroundColor: palette.berry,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: radius.medium,
    justifyContent: "center",
    minHeight: 54,
    ...shadow.soft,
  },
  sendButtonDisabled: {
    opacity: 0.32,
  },
  sendButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
