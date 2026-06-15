import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type ViewToken,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
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
import { imageSource, useImageUriCache } from "../services/imageCache";
import { getLocalString, setLocalString } from "../services/storage";
import { SettingsPanel } from "./Settings";
import { tapFeedback } from "../ui/haptics";
import { palette, radius, shadow } from "../theme";

type ResolveAuthor = (id: string) => { displayName: string; initials: string };
type WallTab = "home" | "settings";
type WallListItem =
  | { id: "drafts"; type: "drafts" }
  | { id: "empty"; type: "empty" }
  | { id: "invite-nudge"; type: "invite-nudge" }
  | { id: string; post: MemoryPost; postIndex: number; type: "post" };

const mediaTint: Record<MemoryMediaKind, string> = {
  image: palette.moss,
  video: palette.berry,
  audio: palette.ink,
};

const inviteNudgeDismissedKey = (familyId: string) =>
  `may.invite-nudge-dismissed.${familyId}.v1`;

const mediaSlideGap = 10;
const minMediaPeekWidth = 24;
const maxMediaPeekWidth = 38;
const wallHorizontalPadding = 18;
const memoryCardPadding = 16;
const wallPrefetchTrailingItems = 4;
const wallViewabilityConfig = { itemVisiblePercentThreshold: 20 };

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
    hasMorePosts,
    hydrated,
    isOnline,
    isLoadingMorePosts,
    loadMorePosts,
    loadedRemotePostCount,
    posts,
    retryPost,
    seedSampleMemories,
    toggleForcedOffline,
    toggleReaction,
    totalRemotePostCount,
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
  const canLoadMorePostsRef = useRef(false);
  const loadMorePostsRef = useRef(loadMorePosts);
  const postsLengthRef = useRef(posts.length);
  const postCountLabel =
    totalRemotePostCount !== undefined
      ? `${loadedRemotePostCount} / ${totalRemotePostCount} loaded`
      : hasMorePosts
        ? `${loadedRemotePostCount}+ loaded`
        : `${posts.length} saved`;

  useEffect(() => {
    setInviteNudgeDismissed(getLocalString(inviteNudgeStorageKey) === "true");
  }, [inviteNudgeStorageKey]);

  useEffect(() => {
    canLoadMorePostsRef.current = hasMorePosts && !isLoadingMorePosts;
    loadMorePostsRef.current = loadMorePosts;
    postsLengthRef.current = posts.length;
  }, [hasMorePosts, isLoadingMorePosts, loadMorePosts, posts.length]);

  const wallItems = useMemo<WallListItem[]>(() => {
    if (!hydrated) {
      return [];
    }

    const items: WallListItem[] = [];

    if (drafts.items.length > 0) {
      items.push({ id: "drafts", type: "drafts" });
    }

    if (posts.length === 0) {
      items.push({ id: "empty", type: "empty" });
      return items;
    }

    if (isSolo && !inviteNudgeDismissed) {
      items.push({ id: "invite-nudge", type: "invite-nudge" });
    }

    posts.forEach((post, postIndex) => {
      items.push({ id: post.id, post, postIndex, type: "post" });
    });

    return items;
  }, [drafts.items.length, hydrated, inviteNudgeDismissed, isSolo, posts]);

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

  const requestMorePosts = useCallback(() => {
    if (!canLoadMorePostsRef.current) {
      return;
    }

    canLoadMorePostsRef.current = false;
    loadMorePostsRef.current();
  }, []);

  const handleViewablePostsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (!canLoadMorePostsRef.current) {
        return;
      }

      const visiblePostIndex = viewableItems.reduce((maxIndex, item) => {
        const wallItem = item.item as WallListItem | undefined;
        return wallItem?.type === "post"
          ? Math.max(maxIndex, wallItem.postIndex)
          : maxIndex;
      }, -1);
      const triggerIndex = Math.max(
        0,
        postsLengthRef.current - wallPrefetchTrailingItems - 1,
      );

      if (visiblePostIndex >= triggerIndex) {
        requestMorePosts();
      }
    },
  ).current;

  const renderWallItem = useCallback(
    ({ item }: { item: WallListItem }) => {
      switch (item.type) {
        case "drafts":
          return (
            <DraftsSection
              drafts={drafts.items}
              onDelete={confirmDeleteDraft}
              onResume={openCompose}
            />
          );
        case "empty":
          return (
            <EmptyWall
              isSolo={isSolo}
              onInvite={() => router.push("/invite")}
              onSeedSamples={() => seedSampleMemories(partner?.id)}
            />
          );
        case "invite-nudge":
          return (
            <InviteNudge
              onDismiss={dismissInviteNudge}
              onPress={() => router.push("/invite")}
            />
          );
        case "post":
          return (
            <MemoryCard
              activeMemberId={memberId}
              commentDraft={commentDrafts[item.post.id] ?? ""}
              onCommentChange={(value) =>
                setCommentDrafts((current) => ({
                  ...current,
                  [item.post.id]: value,
                }))
              }
              onRetry={() => retryPost(item.post.id)}
              onShowStatusInfo={() => setLegendVisible(true)}
              onSubmitComment={() => submitComment(item.post.id)}
              onToggleHeart={() => toggleReaction(item.post.id, "heart")}
              post={item.post}
              resolveAuthor={resolveAuthor}
            />
          );
      }
    },
    [
      commentDrafts,
      confirmDeleteDraft,
      dismissInviteNudge,
      drafts.items,
      isSolo,
      memberId,
      openCompose,
      partner?.id,
      resolveAuthor,
      retryPost,
      router,
      seedSampleMemories,
      submitComment,
      toggleReaction,
    ],
  );

  return (
    <ScreenBackground>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        {activeTab === "home" ? (
          <FlatList
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.scrollContent}
            data={wallItems}
            initialNumToRender={12}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              !hydrated ? (
                <Text style={styles.helperText}>Loading your memories…</Text>
              ) : null
            }
            ListFooterComponent={
              <WallLoadingFooter isLoading={isLoadingMorePosts} />
            }
            ListHeaderComponent={
              <WallStickyHeader
                childName={fam.childName}
                hasMorePosts={hasMorePosts}
                isLoadingMorePosts={isLoadingMorePosts}
                loadedRemotePostCount={loadedRemotePostCount}
                postCountLabel={postCountLabel}
                renderedPostCount={posts.length}
                showDiagnostics={posts.length > 0}
                totalRemotePostCount={totalRemotePostCount}
              />
            }
            maxToRenderPerBatch={10}
            onEndReached={requestMorePosts}
            onEndReachedThreshold={0.35}
            onViewableItemsChanged={handleViewablePostsChanged}
            renderItem={renderWallItem}
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[0]}
            viewabilityConfig={wallViewabilityConfig}
            windowSize={5}
          />
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
            styles.tabButton,
            pressed ? styles.tabButtonPressed : null,
          ]}
        >
          <Plus color={palette.inkFaint} size={23} />
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

function WallStickyHeader({
  childName,
  hasMorePosts,
  isLoadingMorePosts,
  loadedRemotePostCount,
  postCountLabel,
  renderedPostCount,
  showDiagnostics,
  totalRemotePostCount,
}: {
  childName: string;
  hasMorePosts: boolean;
  isLoadingMorePosts: boolean;
  loadedRemotePostCount: number;
  postCountLabel: string;
  renderedPostCount: number;
  showDiagnostics: boolean;
  totalRemotePostCount?: number;
}) {
  return (
    <View style={styles.stickyHeader}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>{childName}&apos;s wall</Text>
        <Text style={styles.pageMeta}>{postCountLabel}</Text>
      </View>

      {showDiagnostics ? (
        <WallDiagnostics
          hasMorePosts={hasMorePosts}
          isLoadingMorePosts={isLoadingMorePosts}
          loadedRemotePostCount={loadedRemotePostCount}
          renderedPostCount={renderedPostCount}
          totalRemotePostCount={totalRemotePostCount}
        />
      ) : null}
    </View>
  );
}

function WallLoadingFooter({ isLoading }: { isLoading: boolean }) {
  if (!isLoading) {
    return null;
  }

  return (
    <View style={styles.loadMoreFooter}>
      <ActivityIndicator color={palette.berry} />
    </View>
  );
}

function WallDiagnostics({
  hasMorePosts,
  isLoadingMorePosts,
  loadedRemotePostCount,
  renderedPostCount,
  totalRemotePostCount,
}: {
  hasMorePosts: boolean;
  isLoadingMorePosts: boolean;
  loadedRemotePostCount: number;
  renderedPostCount: number;
  totalRemotePostCount?: number;
}) {
  const totalText =
    totalRemotePostCount === undefined ? "?" : String(totalRemotePostCount);
  const pageState = isLoadingMorePosts
    ? "loading"
    : hasMorePosts
      ? "more"
      : "done";

  return (
    <View style={styles.wallDiagnostics}>
      <Text style={styles.wallDiagnosticsText}>
        Remote {loadedRemotePostCount}/{totalText} · Rendered{" "}
        {renderedPostCount} · {pageState}
      </Text>
    </View>
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

      {post.media.length > 0 ? <MediaCarousel media={post.media} /> : null}

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

function MediaCarousel({ media }: { media: MemoryMedia[] }) {
  // The carousel measures its own width once, then sizes every slide to it.
  // (`aspectRatio` does not resolve a height in this RN/Yoga build, so slide
  // dimensions are pinned explicitly.)
  const { width: windowWidth } = useWindowDimensions();
  const estimatedWidth = Math.max(
    1,
    Math.round(windowWidth - wallHorizontalPadding * 2 - memoryCardPadding * 2),
  );
  const [width, setWidth] = useState(estimatedWidth);
  const [index, setIndex] = useState(0);
  const shouldPeek = media.length > 1;
  const maxAvailablePeek = Math.max(0, Math.floor((width - 120) / 2));
  const peekWidth = shouldPeek
    ? Math.min(
        maxMediaPeekWidth,
        maxAvailablePeek,
        Math.max(minMediaPeekWidth, Math.round(width * 0.09)),
      )
    : 0;
  const slideWidth = shouldPeek ? width - peekWidth * 2 : width;
  const snapInterval = slideWidth + mediaSlideGap;
  const maxOffset = shouldPeek
    ? Math.max(0, (media.length - 1) * snapInterval - peekWidth * 2)
    : 0;
  const snapOffsets = useMemo(
    () =>
      shouldPeek
        ? media.map((_, itemIndex) => {
            if (itemIndex === 0) {
              return 0;
            }

            const centeredOffset = itemIndex * snapInterval - peekWidth;
            return Math.min(maxOffset, centeredOffset);
          })
        : undefined,
    [maxOffset, media, peekWidth, shouldPeek, snapInterval],
  );
  const imageMedia = useMemo(
    () => media.filter((item) => item.kind === "image"),
    [media],
  );
  const originalCacheRequests = useMemo(
    () =>
      imageMedia.map((item) => ({
        media: item,
        uri: item.uri,
        variant: "original" as const,
      })),
    [imageMedia],
  );
  const thumbnailCacheRequests = useMemo(
    () =>
      imageMedia.map((item) => ({
        media: item,
        uri: item.thumbnailUri ?? item.uri,
        variant: "thumbnail" as const,
      })),
    [imageMedia],
  );
  const cachedThumbnailUris = useImageUriCache(thumbnailCacheRequests);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const height = Math.round(slideWidth * 0.75);

  useImageUriCache(originalCacheRequests);

  const updateIndexFromOffset = useCallback(
    (offset: number) => {
      if (!shouldPeek || !snapOffsets) {
        const nextIndex = Math.round(offset / slideWidth);
        setIndex((current) =>
          current === nextIndex
            ? current
            : Math.max(0, Math.min(media.length - 1, nextIndex)),
        );
        return;
      }

      const nextIndex = snapOffsets.reduce(
        (closestIndex, snapOffset, itemIndex) =>
          Math.abs(snapOffset - offset) <
          Math.abs(snapOffsets[closestIndex] - offset)
            ? itemIndex
            : closestIndex,
        0,
      );

      setIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [media.length, shouldPeek, slideWidth, snapOffsets],
  );

  const openPreview = useCallback(
    (item: MemoryMedia) => {
      const nextIndex = imageMedia.findIndex((image) => image.id === item.id);
      if (nextIndex >= 0) {
        setPreviewIndex(nextIndex);
      }
    },
    [imageMedia],
  );

  const closePreview = useCallback(() => setPreviewIndex(null), []);

  return (
    <View
      onLayout={({ nativeEvent }) => {
        const measuredWidth = Math.round(nativeEvent.layout.width);

        setWidth((current) =>
          measuredWidth > 0 && Math.abs(current - measuredWidth) > 1
            ? measuredWidth
            : current,
        );
      }}
      style={[styles.media, { minHeight: height }]}
    >
      {width > 0 ? (
        <>
          <ScrollView
            contentContainerStyle={shouldPeek ? styles.mediaTrack : undefined}
            decelerationRate="fast"
            disableIntervalMomentum={shouldPeek}
            horizontal
            onMomentumScrollEnd={({ nativeEvent }) =>
              updateIndexFromOffset(nativeEvent.contentOffset.x)
            }
            onScroll={({ nativeEvent }) =>
              updateIndexFromOffset(nativeEvent.contentOffset.x)
            }
            pagingEnabled={!shouldPeek}
            scrollEventThrottle={16}
            showsHorizontalScrollIndicator={false}
            snapToOffsets={snapOffsets}
          >
            {media.map((item) => (
              <MediaSlide
                cachedUri={
                  item.kind === "image"
                    ? cachedThumbnailUris[item.thumbnailUri ?? item.uri]
                    : undefined
                }
                height={height}
                key={item.id}
                media={item}
                onOpenPreview={openPreview}
                width={slideWidth}
              />
            ))}
          </ScrollView>
          {media.length > 1 ? (
            <View style={styles.mediaDots}>
              {media.map((item, dotIndex) => (
                <View
                  key={item.id}
                  style={[
                    styles.mediaDot,
                    dotIndex === index ? styles.mediaDotActive : null,
                  ]}
                />
              ))}
            </View>
          ) : null}
          <MediaPreviewer
            images={imageMedia}
            initialIndex={previewIndex ?? 0}
            onClose={closePreview}
            visible={previewIndex !== null}
          />
        </>
      ) : null}
    </View>
  );
}

function MediaSlide({
  cachedUri,
  height,
  media,
  onOpenPreview,
  width,
}: {
  cachedUri?: string;
  height: number;
  media: MemoryMedia;
  onOpenPreview?: (media: MemoryMedia) => void;
  width: number;
}) {
  if (media.kind === "image") {
    const uri = cachedUri ?? media.thumbnailUri ?? media.uri;
    return (
      <Pressable
        accessibilityLabel="Open image"
        accessibilityRole="button"
        onPress={() => onOpenPreview?.(media)}
        style={[styles.mediaSlide, { height, width }]}
      >
        <Image
          onError={({ nativeEvent }) =>
            console.warn("[MaySync] media image load failed", {
              error: nativeEvent?.error,
              mediaId: media.id,
              uri,
            })
          }
          resizeMode="cover"
          source={imageSource(uri)}
          style={StyleSheet.absoluteFill as ImageStyle}
        />
      </Pressable>
    );
  }

  return (
    <View style={[styles.mediaSlide, styles.mediaFallback, { height, width }]}>
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

function MediaPreviewer({
  images,
  initialIndex,
  onClose,
  visible,
}: {
  images: MemoryMedia[];
  initialIndex: number;
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(initialIndex);
  const topInset = Math.max(insets.top, 44);
  const imageHeight = Math.max(240, height - topInset - 220);
  const originalCacheRequests = useMemo(
    () =>
      images.map((image) => ({
        media: image,
        uri: image.uri,
        variant: "original" as const,
      })),
    [images],
  );
  const thumbnailCacheRequests = useMemo(
    () =>
      images.map((image) => ({
        media: image,
        uri: image.thumbnailUri ?? image.uri,
        variant: "thumbnail" as const,
      })),
    [images],
  );
  const cachedOriginalUris = useImageUriCache(originalCacheRequests);
  const cachedThumbnailUris = useImageUriCache(thumbnailCacheRequests);

  const indexFromOffset = useCallback(
    (offset: number) =>
      Math.max(0, Math.min(images.length - 1, Math.round(offset / width))),
    [images.length, width],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    setIndex(initialIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: false,
        x: initialIndex * width,
      });
    });
  }, [initialIndex, visible, width]);

  const handleScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = indexFromOffset(nativeEvent.contentOffset.x);
      setIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [indexFromOffset],
  );

  const handleScrollSettled = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = indexFromOffset(nativeEvent.contentOffset.x);
      setIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [indexFromOffset],
  );

  const goToIndex = useCallback(
    (nextIndex: number) => {
      setIndex(nextIndex);
      scrollRef.current?.scrollTo({
        animated: false,
        x: nextIndex * width,
      });
    },
    [width],
  );

  if (images.length === 0) {
    return null;
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <StatusBar style="light" />
      <SafeAreaView
        edges={["bottom"]}
        style={[styles.previewSafeArea, { paddingTop: topInset }]}
      >
        <View style={styles.previewHeader}>
          <Text style={styles.previewCounter}>
            {index + 1} / {images.length}
          </Text>
          <Pressable
            accessibilityLabel="Close image preview"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.previewClose}
          >
            <X color="#fff" size={22} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          onMomentumScrollEnd={handleScrollSettled}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollSettled}
          pagingEnabled
          ref={scrollRef}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          style={styles.previewPager}
        >
          {images.map((image) => (
            <View
              key={image.id}
              style={[styles.previewSlide, { height: imageHeight, width }]}
            >
              <Image
                resizeMode="contain"
                source={imageSource(cachedOriginalUris[image.uri] ?? image.uri)}
                style={styles.previewImage}
              />
            </View>
          ))}
        </ScrollView>

        {images.length > 1 ? (
          <ScrollView
            contentContainerStyle={styles.previewThumbsContent}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.previewThumbs}
          >
            {images.map((image, itemIndex) => (
              <Pressable
                accessibilityLabel={`Show image ${itemIndex + 1}`}
                accessibilityRole="button"
                key={image.id}
                onPress={() => goToIndex(itemIndex)}
                style={[
                  styles.previewThumb,
                  itemIndex === index ? styles.previewThumbActive : null,
                ]}
              >
                <Image
                  resizeMode="cover"
                  source={imageSource(
                    cachedThumbnailUris[image.thumbnailUri ?? image.uri] ??
                      image.thumbnailUri ??
                      image.uri,
                  )}
                  style={styles.previewThumbImage}
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
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
  stickyHeader: {
    backgroundColor: "rgba(248,239,228,0.96)",
    borderBottomColor: "rgba(37,45,43,0.08)",
    borderBottomWidth: 1,
    gap: 8,
    marginHorizontal: -18,
    marginTop: -18,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  wallDiagnostics: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(37,45,43,0.06)",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  wallDiagnosticsText: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  loadMoreFooter: {
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
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
  media: {
    gap: 10,
  },
  mediaTrack: {
    gap: mediaSlideGap,
  },
  mediaSlide: {
    backgroundColor: palette.surface,
    borderRadius: radius.medium,
    overflow: "hidden",
  },
  mediaDots: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 6,
  },
  mediaDot: {
    backgroundColor: palette.inkFaint,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  mediaDotActive: {
    backgroundColor: palette.ink,
    width: 16,
  },
  mediaFallback: {
    alignItems: "center",
    backgroundColor: "rgba(37,45,43,0.04)",
    gap: 8,
    justifyContent: "center",
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
  previewSafeArea: {
    backgroundColor: "#0f1211",
    flex: 1,
  },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  previewCounter: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    fontWeight: "800",
  },
  previewClose: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  previewPager: {
    flexGrow: 0,
  },
  previewSlide: {
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewThumbs: {
    flexGrow: 0,
  },
  previewThumbsContent: {
    gap: 10,
    paddingBottom: 22,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  previewThumb: {
    borderColor: "transparent",
    borderRadius: radius.small,
    borderWidth: 2,
    height: 58,
    overflow: "hidden",
    width: 58,
  },
  previewThumbActive: {
    borderColor: "#fff",
  },
  previewThumbImage: {
    height: "100%",
    width: "100%",
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
