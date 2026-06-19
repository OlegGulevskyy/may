import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type TextInput as TextInputHandle,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  Camera,
  Film,
  ImageIcon,
  Mic,
  Play,
  Trash2,
  X,
} from "lucide-react-native";

import {
  richTextImageSources,
  richTextPlainText,
  type MemoryContentImageMap,
  type MemoryMedia,
  type MemoryMediaKind,
  type MemoryRichTextDocument,
  type MemoryRichTextNode,
} from "@may/core";

import { useComposerDraft } from "../src/hooks/useComposerDraft";
import { useAppState } from "../src/state/AppState";
import { useMemoryWallContext } from "../src/state/MemoryWallProvider";
import { AudioMediaPlayer } from "../src/ui/AudioMediaPlayer";
import { ScreenBackground } from "../src/ui/Glass";
import { HapticPressable as Pressable } from "../src/ui/HapticPressable";
import { SplashScreen } from "../src/ui/Splash";
import { palette, radius, shadow } from "../src/theme";

const mediaTint: Record<MemoryMediaKind, string> = {
  image: palette.moss,
  video: palette.berry,
  audio: palette.ink,
};

type ComposerTextSegment = {
  id: string;
  text: string;
  type: "text";
};

type ComposerImageSegment = {
  id: string;
  mediaId: string;
  type: "image";
  uri: string;
};

type ComposerSegment = ComposerTextSegment | ComposerImageSegment;

type TextSelection = {
  end: number;
  segmentId: string;
  start: number;
};

const createSegmentId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const textSegment = (text = ""): ComposerTextSegment => ({
  id: createSegmentId("text"),
  text,
  type: "text",
});

const imageSegment = (media: MemoryMedia): ComposerImageSegment => ({
  id: createSegmentId("image"),
  mediaId: media.id,
  type: "image",
  uri: media.uri,
});

const nodeText = (node: MemoryRichTextNode): string => {
  if (typeof node.text === "string") {
    return node.text;
  }

  const children = node.content?.map(nodeText).join("") ?? "";

  switch (node.type) {
    case "hardBreak":
      return "\n";
    case "paragraph":
    case "heading":
    case "blockquote":
      return children ? `${children}\n` : "\n";
    case "bulletList":
    case "orderedList":
      return children ? `${children}\n` : "";
    case "image":
      return "";
    default:
      return children;
  }
};

const mediaForContentImage = (
  source: string,
  contentImageMap: MemoryContentImageMap | undefined,
  media: MemoryMedia[],
) => {
  const mappedId = contentImageMap?.[source];
  return media.find(
    (item) =>
      item.id === mappedId ||
      item.uri === source ||
      item.thumbnailUri === source,
  );
};

const segmentsFromContent = ({
  body,
  content,
  contentImageMap,
  media,
}: {
  body?: string;
  content?: MemoryRichTextDocument;
  contentImageMap?: MemoryContentImageMap;
  media?: MemoryMedia[];
}): ComposerSegment[] => {
  const segments: ComposerSegment[] = [];
  const availableMedia = media ?? [];

  content?.content?.forEach((node) => {
    const source = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    if (node.type === "image" && source) {
      const item = mediaForContentImage(
        source,
        contentImageMap,
        availableMedia,
      );
      segments.push({
        id: createSegmentId("image"),
        mediaId: item?.id ?? createSegmentId("media"),
        type: "image",
        uri: item?.uri ?? source,
      });
      return;
    }

    const text = nodeText(node).trimEnd();
    if (text.length > 0) {
      segments.push(textSegment(text));
    }
  });

  if (segments.length === 0) {
    segments.push(textSegment(body ?? ""));
  }

  const hasTextSegment = segments.some((segment) => segment.type === "text");
  if (!hasTextSegment) {
    segments.push(textSegment());
  }

  return segments;
};

const textNodesFromValue = (value: string): MemoryRichTextNode[] =>
  value.split(/\r?\n/).map((line) => ({
    content:
      line.length > 0
        ? [
            {
              text: line,
              type: "text",
            },
          ]
        : undefined,
    type: "paragraph",
  }));

const contentFromSegments = (
  segments: ComposerSegment[],
): MemoryRichTextDocument => ({
  content: segments.flatMap((segment) => {
    if (segment.type === "image") {
      return [
        {
          attrs: { src: segment.uri },
          type: "image",
        },
      ];
    }

    return segment.text.trim().length > 0
      ? textNodesFromValue(segment.text)
      : [];
  }),
  type: "doc",
});

const contentImageMapFromSegments = (
  segments: ComposerSegment[],
): MemoryContentImageMap =>
  Object.fromEntries(
    segments
      .filter(
        (segment): segment is ComposerImageSegment => segment.type === "image",
      )
      .map((segment) => [segment.uri, segment.mediaId]),
  );

const inlineImageMediaIds = (segments: ComposerSegment[]) =>
  new Set(
    segments
      .filter(
        (segment): segment is ComposerImageSegment => segment.type === "image",
      )
      .map((segment) => segment.mediaId),
  );

type ImagePlacementSource = "camera" | "library";

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

  const initialSegments = useMemo(
    () =>
      segmentsFromContent({
        body: existing?.body,
        content: existing?.content,
        contentImageMap: existing?.contentImageMap,
        media: existing?.media,
      }),
    [
      existing?.body,
      existing?.content,
      existing?.contentImageMap,
      existing?.media,
    ],
  );
  const [segments, setSegments] = useState<ComposerSegment[]>(
    () => initialSegments,
  );
  const [emailSubject, setEmailSubject] = useState(
    () => existing?.emailSubject ?? "",
  );
  const [activeSelection, setActiveSelection] = useState<TextSelection>(() => {
    const firstText = initialSegments.find(
      (segment): segment is ComposerTextSegment => segment.type === "text",
    );

    return {
      end: firstText?.text.length ?? 0,
      segmentId: firstText?.id ?? "",
      start: firstText?.text.length ?? 0,
    };
  });
  const [imagePlacementSource, setImagePlacementSource] =
    useState<ImagePlacementSource | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRefs = useRef<Record<string, TextInputHandle | null>>({});

  const {
    attachments,
    capture,
    isPicking,
    isRecording,
    pickFromLibrary,
    recordingWaveformPreview,
    removeAttachment,
    reset,
    toggleRecording,
  } = useComposerDraft({ media: existing?.media });
  const content = useMemo(() => contentFromSegments(segments), [segments]);
  const contentImageMap = useMemo(
    () => contentImageMapFromSegments(segments),
    [segments],
  );
  const inlineMediaIds = useMemo(
    () => inlineImageMediaIds(segments),
    [segments],
  );
  const body = richTextPlainText(content).trim();
  const visibleAttachments = useMemo(
    () =>
      attachments.filter((attachment) => !inlineMediaIds.has(attachment.id)),
    [attachments, inlineMediaIds],
  );
  const inlineImageCount = inlineMediaIds.size;
  const canSubmit =
    !isSubmitting &&
    (body.length > 0 || visibleAttachments.length > 0 || inlineImageCount > 0);

  const focusTextSegment = useCallback((segmentId: string, cursor = 0) => {
    requestAnimationFrame(() => {
      const input = inputRefs.current[segmentId];
      input?.focus();
      input?.setNativeProps({
        selection: { end: cursor, start: cursor },
      });
    });
  }, []);

  const focusFirstBodySegment = useCallback(() => {
    const firstText = segments.find(
      (segment): segment is ComposerTextSegment => segment.type === "text",
    );
    if (firstText) {
      focusTextSegment(firstText.id, firstText.text.length);
    }
  }, [focusTextSegment, segments]);

  const updateTextSegment = useCallback((segmentId: string, text: string) => {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === segmentId && segment.type === "text"
          ? { ...segment, text }
          : segment,
      ),
    );
  }, []);

  const insertInlineImages = useCallback(
    (pickedMedia: MemoryMedia[]) => {
      const images = pickedMedia.filter((item) => item.kind === "image");
      if (images.length === 0) {
        return;
      }

      const imageSegments = images.map(imageSegment);
      const nextText = textSegment();

      setSegments((current) => {
        const index = current.findIndex(
          (segment) =>
            segment.type === "text" && segment.id === activeSelection.segmentId,
        );

        if (index < 0) {
          return [...current, ...imageSegments, nextText];
        }

        const selected = current[index] as ComposerTextSegment;
        const start = Math.max(
          0,
          Math.min(selected.text.length, activeSelection.start),
        );
        const end = Math.max(
          start,
          Math.min(selected.text.length, activeSelection.end),
        );
        const before = selected.text.slice(0, start);
        const after = selected.text.slice(end);
        const replacement: ComposerSegment[] = [
          ...(before.length > 0 ? [{ ...selected, text: before }] : []),
          ...imageSegments,
          { ...nextText, text: after },
        ];

        return [
          ...current.slice(0, index),
          ...replacement,
          ...current.slice(index + 1),
        ];
      });

      setActiveSelection({
        end: 0,
        segmentId: nextText.id,
        start: 0,
      });
      focusTextSegment(nextText.id);
    },
    [activeSelection, focusTextSegment],
  );

  const pickInlineImages = useCallback(() => {
    setImagePlacementSource(null);
    pickFromLibrary().then(insertInlineImages);
  }, [insertInlineImages, pickFromLibrary]);

  const pickAttachmentMedia = useCallback(() => {
    setImagePlacementSource(null);
    pickFromLibrary();
  }, [pickFromLibrary]);

  const captureInlineImage = useCallback(() => {
    setImagePlacementSource(null);
    capture("image").then(insertInlineImages);
  }, [capture, insertInlineImages]);

  const captureAttachmentImage = useCallback(() => {
    setImagePlacementSource(null);
    capture("image");
  }, [capture]);

  const insertInlineMedia = useCallback(() => {
    if (imagePlacementSource === "camera") {
      captureInlineImage();
      return;
    }

    pickInlineImages();
  }, [captureInlineImage, imagePlacementSource, pickInlineImages]);

  const insertAttachmentMedia = useCallback(() => {
    if (imagePlacementSource === "camera") {
      captureAttachmentImage();
      return;
    }

    pickAttachmentMedia();
  }, [captureAttachmentImage, imagePlacementSource, pickAttachmentMedia]);

  const removeInlineImage = useCallback(
    (segmentId: string, mediaId: string) => {
      setSegments((current) => {
        const next = current.filter((segment) => segment.id !== segmentId);
        return next.some((segment) => segment.type === "text")
          ? next
          : [textSegment()];
      });
      removeAttachment(mediaId);
    },
    [removeAttachment],
  );

  // Persist the in-progress draft when leaving without sending, so it can be
  // refined later. Empty drafts are discarded. Refs keep the unmount handler
  // pointed at the latest values without re-subscribing.
  const bodyRef = useRef(body);
  const emailSubjectRef = useRef(emailSubject);
  const contentRef = useRef<MemoryRichTextDocument>(content);
  const contentImageMapRef = useRef<MemoryContentImageMap>(contentImageMap);
  const mediaRef = useRef(attachments);
  const draftsRef = useRef(drafts);
  const submittedRef = useRef(false);
  bodyRef.current = body;
  emailSubjectRef.current = emailSubject;
  contentRef.current = content;
  contentImageMapRef.current = contentImageMap;
  mediaRef.current = attachments;
  draftsRef.current = drafts;

  useEffect(() => {
    return () => {
      if (submittedRef.current) {
        return;
      }
      const id = draftIdRef.current;
      const content = contentRef.current;
      const hasContent =
        emailSubjectRef.current.trim().length > 0 ||
        bodyRef.current.trim().length > 0 ||
        richTextImageSources(content).length > 0 ||
        mediaRef.current.length > 0;
      if (hasContent) {
        draftsRef.current.save({
          id,
          emailSubject: emailSubjectRef.current,
          body: bodyRef.current,
          content,
          contentImageMap: contentImageMapRef.current,
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
    setIsSubmitting(true);

    submittedRef.current = true;
    drafts.remove(draftIdRef.current);
    sendMemory({
      emailSubject,
      body,
      content,
      contentImageMap,
      media: attachments,
    });
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
                {activeMember?.photoURL ? (
                  <Image
                    source={{ uri: activeMember.photoURL }}
                    style={styles.authorAvatarImage as ImageStyle}
                  />
                ) : (
                  <Text style={styles.authorAvatarText}>
                    {activeMember?.initials ?? "?"}
                  </Text>
                )}
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
            <View style={styles.subjectShell}>
              <TextInput
                autoCapitalize="sentences"
                autoFocus
                blurOnSubmit={false}
                maxLength={160}
                onChangeText={setEmailSubject}
                onSubmitEditing={focusFirstBodySegment}
                placeholder="Email subject..."
                placeholderTextColor={palette.inkFaint}
                returnKeyType="next"
                style={styles.subjectInput}
                value={emailSubject}
              />
            </View>

            <View style={styles.subjectDivider} />

            <View style={styles.editorShell}>
              {segments.map((segment, index) =>
                segment.type === "text" ? (
                  <TextInput
                    key={segment.id}
                    multiline
                    onChangeText={(value) =>
                      updateTextSegment(segment.id, value)
                    }
                    onFocus={() =>
                      setActiveSelection({
                        end: segment.text.length,
                        segmentId: segment.id,
                        start: segment.text.length,
                      })
                    }
                    onSelectionChange={({ nativeEvent }) =>
                      setActiveSelection({
                        end: nativeEvent.selection.end,
                        segmentId: segment.id,
                        start: nativeEvent.selection.start,
                      })
                    }
                    placeholder={
                      body.length === 0 &&
                      inlineImageCount === 0 &&
                      segments.findIndex((item) => item.type === "text") ===
                        index
                        ? `Write to ${family.childName}…`
                        : undefined
                    }
                    placeholderTextColor={palette.inkFaint}
                    ref={(input) => {
                      inputRefs.current[segment.id] = input;
                    }}
                    scrollEnabled={false}
                    style={[
                      styles.input,
                      segment.text.length === 0 && index > 0
                        ? styles.inputEmptyContinuation
                        : null,
                    ]}
                    value={segment.text}
                  />
                ) : (
                  <InlineImagePreview
                    key={segment.id}
                    onRemove={() =>
                      removeInlineImage(segment.id, segment.mediaId)
                    }
                    uri={segment.uri}
                  />
                ),
              )}
            </View>

            {visibleAttachments.length > 0 ? (
              <View style={styles.attachments}>
                {visibleAttachments.map((attachment) => (
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
            {imagePlacementSource ? (
              <View style={styles.insertMenu}>
                <Pressable
                  accessibilityLabel={
                    imagePlacementSource === "camera"
                      ? "Take inline photo"
                      : "Choose inline images"
                  }
                  accessibilityRole="button"
                  onPress={insertInlineMedia}
                  style={({ pressed }) => [
                    styles.insertMenuItem,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.insertMenuText}>Inline</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={
                    imagePlacementSource === "camera"
                      ? "Take photo attachment"
                      : "Choose attachment media"
                  }
                  accessibilityRole="button"
                  onPress={insertAttachmentMedia}
                  style={({ pressed }) => [
                    styles.insertMenuItem,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.insertMenuText}>Attachment</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.tools}>
              <ToolButton
                disabled={isPicking}
                icon={<Camera color={palette.ink} size={21} />}
                label="Take a photo"
                onPress={() =>
                  setImagePlacementSource((source) =>
                    source === "camera" ? null : "camera",
                  )
                }
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
                onPress={() =>
                  setImagePlacementSource((source) =>
                    source === "library" ? null : "library",
                  )
                }
              />
              <ToolButton
                active={isRecording}
                activeLabel="Recording"
                icon={
                  <Mic color={isRecording ? "#fff" : palette.ink} size={21} />
                }
                label={isRecording ? "Stop recording" : "Record a voice note"}
                onPress={toggleRecording}
                waveformPeaks={recordingWaveformPreview}
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
  activeLabel,
  disabled,
  icon,
  label,
  onPress,
  waveformPeaks,
}: {
  active?: boolean;
  activeLabel?: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
  waveformPeaks?: number[];
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
      {active && activeLabel ? (
        <View style={styles.recordingButtonContent}>
          {icon}
          <Text style={styles.recordingButtonText}>{activeLabel}</Text>
          <RecordingWaveform peaks={waveformPeaks ?? []} />
        </View>
      ) : (
        icon
      )}
    </Pressable>
  );
}

function RecordingWaveform({ peaks }: { peaks: number[] }) {
  const phase = useRef(new Animated.Value(0)).current;
  const bars = useMemo(() => {
    const fallback = [0.2, 0.48, 0.72, 0.42, 0.62];
    const source = peaks.length > 0 ? peaks : fallback;

    return Array.from({ length: 5 }, (_, index) => {
      const peak = source[Math.max(0, source.length - 5 + index)] ?? 0;
      return Math.max(0.18, Math.min(1, peak));
    });
  }, [peaks]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(phase, {
        duration: 760,
        easing: Easing.inOut(Easing.sin),
        toValue: 1,
        useNativeDriver: true,
      }),
    );

    animation.start();

    return () => {
      animation.stop();
      phase.setValue(0);
    };
  }, [phase]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.recordingWaveform}
    >
      {bars.map((peak, index) => {
        const scaleY = phase.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [
            0.7 + ((index + 1) % 2) * 0.12,
            1.18 - (index % 3) * 0.09,
            0.76 + (index % 2) * 0.16,
          ],
        });

        return (
          <Animated.View
            key={`recording-bar-${index}`}
            style={[
              styles.recordingWaveformBar,
              {
                height: 7 + peak * 12,
                transform: [{ scaleY }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function InlineImagePreview({
  onRemove,
  uri,
}: {
  onRemove: () => void;
  uri: string;
}) {
  return (
    <View style={styles.inlineImage}>
      <Image
        resizeMode="cover"
        source={{ uri }}
        style={styles.inlineImageMedia as ImageStyle}
      />
      <Pressable
        accessibilityLabel="Remove inline image"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onRemove}
        style={styles.inlineImageRemove}
      >
        <Trash2 color="#fff" size={14} />
      </Pressable>
    </View>
  );
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: MemoryMedia;
  onRemove: () => void;
}) {
  if (attachment.kind === "audio") {
    return (
      <View style={styles.audioAttachment}>
        <AudioMediaPlayer
          media={attachment}
          style={styles.audioAttachmentPlayer}
        />
        <Pressable
          accessibilityLabel="Remove voice note"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onRemove}
          style={styles.audioAttachmentRemove}
        >
          <Trash2 color={palette.inkMuted} size={19} />
        </Pressable>
      </View>
    );
  }

  const thumbnailUri =
    attachment.kind === "image" ? attachment.uri : attachment.thumbnailUri;

  return (
    <View style={styles.attachment}>
      {thumbnailUri ? (
        <Image
          source={{ uri: thumbnailUri }}
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
      {attachment.kind === "video" ? (
        <View style={styles.attachmentVideoBadge}>
          <Play color="#fff" fill="#fff" size={13} />
        </View>
      ) : null}
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
    overflow: "hidden",
    width: 28,
  },
  authorAvatarImage: {
    height: "100%",
    width: "100%",
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
    gap: 12,
    paddingHorizontal: 22,
    paddingTop: 8,
  },
  subjectShell: {
    paddingTop: 2,
  },
  subjectInput: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 25,
    minHeight: 46,
    padding: 0,
  },
  subjectDivider: {
    backgroundColor: "rgba(37,45,43,0.12)",
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
  editorShell: {
    minHeight: 220,
    paddingHorizontal: 0,
    paddingTop: 12,
  },
  input: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 25,
    minHeight: 46,
    padding: 0,
  },
  inputEmptyContinuation: {
    minHeight: 38,
  },
  inlineImage: {
    aspectRatio: 4 / 3,
    backgroundColor: palette.surface,
    borderRadius: radius.medium,
    marginVertical: 8,
    overflow: "hidden",
    width: "100%",
  },
  inlineImageMedia: {
    height: "100%",
    width: "100%",
  },
  inlineImageRemove: {
    alignItems: "center",
    backgroundColor: "rgba(31,28,24,0.66)",
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
  },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  audioAttachment: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  audioAttachmentPlayer: {
    flex: 1,
    height: 76,
    minWidth: 0,
  },
  audioAttachmentRemove: {
    alignItems: "center",
    height: 46,
    justifyContent: "center",
    marginTop: 7,
    width: 36,
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
  attachmentVideoBadge: {
    alignItems: "center",
    backgroundColor: "rgba(31,28,24,0.66)",
    borderRadius: radius.pill,
    height: 30,
    justifyContent: "center",
    left: 31,
    position: "absolute",
    top: 31,
    width: 30,
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
  insertMenu: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.82)",
    borderColor: "rgba(74,64,51,0.08)",
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 6,
    ...shadow.soft,
  },
  insertMenuItem: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
    borderRadius: radius.small,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  insertMenuText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  tools: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
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
    backgroundColor: palette.ink,
    paddingHorizontal: 10,
    width: 140,
  },
  recordingButtonContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  recordingButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "900",
  },
  recordingWaveform: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    height: 22,
    justifyContent: "center",
    width: 25,
  },
  recordingWaveformBar: {
    backgroundColor: "rgba(255,255,255,0.82)",
    borderRadius: 2,
    width: 3,
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
