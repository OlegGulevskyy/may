import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import {
  Camera,
  Film,
  Heart,
  ImageIcon,
  Mail,
  MessageCircle,
  Mic,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react-native";

import {
  DELIVERY_LABELS,
  MEMORY_AUTHORS,
  type MemoryAuthorId,
  type MemoryMedia,
  type MemoryMediaKind,
  type MemoryPost,
} from "@repo/core";

import { useMemoryWall } from "../src/hooks/useMemoryWall";
import { persistPickedAsset } from "../src/services/localMedia";
import { palette, radius, shadow } from "../src/theme";

type DraftAttachment = MemoryMedia;

const mediaTint: Record<MemoryMediaKind, string> = {
  image: palette.moss,
  video: palette.berry,
  audio: palette.ink,
};

export default function Native() {
  const {
    activeAuthorId,
    addComment,
    clearLocalData,
    forcedOffline,
    hydrated,
    isOnline,
    posts,
    retryPost,
    sendMemory,
    setActiveAuthorId,
    toggleForcedOffline,
    toggleReaction,
  } = useMemoryWall();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [isPicking, setIsPicking] = useState(false);
  const audioRecorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    directory: "document",
  });
  const recorderState = useAudioRecorderState(audioRecorder);

  useEffect(() => {
    const prepareAudio = async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    };

    prepareAudio().catch(() => undefined);
  }, []);

  const deliveryCounts = useMemo(
    () => ({
      queued: posts.filter((post) => post.status !== "delivered").length,
      delivered: posts.filter((post) => post.status === "delivered").length,
    }),
    [posts],
  );

  const addPickedAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, kind: MemoryMediaKind) => {
      const persisted = await persistPickedAsset(asset, kind);
      setAttachments((current) => [...current, persisted]);
    },
    [],
  );

  const capture = useCallback(
    async (kind: "image" | "video") => {
      try {
        setIsPicking(true);
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("Camera permission", "Camera access is needed first.");
          return;
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: [kind === "image" ? "images" : "videos"],
          quality: 0.85,
          videoMaxDuration: 90,
        });

        if (!result.canceled && result.assets[0]) {
          await addPickedAsset(result.assets[0], kind);
        }
      } catch (error) {
        Alert.alert("Capture failed", getErrorMessage(error));
      } finally {
        setIsPicking(false);
      }
    },
    [addPickedAsset],
  );

  const pickFromLibrary = useCallback(async () => {
    try {
      setIsPicking(true);
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo permission", "Library access is needed first.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ["images", "videos"],
        quality: 0.9,
        selectionLimit: 6,
      });

      if (!result.canceled) {
        const next = await Promise.all(
          result.assets.map((asset) =>
            persistPickedAsset(
              asset,
              asset.type === "video" ? "video" : "image",
            ),
          ),
        );
        setAttachments((current) => [...current, ...next]);
      }
    } catch (error) {
      Alert.alert("Picker failed", getErrorMessage(error));
    } finally {
      setIsPicking(false);
    }
  }, []);

  const toggleRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert("Microphone permission", "Microphone access is needed.");
        return;
      }

      if (recorderState.isRecording) {
        await audioRecorder.stop();
        const recordingUri = audioRecorder.uri;
        if (!recordingUri) {
          return;
        }

        setAttachments((current) => [
          ...current,
          {
            id: `media_${Date.now().toString(36)}`,
            kind: "audio",
            uri: recordingUri,
            durationMs: recorderState.durationMillis ?? 0,
            mimeType: "audio/m4a",
            fileName: `voice-${Date.now()}.m4a`,
          },
        ]);
        return;
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (error) {
      Alert.alert("Recording failed", getErrorMessage(error));
    }
  }, [audioRecorder, recorderState.durationMillis, recorderState.isRecording]);

  const submit = useCallback(() => {
    if (!body.trim() && attachments.length === 0) {
      return;
    }

    sendMemory({
      body,
      media: attachments,
    });
    setBody("");
    setAttachments([]);
  }, [attachments, body, sendMemory]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const submitComment = useCallback(
    (postId: string) => {
      const comment = commentDrafts[postId]?.trim();
      if (!comment) {
        return;
      }

      addComment(postId, comment);
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
    },
    [addComment, commentDrafts],
  );

  return (
    <LinearGradient
      colors={["#f8efe4", "#ecf4ee", "#f7f0ec"]}
      style={styles.screen}
    >
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardAvoiding}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Header
              activeAuthorId={activeAuthorId}
              deliveredCount={deliveryCounts.delivered}
              forcedOffline={forcedOffline}
              isOnline={isOnline}
              pendingCount={deliveryCounts.queued}
              setActiveAuthorId={setActiveAuthorId}
              toggleForcedOffline={toggleForcedOffline}
            />

            <Composer
              attachments={attachments}
              body={body}
              isOnline={isOnline}
              isPicking={isPicking}
              isRecording={recorderState.isRecording}
              onBodyChange={setBody}
              onCapturePhoto={() => capture("image")}
              onCaptureVideo={() => capture("video")}
              onPickLibrary={pickFromLibrary}
              onRecordAudio={toggleRecording}
              onRemoveAttachment={removeAttachment}
              onSubmit={submit}
            />

            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>Memory wall</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Alert.alert(
                    "Clear local POC data?",
                    "This only clears the local demo timeline on this device.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Clear",
                        style: "destructive",
                        onPress: clearLocalData,
                      },
                    ],
                  );
                }}
                style={styles.iconAction}
              >
                <Trash2 color={palette.inkMuted} size={16} />
              </Pressable>
            </View>

            {!hydrated ? (
              <Text style={styles.emptyText}>Loading local memories...</Text>
            ) : posts.length === 0 ? (
              <Text style={styles.emptyText}>
                Start with a note, photo, video, or voice recording.
              </Text>
            ) : (
              posts.map((post) => (
                <MemoryCard
                  activeAuthorId={activeAuthorId}
                  commentDraft={commentDrafts[post.id] ?? ""}
                  key={post.id}
                  onCommentChange={(value) =>
                    setCommentDrafts((current) => ({
                      ...current,
                      [post.id]: value,
                    }))
                  }
                  onRetry={() => retryPost(post.id)}
                  onSubmitComment={() => submitComment(post.id)}
                  onToggleHeart={() => toggleReaction(post.id, "heart")}
                  post={post}
                />
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Header({
  activeAuthorId,
  deliveredCount,
  forcedOffline,
  isOnline,
  pendingCount,
  setActiveAuthorId,
  toggleForcedOffline,
}: {
  activeAuthorId: MemoryAuthorId;
  deliveredCount: number;
  forcedOffline: boolean;
  isOnline: boolean;
  pendingCount: number;
  setActiveAuthorId: (authorId: MemoryAuthorId) => void;
  toggleForcedOffline: () => void;
}) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.kicker}>May</Text>
        <Text style={styles.title}>For her inbox, from our day.</Text>
      </View>

      <View style={styles.headerControls}>
        <Pressable
          accessibilityRole="button"
          onPress={toggleForcedOffline}
          style={[
            styles.networkPill,
            forcedOffline || !isOnline ? styles.networkPillOffline : null,
          ]}
        >
          {isOnline ? (
            <Wifi color={palette.moss} size={16} />
          ) : (
            <WifiOff color={palette.berry} size={16} />
          )}
          <Text style={styles.networkText}>
            {isOnline ? "Online" : "Offline"}
          </Text>
        </Pressable>

        <View style={styles.authorSwitch}>
          {(["dad", "mom"] as MemoryAuthorId[]).map((authorId) => (
            <Pressable
              accessibilityRole="button"
              key={authorId}
              onPress={() => setActiveAuthorId(authorId)}
              style={[
                styles.authorButton,
                activeAuthorId === authorId ? styles.authorButtonActive : null,
              ]}
            >
              <Text
                style={[
                  styles.authorButtonText,
                  activeAuthorId === authorId
                    ? styles.authorButtonTextActive
                    : null,
                ]}
              >
                {MEMORY_AUTHORS[authorId].initials}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatPill
          icon={<Mail color={palette.ink} size={16} />}
          value={deliveredCount}
          label="sent"
        />
        <StatPill
          icon={<RefreshCw color={palette.ink} size={16} />}
          value={pendingCount}
          label="syncing"
        />
      </View>
    </View>
  );
}

function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <BlurView intensity={28} style={styles.statPill} tint="light">
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </BlurView>
  );
}

function Composer({
  attachments,
  body,
  isOnline,
  isPicking,
  isRecording,
  onBodyChange,
  onCapturePhoto,
  onCaptureVideo,
  onPickLibrary,
  onRecordAudio,
  onRemoveAttachment,
  onSubmit,
}: {
  attachments: DraftAttachment[];
  body: string;
  isOnline: boolean;
  isPicking: boolean;
  isRecording: boolean;
  onBodyChange: (value: string) => void;
  onCapturePhoto: () => void;
  onCaptureVideo: () => void;
  onPickLibrary: () => void;
  onRecordAudio: () => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
}) {
  const canSubmit = body.trim().length > 0 || attachments.length > 0;

  return (
    <BlurView intensity={48} style={styles.composer} tint="light">
      <TextInput
        multiline
        onChangeText={onBodyChange}
        placeholder="Write to her..."
        placeholderTextColor={palette.inkFaint}
        style={styles.input}
        value={body}
      />

      {attachments.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.attachments}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {attachments.map((attachment) => (
            <AttachmentChip
              attachment={attachment}
              key={attachment.id}
              onRemove={() => onRemoveAttachment(attachment.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.composerActions}>
        <View style={styles.mediaActions}>
          <ToolButton
            disabled={isPicking}
            icon={<Camera color={palette.ink} size={19} />}
            label="Photo"
            onPress={onCapturePhoto}
          />
          <ToolButton
            disabled={isPicking}
            icon={<Film color={palette.ink} size={19} />}
            label="Video"
            onPress={onCaptureVideo}
          />
          <ToolButton
            disabled={isPicking}
            icon={<ImageIcon color={palette.ink} size={19} />}
            label="Library"
            onPress={onPickLibrary}
          />
          <ToolButton
            active={isRecording}
            icon={<Mic color={isRecording ? "#fff" : palette.ink} size={19} />}
            label={isRecording ? "Stop" : "Voice"}
            onPress={onRecordAudio}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={onSubmit}
          style={[styles.sendButton, !canSubmit ? styles.disabledButton : null]}
        >
          <Send color="#fff" size={18} />
          <Text style={styles.sendText}>{isOnline ? "Send" : "Queue"}</Text>
        </Pressable>
      </View>
    </BlurView>
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
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.toolButton,
        active ? styles.toolButtonActive : null,
        disabled ? styles.disabledButton : null,
      ]}
    >
      {icon}
      <Text style={[styles.toolText, active ? styles.toolTextActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: DraftAttachment;
  onRemove: () => void;
}) {
  return (
    <View style={styles.attachmentChip}>
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
            <Film color="#fff" size={18} />
          ) : (
            <Mic color="#fff" size={18} />
          )}
        </View>
      )}
      <Text numberOfLines={1} style={styles.attachmentName}>
        {attachment.kind}
      </Text>
      <Pressable accessibilityRole="button" onPress={onRemove}>
        <Trash2 color={palette.inkMuted} size={15} />
      </Pressable>
    </View>
  );
}

function MemoryCard({
  activeAuthorId,
  commentDraft,
  onCommentChange,
  onRetry,
  onSubmitComment,
  onToggleHeart,
  post,
}: {
  activeAuthorId: MemoryAuthorId;
  commentDraft: string;
  onCommentChange: (value: string) => void;
  onRetry: () => void;
  onSubmitComment: () => void;
  onToggleHeart: () => void;
  post: MemoryPost;
}) {
  const author = MEMORY_AUTHORS[post.authorId];
  const heartedByMe = post.reactions.heart?.includes(activeAuthorId) ?? false;

  return (
    <BlurView intensity={38} style={styles.card} tint="light">
      <View style={styles.cardHeader}>
        <View style={styles.authorAvatar}>
          <Text style={styles.authorAvatarText}>{author.initials}</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.authorName}>{author.name}</Text>
          <Text style={styles.timestamp}>
            {formatTimestamp(post.createdAt)}
          </Text>
        </View>
        <StatusPill status={post.status} />
      </View>

      {post.body ? <Text style={styles.postBody}>{post.body}</Text> : null}

      {post.media.length > 0 ? (
        <View style={styles.mediaGrid}>
          {post.media.map((media) => (
            <MediaTile key={media.id} media={media} />
          ))}
        </View>
      ) : null}

      <View style={styles.deliveryLine}>
        <Sparkles color={palette.gold} size={15} />
        <Text style={styles.deliveryText}>{DELIVERY_LABELS[post.status]}</Text>
        {post.status === "failed" ? (
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.cardActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onToggleHeart}
          style={styles.cardActionButton}
        >
          <Heart
            color={heartedByMe ? palette.berry : palette.inkMuted}
            fill={heartedByMe ? palette.berry : "transparent"}
            size={18}
          />
          <Text style={styles.cardActionText}>
            {post.reactions.heart?.length ?? 0}
          </Text>
        </Pressable>
        <View style={styles.cardActionButton}>
          <MessageCircle color={palette.inkMuted} size={18} />
          <Text style={styles.cardActionText}>{post.comments.length}</Text>
        </View>
      </View>

      {post.comments.length > 0 ? (
        <View style={styles.comments}>
          {post.comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>
                {MEMORY_AUTHORS[comment.authorId].initials}
              </Text>
              <Text style={styles.commentBody}>{comment.body}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.commentComposer}>
        <TextInput
          onChangeText={onCommentChange}
          onSubmitEditing={onSubmitComment}
          placeholder="Comment between us..."
          placeholderTextColor={palette.inkFaint}
          returnKeyType="send"
          style={styles.commentInput}
          value={commentDraft}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!commentDraft.trim()}
          onPress={onSubmitComment}
          style={[
            styles.commentSend,
            !commentDraft.trim() ? styles.disabledButton : null,
          ]}
        >
          <Send color="#fff" size={14} />
        </Pressable>
      </View>
    </BlurView>
  );
}

function StatusPill({ status }: { status: MemoryPost["status"] }) {
  const isDelivered = status === "delivered";
  const isFailed = status === "failed";

  return (
    <View
      style={[
        styles.statusPill,
        isDelivered ? styles.statusDelivered : null,
        isFailed ? styles.statusFailed : null,
      ]}
    >
      <Text
        style={[
          styles.statusText,
          isDelivered || isFailed ? styles.statusTextStrong : null,
        ]}
      >
        {status}
      </Text>
    </View>
  );
}

function MediaTile({ media }: { media: MemoryMedia }) {
  if (media.kind === "image") {
    return (
      <Image
        source={{ uri: media.uri }}
        style={styles.mediaImage as ImageStyle}
      />
    );
  }

  return (
    <View
      style={[styles.mediaFallback, { borderColor: mediaTint[media.kind] }]}
    >
      {media.kind === "video" ? (
        <Film color={mediaTint.video} size={28} />
      ) : (
        <Mic color={mediaTint.audio} size={28} />
      )}
      <Text style={styles.mediaFallbackTitle}>
        {media.kind === "video" ? "Video memory" : "Voice note"}
      </Text>
      {media.durationMs ? (
        <Text style={styles.mediaFallbackMeta}>
          {Math.max(1, Math.round(media.durationMs / 1000))}s
        </Text>
      ) : null}
    </View>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  scrollContent: {
    gap: 18,
    padding: 18,
    paddingBottom: 42,
  },
  header: {
    gap: 16,
    paddingTop: 8,
  },
  kicker: {
    color: palette.berry,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: palette.ink,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 38,
    maxWidth: 330,
  },
  headerControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  networkPill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.64)",
    borderColor: "rgba(255,255,255,0.9)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  networkPillOffline: {
    backgroundColor: "rgba(255,232,224,0.8)",
  },
  networkText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  authorSwitch: {
    backgroundColor: "rgba(255,255,255,0.54)",
    borderRadius: 999,
    flexDirection: "row",
    padding: 4,
  },
  authorButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  authorButtonActive: {
    backgroundColor: palette.ink,
  },
  authorButtonText: {
    color: palette.inkMuted,
    fontWeight: "800",
  },
  authorButtonTextActive: {
    color: "#fff",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statPill: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    overflow: "hidden",
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  statValue: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  statLabel: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  composer: {
    borderColor: "rgba(255,255,255,0.78)",
    borderRadius: radius.large,
    borderWidth: 1,
    gap: 14,
    overflow: "hidden",
    padding: 14,
    ...shadow.soft,
  },
  input: {
    color: palette.ink,
    fontSize: 19,
    fontWeight: "600",
    lineHeight: 25,
    maxHeight: 150,
    minHeight: 82,
    padding: 4,
  },
  attachments: {
    gap: 10,
    paddingRight: 6,
  },
  attachmentChip: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderColor: "rgba(255,255,255,0.92)",
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 7,
    width: 142,
  },
  attachmentImage: {
    backgroundColor: palette.surface,
    borderRadius: 10,
    height: 38,
    width: 38,
  },
  attachmentIcon: {
    alignItems: "center",
    borderRadius: 10,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  attachmentName: {
    color: palette.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  composerActions: {
    alignItems: "flex-end",
    gap: 12,
  },
  mediaActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    width: "100%",
  },
  toolButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderColor: "rgba(255,255,255,0.95)",
    borderRadius: radius.small,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 11,
  },
  toolButtonActive: {
    backgroundColor: palette.berry,
    borderColor: palette.berry,
  },
  toolText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  toolTextActive: {
    color: "#fff",
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: radius.small,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  sendText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.46,
  },
  timelineHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  timelineTitle: {
    color: palette.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  iconAction: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  emptyText: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    paddingVertical: 20,
  },
  card: {
    borderColor: "rgba(255,255,255,0.78)",
    borderRadius: radius.large,
    borderWidth: 1,
    gap: 14,
    overflow: "hidden",
    padding: 14,
    ...shadow.soft,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  authorAvatar: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  authorAvatarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },
  cardHeaderText: {
    flex: 1,
  },
  authorName: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "900",
  },
  timestamp: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  statusPill: {
    backgroundColor: "rgba(37,45,43,0.08)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDelivered: {
    backgroundColor: "rgba(91,126,102,0.16)",
  },
  statusFailed: {
    backgroundColor: "rgba(176,76,64,0.16)",
  },
  statusText: {
    color: palette.inkMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statusTextStrong: {
    color: palette.ink,
  },
  postBody: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 25,
  },
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  mediaImage: {
    aspectRatio: 1,
    backgroundColor: palette.surface,
    borderRadius: radius.medium,
    width: "48.7%",
  },
  mediaFallback: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "rgba(255,255,255,0.48)",
    borderRadius: radius.medium,
    borderWidth: 1,
    gap: 8,
    justifyContent: "center",
    width: "48.7%",
  },
  mediaFallbackTitle: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  mediaFallbackMeta: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  deliveryLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  deliveryText: {
    color: palette.inkMuted,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  retryText: {
    color: palette.berry,
    fontSize: 13,
    fontWeight: "900",
  },
  cardActions: {
    flexDirection: "row",
    gap: 10,
  },
  cardActionButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
  },
  cardActionText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  comments: {
    gap: 8,
  },
  comment: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  commentAuthor: {
    backgroundColor: "rgba(37,45,43,0.08)",
    borderRadius: 999,
    color: palette.ink,
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  commentBody: {
    color: palette.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    paddingTop: 4,
  },
  commentComposer: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.58)",
    borderColor: "rgba(255,255,255,0.86)",
    borderRadius: radius.small,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 6,
  },
  commentInput: {
    color: palette.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    minHeight: 36,
    paddingHorizontal: 6,
  },
  commentSend: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: 10,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
});
