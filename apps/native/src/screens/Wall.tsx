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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
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
  House,
  ImageIcon,
  LogOut,
  Mail,
  MessageCircle,
  Mic,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react-native";

import {
  DELIVERY_LABELS,
  pendingInviteFor,
  type FamilyMember,
  type MemoryMedia,
  type MemoryMediaKind,
  type MemoryPost,
} from "@may/core";

import { useMemoryWall } from "../hooks/useMemoryWall";
import { persistPickedAsset } from "../services/localMedia";
import { useAppState } from "../state/AppState";
import { GlassCard, ScreenBackground } from "../ui/Glass";
import { palette, radius, shadow } from "../theme";

type DraftAttachment = MemoryMedia;
type ResolveAuthor = (id: string) => { displayName: string; initials: string };
type WallTab = "home" | "settings";

const mediaTint: Record<MemoryMediaKind, string> = {
  image: palette.moss,
  video: palette.berry,
  audio: palette.ink,
};

export function Wall() {
  const router = useRouter();
  const { family, activeMemberId, setActiveMemberId, signOut } = useAppState();

  // `Wall` only renders once the app state is ready (see app/index.tsx).
  const fam = family!;
  const memberId = activeMemberId!;

  const {
    addComment,
    clearLocalData,
    forcedOffline,
    hydrated,
    isOnline,
    posts,
    retryPost,
    seedSampleMemories,
    sendMemory,
    toggleForcedOffline,
    toggleReaction,
  } = useMemoryWall(fam.id, memberId);

  const resolveAuthor = useCallback<ResolveAuthor>(
    (id) =>
      fam.members.find((member) => member.id === id) ?? {
        displayName: "Someone",
        initials: "?",
      },
    [fam.members],
  );

  const partner = useMemo(
    () => fam.members.find((member) => member.id !== memberId),
    [fam.members, memberId],
  );
  const pendingInvite = pendingInviteFor(fam);
  const isSolo = fam.members.length < 2;

  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [isPicking, setIsPicking] = useState(false);
  const [activeTab, setActiveTab] = useState<WallTab>("home");
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
    sendMemory({ body, media: attachments });
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

  const confirmClearLocalData = useCallback(() => {
    Alert.alert(
      "Clear local memories?",
      "This only clears the timeline on this device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: clearLocalData },
      ],
    );
  }, [clearLocalData]);

  const confirmSignOut = useCallback(() => {
    Alert.alert(
      "Sign out?",
      "You can sign back in with Google to restore this family wall.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            signOut()
              .then(() => router.replace("/login"))
              .catch((error) =>
                Alert.alert("Could not sign out", getErrorMessage(error)),
              );
          },
        },
      ],
    );
  }, [router, signOut]);

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          {activeTab === "home" ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Header
                activeMemberId={memberId}
                childName={fam.childName}
                deliveredCount={deliveryCounts.delivered}
                forcedOffline={forcedOffline}
                isOnline={isOnline}
                members={fam.members}
                pendingCount={deliveryCounts.queued}
                setActiveMemberId={setActiveMemberId}
                toggleForcedOffline={toggleForcedOffline}
              />

              <Composer
                attachments={attachments}
                body={body}
                childName={fam.childName}
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
                {posts.length > 0 ? (
                  <Text style={styles.timelineMeta}>{posts.length} saved</Text>
                ) : null}
              </View>

              {!hydrated ? (
                <Text style={styles.helperText}>Loading your memories…</Text>
              ) : posts.length === 0 ? (
                <EmptyWall
                  isSolo={isSolo}
                  onInvite={() => router.push("/invite")}
                  onSeedSamples={() => seedSampleMemories(partner?.id)}
                  partnerLabel={partner?.displayName ?? pendingInvite?.label}
                />
              ) : (
                <>
                  {isSolo ? (
                    <InviteNudge
                      label={pendingInvite?.label}
                      onPress={() => router.push("/invite")}
                    />
                  ) : null}
                  {posts.map((post) => (
                    <MemoryCard
                      activeMemberId={memberId}
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
                      resolveAuthor={resolveAuthor}
                    />
                  ))}
                </>
              )}
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <SettingsPanel
                activeMemberId={memberId}
                childName={fam.childName}
                forcedOffline={forcedOffline}
                isOnline={isOnline}
                isSolo={isSolo}
                members={fam.members}
                onClearLocalData={confirmClearLocalData}
                onInvite={() => router.push("/invite")}
                onSignOut={confirmSignOut}
                pendingInviteLabel={pendingInvite?.label}
                setActiveMemberId={setActiveMemberId}
                toggleForcedOffline={toggleForcedOffline}
              />
            </ScrollView>
          )}

          <BottomGlassTabs activeTab={activeTab} onChange={setActiveTab} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenBackground>
  );
}

function Header({
  activeMemberId,
  childName,
  deliveredCount,
  forcedOffline,
  isOnline,
  members,
  pendingCount,
  setActiveMemberId,
  toggleForcedOffline,
}: {
  activeMemberId: string;
  childName: string;
  deliveredCount: number;
  forcedOffline: boolean;
  isOnline: boolean;
  members: FamilyMember[];
  pendingCount: number;
  setActiveMemberId: (memberId: string) => void;
  toggleForcedOffline: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.flexShrink}>
          <Text style={styles.kicker}>May</Text>
          <Text style={styles.title}>For {childName}, from our day.</Text>
        </View>
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
          {members.map((member) => (
            <Pressable
              accessibilityLabel={`Post as ${member.displayName}`}
              accessibilityRole="button"
              key={member.id}
              onPress={() => setActiveMemberId(member.id)}
              style={[
                styles.authorButton,
                activeMemberId === member.id ? styles.authorButtonActive : null,
              ]}
            >
              <Text
                style={[
                  styles.authorButtonText,
                  activeMemberId === member.id
                    ? styles.authorButtonTextActive
                    : null,
                ]}
              >
                {member.initials}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatPill
          icon={<Mail color={palette.ink} size={16} />}
          label="sent"
          value={deliveredCount}
        />
        <StatPill
          icon={<RefreshCw color={palette.ink} size={16} />}
          label="syncing"
          value={pendingCount}
        />
      </View>
    </View>
  );
}

function SettingsPanel({
  activeMemberId,
  childName,
  forcedOffline,
  isOnline,
  isSolo,
  members,
  onClearLocalData,
  onInvite,
  onSignOut,
  pendingInviteLabel,
  setActiveMemberId,
  toggleForcedOffline,
}: {
  activeMemberId: string;
  childName: string;
  forcedOffline: boolean;
  isOnline: boolean;
  isSolo: boolean;
  members: FamilyMember[];
  onClearLocalData: () => void;
  onInvite: () => void;
  onSignOut: () => void;
  pendingInviteLabel?: string;
  setActiveMemberId: (memberId: string) => void;
  toggleForcedOffline: () => void;
}) {
  return (
    <>
      <View style={styles.settingsHero}>
        <View style={styles.settingsBadge}>
          <Settings color="#fff" size={22} />
        </View>
        <Text style={styles.settingsTitle}>Settings</Text>
        <Text style={styles.settingsSubtitle}>For {childName}&apos;s wall</Text>
      </View>

      <GlassCard intensity={42} style={styles.settingsCard}>
        <View style={styles.settingsSectionHeader}>
          <Users color={palette.moss} size={19} />
          <Text style={styles.settingsSectionTitle}>Family</Text>
        </View>
        <View style={styles.memberList}>
          {members.map((member) => {
            const selected = activeMemberId === member.id;
            return (
              <Pressable
                accessibilityLabel={`Post as ${member.displayName}`}
                accessibilityRole="button"
                key={member.id}
                onPress={() => setActiveMemberId(member.id)}
                style={[
                  styles.memberRow,
                  selected ? styles.memberRowActive : null,
                ]}
              >
                <View
                  style={[
                    styles.memberAvatar,
                    selected ? styles.memberAvatarActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.memberAvatarText,
                      selected ? styles.memberAvatarTextActive : null,
                    ]}
                  >
                    {member.initials}
                  </Text>
                </View>
                <View style={styles.memberText}>
                  <Text style={styles.memberName}>{member.displayName}</Text>
                  <Text style={styles.memberRole}>{member.role}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </GlassCard>

      <GlassCard intensity={42} style={styles.settingsCard}>
        <SettingsRow
          icon={
            isOnline ? (
              <Wifi color={palette.moss} size={20} />
            ) : (
              <WifiOff color={palette.berry} size={20} />
            )
          }
          label={forcedOffline || !isOnline ? "Offline mode" : "Online"}
          onPress={toggleForcedOffline}
          value={forcedOffline ? "Forced" : "Auto"}
        />
        {isSolo ? (
          <SettingsRow
            icon={<UserPlus color={palette.berry} size={20} />}
            label={`Invite ${pendingInviteLabel ?? "the other parent"}`}
            onPress={onInvite}
            value="Family"
          />
        ) : null}
      </GlassCard>

      <GlassCard intensity={42} style={styles.settingsCard}>
        <SettingsRow
          destructive
          icon={<Trash2 color={palette.berry} size={20} />}
          label="Clear local memories"
          onPress={onClearLocalData}
          value="Device"
        />
        <SettingsRow
          destructive
          icon={<LogOut color={palette.berry} size={20} />}
          label="Sign out"
          onPress={onSignOut}
          value="Google"
        />
      </GlassCard>
    </>
  );
}

function SettingsRow({
  destructive,
  icon,
  label,
  onPress,
  value,
}: {
  destructive?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  value: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        pressed ? styles.settingsRowPressed : null,
      ]}
    >
      <View style={styles.settingsRowIcon}>{icon}</View>
      <Text
        style={[
          styles.settingsRowLabel,
          destructive ? styles.settingsRowLabelDestructive : null,
        ]}
      >
        {label}
      </Text>
      <Text style={styles.settingsRowValue}>{value}</Text>
    </Pressable>
  );
}

function BottomGlassTabs({
  activeTab,
  onChange,
}: {
  activeTab: WallTab;
  onChange: (tab: WallTab) => void;
}) {
  const tabs: Array<{
    icon: typeof House;
    label: string;
    value: WallTab;
  }> = [
    { icon: House, label: "Home", value: "home" },
    { icon: Settings, label: "Settings", value: "settings" },
  ];

  return (
    <View pointerEvents="box-none" style={styles.tabDock}>
      <GlassCard intensity={64} lifted highlight={false} style={styles.tabBar}>
        {tabs.map(({ icon: Icon, label, value }) => {
          const active = activeTab === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={value}
              onPress={() => onChange(value)}
              style={({ pressed }) => [
                styles.tabButton,
                active ? styles.tabButtonActive : null,
                pressed ? styles.tabButtonPressed : null,
              ]}
            >
              <Icon color={active ? "#fff" : palette.inkMuted} size={21} />
              <Text
                style={[styles.tabLabel, active ? styles.tabLabelActive : null]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </GlassCard>
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
    <GlassCard intensity={28} style={styles.statPill}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </GlassCard>
  );
}

function InviteNudge({
  label,
  onPress,
}: {
  label?: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <GlassCard intensity={30} style={styles.nudge}>
        <View style={styles.nudgeIcon}>
          <UserPlus color={palette.berry} size={18} />
        </View>
        <Text style={styles.nudgeText}>
          Invite {label ?? "the other parent"} to share this wall
        </Text>
      </GlassCard>
    </Pressable>
  );
}

function EmptyWall({
  isSolo,
  onInvite,
  onSeedSamples,
  partnerLabel,
}: {
  isSolo: boolean;
  onInvite: () => void;
  onSeedSamples: () => void;
  partnerLabel?: string;
}) {
  return (
    <GlassCard intensity={40} lifted style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Sparkles color={palette.gold} size={24} />
      </View>
      <Text style={styles.emptyTitle}>Your wall is ready</Text>
      <Text style={styles.emptyBody}>
        Write your first note above — add a photo, a video, or a voice note. It
        waits here, calm and safe, until it&apos;s delivered.
      </Text>
      <View style={styles.emptyActions}>
        {isSolo ? (
          <Pressable
            accessibilityRole="button"
            onPress={onInvite}
            style={styles.emptyPrimary}
          >
            <UserPlus color="#fff" size={17} />
            <Text style={styles.emptyPrimaryText}>
              Invite {partnerLabel ?? "the other parent"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onSeedSamples}
          style={styles.emptySecondary}
        >
          <Text style={styles.emptySecondaryText}>
            Preview with sample memories
          </Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

function Composer({
  attachments,
  body,
  childName,
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
  childName: string;
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
    <GlassCard intensity={50} lifted style={styles.composer}>
      <TextInput
        multiline
        onChangeText={onBodyChange}
        placeholder={`Write to ${childName}…`}
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
    </GlassCard>
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
  activeMemberId,
  commentDraft,
  onCommentChange,
  onRetry,
  onSubmitComment,
  onToggleHeart,
  post,
  resolveAuthor,
}: {
  activeMemberId: string;
  commentDraft: string;
  onCommentChange: (value: string) => void;
  onRetry: () => void;
  onSubmitComment: () => void;
  onToggleHeart: () => void;
  post: MemoryPost;
  resolveAuthor: ResolveAuthor;
}) {
  const author = resolveAuthor(post.authorId);
  const heartedByMe = post.reactions.heart?.includes(activeMemberId) ?? false;

  return (
    <GlassCard intensity={38} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.authorAvatar}>
          <Text style={styles.authorAvatarText}>{author.initials}</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.authorName}>{author.displayName}</Text>
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
                {resolveAuthor(comment.authorId).initials}
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
          placeholder="Comment between us…"
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
    </GlassCard>
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
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    gap: 18,
    padding: 18,
    paddingBottom: 132,
  },
  header: {
    gap: 16,
    paddingTop: 8,
  },
  headerTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  kicker: {
    color: palette.berry,
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 37,
    maxWidth: 320,
  },
  headerControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  networkPill: {
    alignItems: "center",
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  networkPillOffline: {
    backgroundColor: "rgba(255,232,224,0.82)",
  },
  networkText: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  authorSwitch: {
    backgroundColor: palette.glassFaint,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 2,
    padding: 4,
  },
  authorButton: {
    alignItems: "center",
    borderRadius: radius.pill,
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
    borderRadius: radius.medium,
    flexDirection: "row",
    gap: 7,
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
  settingsHero: {
    gap: 10,
    paddingTop: 8,
  },
  settingsBadge: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: radius.pill,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  settingsTitle: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 37,
  },
  settingsSubtitle: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  settingsCard: {
    gap: 8,
    padding: 12,
  },
  settingsSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  settingsSectionTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  memberList: {
    gap: 8,
  },
  memberRow: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 58,
    paddingHorizontal: 10,
  },
  memberRowActive: {
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
  },
  memberAvatar: {
    alignItems: "center",
    backgroundColor: "rgba(37,45,43,0.08)",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  memberAvatarActive: {
    backgroundColor: palette.ink,
  },
  memberAvatarText: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  memberAvatarTextActive: {
    color: "#fff",
  },
  memberText: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  memberRole: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  settingsRow: {
    alignItems: "center",
    borderRadius: radius.medium,
    flexDirection: "row",
    gap: 11,
    minHeight: 56,
    paddingHorizontal: 10,
  },
  settingsRowPressed: {
    backgroundColor: palette.glassFaint,
  },
  settingsRowIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  settingsRowLabel: {
    color: palette.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  settingsRowLabelDestructive: {
    color: palette.berry,
  },
  settingsRowValue: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  tabDock: {
    alignItems: "center",
    bottom: 10,
    left: 0,
    position: "absolute",
    right: 0,
  },
  tabBar: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    minHeight: 72,
    padding: 6,
    width: 252,
  },
  tabButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 60,
  },
  tabButtonActive: {
    backgroundColor: palette.ink,
  },
  tabButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  tabLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  tabLabelActive: {
    color: "#fff",
  },
  nudge: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  nudgeIcon: {
    alignItems: "center",
    backgroundColor: "rgba(176,76,64,0.12)",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  nudgeText: {
    color: palette.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  empty: {
    alignItems: "center",
    gap: 14,
    padding: 26,
  },
  emptyBadge: {
    alignItems: "center",
    backgroundColor: "rgba(183,133,45,0.14)",
    borderRadius: radius.pill,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 22,
    fontWeight: "900",
  },
  emptyBody: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    textAlign: "center",
  },
  emptyActions: {
    alignSelf: "stretch",
    gap: 10,
    marginTop: 4,
  },
  emptyPrimary: {
    alignItems: "center",
    backgroundColor: palette.berry,
    borderRadius: radius.medium,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 50,
    ...shadow.soft,
  },
  emptyPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
  emptySecondary: {
    alignItems: "center",
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
    borderRadius: radius.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  emptySecondaryText: {
    color: palette.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  composer: {
    gap: 14,
    padding: 16,
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
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
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
    backgroundColor: palette.glassStrong,
    borderColor: palette.rim,
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
  timelineMeta: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  helperText: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 20,
  },
  card: {
    gap: 14,
    padding: 16,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  authorAvatar: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: radius.pill,
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
    borderRadius: radius.pill,
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
    backgroundColor: palette.glass,
    borderRadius: radius.pill,
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
    borderRadius: radius.pill,
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
    backgroundColor: palette.glass,
    borderColor: palette.rimSoft,
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
