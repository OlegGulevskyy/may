import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
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
import {
  Film,
  Heart,
  House,
  MessageCircle,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from "lucide-react-native";

import {
  type MemoryMedia,
  type MemoryMediaKind,
  type MemoryPost,
} from "@may/core";

import type { MemoryDraft } from "../hooks/useDrafts";
import { useAppState } from "../state/AppState";
import { useMemoryWallContext } from "../state/MemoryWallProvider";
import { GlassCard, ScreenBackground, Surface } from "../ui/Glass";
import { StatusGlyph, StatusLegend } from "../ui/MemoryStatus";
import { getLocalString, setLocalString } from "../services/storage";
import { SettingsPanel } from "./Settings";
import { tapFeedback } from "../ui/haptics";
import { palette, radius, shadow } from "../theme";

type ResolveAuthor = (id: string) => { displayName: string; initials: string };
type WallTab = "home" | "settings";

const mediaTint: Record<MemoryMediaKind, string> = {
  image: palette.moss,
  video: palette.berry,
  audio: palette.ink,
};

const inviteNudgeDismissedKey = (familyId: string) =>
  `may.invite-nudge-dismissed.${familyId}.v1`;

export function Wall() {
  const router = useRouter();
  const { family, activeMemberId, setActiveMemberId, signOut } = useAppState();

  // `Wall` only renders once the app state is ready (see app/index.tsx).
  const fam = family!;
  const memberId = activeMemberId!;

  const {
    addComment,
    clearLocalData,
    drafts,
    forcedOffline,
    hydrated,
    isOnline,
    posts,
    retryPost,
    seedSampleMemories,
    toggleForcedOffline,
    toggleReaction,
  } = useMemoryWallContext();

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
  const isSolo = fam.members.length < 2;
  const inviteNudgeStorageKey = inviteNudgeDismissedKey(fam.id);

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [activeTab, setActiveTab] = useState<WallTab>("home");
  const [legendVisible, setLegendVisible] = useState(false);
  const [inviteNudgeDismissed, setInviteNudgeDismissed] = useState(
    () => getLocalString(inviteNudgeStorageKey) === "true",
  );

  useEffect(() => {
    setInviteNudgeDismissed(getLocalString(inviteNudgeStorageKey) === "true");
  }, [inviteNudgeStorageKey]);

  const openCompose = useCallback(
    (draftId?: string) => {
      router.push(
        draftId ? { pathname: "/compose", params: { draftId } } : "/compose",
      );
    },
    [router],
  );

  const confirmDeleteDraft = useCallback(
    (draftId: string) => {
      Alert.alert("Discard this draft?", "It hasn't been sent yet.", [
        { text: "Keep", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => drafts.remove(draftId),
        },
      ]);
    },
    [drafts],
  );

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

  const dismissInviteNudge = useCallback(() => {
    tapFeedback();
    setInviteNudgeDismissed(true);
    setLocalString(inviteNudgeStorageKey, "true");
  }, [inviteNudgeStorageKey]);

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        {activeTab === "home" ? (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.pageHeader}>
              <Text style={styles.pageTitle}>{fam.childName}&apos;s wall</Text>
              {posts.length > 0 ? (
                <Text style={styles.pageMeta}>{posts.length} saved</Text>
              ) : null}
            </View>

            {drafts.items.length > 0 ? (
              <DraftsSection
                drafts={drafts.items}
                onDelete={confirmDeleteDraft}
                onResume={openCompose}
              />
            ) : null}

            {!hydrated ? (
              <Text style={styles.helperText}>Loading your memories…</Text>
            ) : posts.length === 0 ? (
              <EmptyWall
                isSolo={isSolo}
                onInvite={() => router.push("/invite")}
                onSeedSamples={() => seedSampleMemories(partner?.id)}
              />
            ) : (
              <>
                {isSolo && !inviteNudgeDismissed ? (
                  <InviteNudge
                    onDismiss={dismissInviteNudge}
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
                    onShowStatusInfo={() => setLegendVisible(true)}
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
              setActiveMemberId={setActiveMemberId}
              toggleForcedOffline={toggleForcedOffline}
            />
          </ScrollView>
        )}

        <BottomTabs
          activeTab={activeTab}
          onChange={setActiveTab}
          onNew={() => openCompose()}
        />
      </SafeAreaView>

      <StatusLegend
        onClose={() => setLegendVisible(false)}
        visible={legendVisible}
      />
    </ScreenBackground>
  );
}

function BottomTabs({
  activeTab,
  onChange,
  onNew,
}: {
  activeTab: WallTab;
  onChange: (tab: WallTab) => void;
  onNew: () => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.tabDock}>
      <GlassCard intensity={64} lifted highlight={false} style={styles.tabBar}>
        <TabButton
          active={activeTab === "home"}
          icon={House}
          label="Home"
          onPress={() => onChange("home")}
        />

        <Pressable
          accessibilityLabel="New memory"
          accessibilityRole="button"
          onPress={() => {
            tapFeedback();
            onNew();
          }}
          style={({ pressed }) => [
            styles.newButton,
            pressed ? styles.newButtonPressed : null,
          ]}
        >
          <Plus color="#fff" size={26} />
        </Pressable>

        <TabButton
          active={activeTab === "settings"}
          icon={Settings}
          label="Settings"
          onPress={() => onChange("settings")}
        />
      </GlassCard>
    </View>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: typeof House;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        styles.tabButton,
        active ? styles.tabButtonActive : null,
        pressed ? styles.tabButtonPressed : null,
      ]}
    >
      <Icon color={active ? palette.ink : palette.inkFaint} size={23} />
    </Pressable>
  );
}

function DraftsSection({
  drafts,
  onDelete,
  onResume,
}: {
  drafts: MemoryDraft[];
  onDelete: (draftId: string) => void;
  onResume: (draftId: string) => void;
}) {
  return (
    <View style={styles.draftsSection}>
      <Text style={styles.sectionLabel}>Drafts</Text>
      {drafts.map((draft) => (
        <DraftRow
          draft={draft}
          key={draft.id}
          onDelete={() => onDelete(draft.id)}
          onResume={() => onResume(draft.id)}
        />
      ))}
    </View>
  );
}

function DraftRow({
  draft,
  onDelete,
  onResume,
}: {
  draft: MemoryDraft;
  onDelete: () => void;
  onResume: () => void;
}) {
  const snippet =
    draft.body.trim() ||
    (draft.media.length > 0 ? "Attachments only" : "Empty note");
  const attachmentNote =
    draft.media.length > 0
      ? ` · ${draft.media.length} attachment${draft.media.length > 1 ? "s" : ""}`
      : "";

  return (
    <Surface style={styles.draftRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Resume draft"
        onPress={onResume}
        style={({ pressed }) => [
          styles.draftMain,
          pressed ? styles.draftMainPressed : null,
        ]}
      >
        <View style={styles.draftIcon}>
          <Pencil color={palette.gold} size={17} />
        </View>
        <View style={styles.draftText}>
          <Text numberOfLines={2} style={styles.draftSnippet}>
            {snippet}
          </Text>
          <Text style={styles.draftMeta}>
            Draft · {formatTimestamp(draft.updatedAt)}
            {attachmentNote}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel="Discard draft"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDelete}
        style={styles.draftDelete}
      >
        <Trash2 color={palette.inkMuted} size={17} />
      </Pressable>
    </Surface>
  );
}

function InviteNudge({
  onDismiss,
  onPress,
}: {
  onDismiss: () => void;
  onPress: () => void;
}) {
  return (
    <GlassCard intensity={30} style={styles.nudge}>
      <Pressable
        accessibilityLabel="Invite someone close to share this wall"
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.nudgeAction,
          pressed ? styles.nudgePressed : null,
        ]}
      >
        <View style={styles.nudgeIcon}>
          <UserPlus color={palette.berry} size={18} />
        </View>
        <Text style={styles.nudgeText}>
          Invite someone close to share this wall
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Dismiss invite prompt"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.nudgeClose,
          pressed ? styles.nudgeClosePressed : null,
        ]}
      >
        <X color={palette.inkMuted} size={17} />
      </Pressable>
    </GlassCard>
  );
}

function EmptyWall({
  isSolo,
  onInvite,
  onSeedSamples,
}: {
  isSolo: boolean;
  onInvite: () => void;
  onSeedSamples: () => void;
}) {
  return (
    <GlassCard intensity={40} lifted style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Sparkles color={palette.gold} size={24} />
      </View>
      <Text style={styles.emptyTitle}>Your wall is ready</Text>
      <Text style={styles.emptyBody}>
        Tap the <Text style={styles.emptyBodyStrong}>+</Text> below to write
        your first note — add a photo, a video, or a voice note. It waits here,
        calm and safe, until it&apos;s delivered.
      </Text>
      <View style={styles.emptyActions}>
        {isSolo ? (
          <Pressable
            accessibilityRole="button"
            onPress={onInvite}
            style={styles.emptyPrimary}
          >
            <UserPlus color="#fff" size={17} />
            <Text style={styles.emptyPrimaryText}>Invite someone close</Text>
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

function MemoryCard({
  activeMemberId,
  commentDraft,
  onCommentChange,
  onRetry,
  onShowStatusInfo,
  onSubmitComment,
  onToggleHeart,
  post,
  resolveAuthor,
}: {
  activeMemberId: string;
  commentDraft: string;
  onCommentChange: (value: string) => void;
  onRetry: () => void;
  onShowStatusInfo: () => void;
  onSubmitComment: () => void;
  onToggleHeart: () => void;
  post: MemoryPost;
  resolveAuthor: ResolveAuthor;
}) {
  const author = resolveAuthor(post.authorId);
  const heartedByMe = post.reactions.heart?.includes(activeMemberId) ?? false;

  return (
    <Surface style={styles.card}>
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
        {post.status === "failed" ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={styles.retryButton}
          >
            <RotateCcw color={palette.berry} size={14} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
        <StatusGlyph onPress={onShowStatusInfo} status={post.status} />
      </View>

      {post.body ? <Text style={styles.postBody}>{post.body}</Text> : null}

      {post.media.length > 0 ? (
        <View style={styles.mediaGrid}>
          {post.media.map((media) => (
            <MediaTile key={media.id} media={media} />
          ))}
        </View>
      ) : null}

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
          placeholder="Add a private note…"
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
    </Surface>
  );
}

function MediaTile({ media }: { media: MemoryMedia }) {
  if (media.kind === "image") {
    return (
      <Image
        source={{ uri: media.thumbnailUri ?? media.uri }}
        style={styles.mediaImage as ImageStyle}
      />
    );
  }

  return (
    <View style={styles.mediaFallback}>
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
  safeArea: { flex: 1 },
  scrollContent: {
    gap: 16,
    padding: 18,
    paddingBottom: 132,
  },
  pageHeader: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    paddingTop: 4,
  },
  pageTitle: {
    color: palette.ink,
    flexShrink: 1,
    fontSize: 26,
    fontWeight: "900",
  },
  pageMeta: {
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
  sectionLabel: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  draftsSection: {
    gap: 8,
  },
  draftRow: {
    alignItems: "center",
    flexDirection: "row",
    paddingLeft: 12,
    paddingRight: 6,
  },
  draftMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
  },
  draftMainPressed: {
    opacity: 0.6,
  },
  draftIcon: {
    alignItems: "center",
    backgroundColor: "rgba(183,133,45,0.14)",
    borderRadius: radius.pill,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  draftText: {
    flex: 1,
    gap: 3,
  },
  draftSnippet: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  draftMeta: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  draftDelete: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
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
    gap: 10,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tabButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  tabButtonActive: {
    backgroundColor: palette.glassStrong,
  },
  tabButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  newButton: {
    alignItems: "center",
    backgroundColor: palette.berry,
    borderRadius: radius.pill,
    height: 56,
    justifyContent: "center",
    width: 56,
    ...shadow.soft,
  },
  newButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  nudge: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  nudgeAction: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 38,
  },
  nudgePressed: {
    opacity: 0.7,
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
  nudgeClose: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  nudgeClosePressed: {
    backgroundColor: "rgba(37,45,43,0.07)",
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
  emptyBodyStrong: {
    color: palette.berry,
    fontWeight: "900",
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
  disabledButton: {
    opacity: 0.46,
  },
  // Memory card content sits on a clean Surface (see ui/Glass) so the hierarchy
  // reads without competing gradients or heavy rims.
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
  retryButton: {
    alignItems: "center",
    backgroundColor: "rgba(176,76,64,0.12)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  retryText: {
    color: palette.berry,
    fontSize: 13,
    fontWeight: "900",
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
    backgroundColor: "rgba(37,45,43,0.04)",
    borderRadius: radius.medium,
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
  cardActions: {
    borderTopColor: "rgba(37,45,43,0.07)",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 18,
    paddingTop: 12,
  },
  cardActionButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
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
    backgroundColor: "rgba(37,45,43,0.04)",
    borderRadius: radius.small,
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
