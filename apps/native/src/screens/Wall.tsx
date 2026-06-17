import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  PanGestureHandler,
  LegacyScrollView as GestureHandlerScrollView,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import {
  ArrowUp,
  Film,
  Heart,
  House,
  MessageCircle,
  Pencil,
  Play,
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
  hasRichTextContent,
  richTextImageSources,
  type MemoryMedia,
  type MemoryPost,
  type MemoryRichTextDocument,
  type MemoryRichTextMark,
  type MemoryRichTextNode,
} from "@may/core";

import type { MemoryDraft } from "../hooks/useDrafts";
import { useAppState } from "../state/AppState";
import { useMemoryWallContext } from "../state/MemoryWallProvider";
import { GlassCard, ScreenBackground, Surface } from "../ui/Glass";
import { AudioMediaPlayer } from "../ui/AudioMediaPlayer";
import { HapticPressable as Pressable } from "../ui/HapticPressable";
import { StatusGlyph, StatusLegend } from "../ui/MemoryStatus";
import { imageSource, useImageUriCache } from "../services/imageCache";
import { getLocalString, setLocalString } from "../services/storage";
import { SettingsPanel } from "./Settings";
import { palette, radius, shadow } from "../theme";

type ResolveAuthor = (id: string) => { displayName: string; initials: string };
type WallTab = "home" | "settings";
type WallListItem =
  | { id: "drafts"; type: "drafts" }
  | { id: "empty"; type: "empty" }
  | { id: "invite-nudge"; type: "invite-nudge" }
  | { id: string; post: MemoryPost; postIndex: number; type: "post" };

const inviteNudgeDismissedKey = (familyId: string) =>
  `may.invite-nudge-dismissed.${familyId}.v1`;

const mediaSlideGap = 10;
const minMediaPeekWidth = 24;
const maxMediaPeekWidth = 38;
const wallHorizontalPadding = 18;
const memoryCardPadding = 16;
const wallPrefetchTrailingItems = 4;
const backToFirstPostThreshold = 2;
const postBodyPreviewLines = 6;
const postBodyLineHeight = 22;
const postBodyPreviewHeight = postBodyPreviewLines * postBodyLineHeight;
const postBodyBlurHeight = 64;
const postBodyMediaOverlap = 16;
const postBodyMediaGap = 10;
const postBodyFadeColors = [
  "rgba(255,255,255,0)",
  "rgba(255,255,255,0.5)",
  "rgba(255,255,255,0.92)",
  "rgba(255,255,255,1)",
] as const;
const wallViewabilityConfig = { itemVisiblePercentThreshold: 20 };

export function Wall() {
  const router = useRouter();
  const {
    activeMemberId,
    connectGoogleDelivery,
    family,
    familyMemberships,
    signOut,
    switchFamily,
  } = useAppState();

  // `Wall` only renders once the app state is ready (see app/index.tsx).
  const fam = family!;
  const memberId = activeMemberId!;

  const {
    addComment,
    drafts,
    hasMorePosts,
    hydrated,
    isLoadingMorePosts,
    loadMorePosts,
    posts,
    retryPost,
    seedSampleMemories,
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
  const [showBackToFirstPost, setShowBackToFirstPost] = useState(false);
  const wallListRef = useRef<FlatList<WallListItem>>(null);
  const wallHeaderScrollY = useRef(new Animated.Value(0)).current;
  const backToFirstPostVisibility = useRef(new Animated.Value(0)).current;
  const canLoadMorePostsRef = useRef(false);
  const loadMorePostsRef = useRef(loadMorePosts);
  const postsLengthRef = useRef(posts.length);

  useEffect(() => {
    setInviteNudgeDismissed(getLocalString(inviteNudgeStorageKey) === "true");
  }, [inviteNudgeStorageKey]);

  useEffect(() => {
    canLoadMorePostsRef.current = hasMorePosts && !isLoadingMorePosts;
    loadMorePostsRef.current = loadMorePosts;
    postsLengthRef.current = posts.length;
  }, [hasMorePosts, isLoadingMorePosts, loadMorePosts, posts.length]);

  useEffect(() => {
    Animated.timing(backToFirstPostVisibility, {
      duration: 180,
      toValue: showBackToFirstPost ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [backToFirstPostVisibility, showBackToFirstPost]);

  const handleWallScroll = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { contentOffset: { y: wallHeaderScrollY } } }],
        { useNativeDriver: false },
      ),
    [wallHeaderScrollY],
  );

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

  const scrollToTop = useCallback(() => {
    wallHeaderScrollY.setValue(0);
    wallListRef.current?.scrollToOffset({
      animated: true,
      offset: 0,
    });
  }, [wallHeaderScrollY]);

  const handleViewablePostsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const visiblePostIndex = viewableItems.reduce((maxIndex, item) => {
        const wallItem = item.item as WallListItem | undefined;
        return wallItem?.type === "post"
          ? Math.max(maxIndex, wallItem.postIndex)
          : maxIndex;
      }, -1);

      setShowBackToFirstPost(visiblePostIndex >= backToFirstPostThreshold);

      if (!canLoadMorePostsRef.current) {
        return;
      }

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
                scrollY={wallHeaderScrollY}
              />
            }
            maxToRenderPerBatch={10}
            onEndReached={requestMorePosts}
            onEndReachedThreshold={0.35}
            onScroll={handleWallScroll}
            onViewableItemsChanged={handleViewablePostsChanged}
            ref={wallListRef}
            renderItem={renderWallItem}
            scrollEventThrottle={16}
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
              activeFamilyId={fam.id}
              childName={fam.childName}
              familyMemberships={familyMemberships}
              googleDeliveryConnection={fam.deliveryConnection}
              onConnectGoogleDelivery={connectGoogleDelivery}
              onInvite={() => router.push("/invite")}
              onJoinFamily={() => router.push("/join")}
              onSignOut={confirmSignOut}
              onSwitchFamily={switchFamily}
            />
          </ScrollView>
        )}

        {activeTab === "home" ? (
          <Animated.View
            pointerEvents={showBackToFirstPost ? "auto" : "none"}
            style={[
              styles.backToFirstPostDock,
              {
                opacity: backToFirstPostVisibility,
                transform: [
                  {
                    translateY: backToFirstPostVisibility.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                  {
                    scale: backToFirstPostVisibility.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.94, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable
              accessibilityLabel="Go to top"
              accessibilityRole="button"
              onPress={scrollToTop}
              style={({ pressed }) => [
                styles.backToFirstPostButton,
                pressed ? styles.backToFirstPostPressed : null,
              ]}
            >
              <ArrowUp color={palette.ink} size={22} />
            </Pressable>
          </Animated.View>
        ) : null}

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
  scrollY,
}: {
  childName: string;
  scrollY: Animated.Value;
}) {
  const opacity = scrollY.interpolate({
    inputRange: [0, 72],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const translateY = scrollY.interpolate({
    inputRange: [0, 72],
    outputRange: [0, -14],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      style={[styles.stickyHeader, { opacity, transform: [{ translateY }] }]}
    >
      <View style={styles.pageHeader}>
        <Text numberOfLines={1} style={styles.pageTitle}>
          {`${childName}'s story`}
        </Text>
      </View>
    </Animated.View>
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
  const [postContentCollapsed, setPostContentCollapsed] = useState(false);
  const hasRichContent = hasRichTextContent(post.content);
  const richImageIds = useMemo(
    () => contentImageMediaIds(post.content, post.contentImageMap, post.media),
    [post.content, post.contentImageMap, post.media],
  );
  const remainingMedia = useMemo(
    () =>
      hasRichContent
        ? post.media.filter((media) => !richImageIds.has(media.id))
        : post.media,
    [hasRichContent, post.media, richImageIds],
  );
  const postContent =
    hasRichContent && post.content ? (
      <RichMemoryContent
        content={post.content}
        contentImageMap={post.contentImageMap}
        media={post.media}
      />
    ) : post.body ? (
      <Text style={styles.postBody}>{post.body}</Text>
    ) : null;

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

      {postContent ? (
        <ExpandablePostContent
          body={post.body}
          hasFollowingMedia={remainingMedia.length > 0}
          onCollapsedChange={setPostContentCollapsed}
        >
          {postContent}
        </ExpandablePostContent>
      ) : null}

      {remainingMedia.length > 0 ? (
        <View
          style={postContentCollapsed ? styles.mediaBehindPostPreview : null}
        >
          <MediaCarousel media={remainingMedia} />
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

function ExpandablePostContent({
  body,
  children,
  hasFollowingMedia = false,
  onCollapsedChange,
}: {
  body: string;
  children: ReactNode;
  hasFollowingMedia?: boolean;
  onCollapsedChange?: (isCollapsed: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [bodyLineCount, setBodyLineCount] = useState(0);
  const bodyText = body.trim();
  const shouldMeasureBody = bodyText.length > 0;
  const likelyNeedsPreview =
    bodyText.length > 220 ||
    bodyText.split(/\r?\n/).length > postBodyPreviewLines;
  const isTruncated = bodyLineCount > postBodyPreviewLines;
  const canToggle = isTruncated || (bodyLineCount === 0 && likelyNeedsPreview);
  const isCollapsed = !expanded && canToggle;

  useEffect(() => {
    setExpanded(false);
    setBodyLineCount(0);
  }, [body]);

  useEffect(() => {
    onCollapsedChange?.(isCollapsed);
  }, [isCollapsed, onCollapsedChange]);

  const handleBodyLayout = useCallback(
    (event: { nativeEvent: { lines: unknown[] } }) => {
      const nextLineCount = event.nativeEvent.lines.length;
      setBodyLineCount((currentLineCount) =>
        currentLineCount === nextLineCount ? currentLineCount : nextLineCount,
      );
    },
    [],
  );

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  return (
    <View style={styles.postContentShell}>
      <View
        style={[
          styles.postContentClip,
          isCollapsed ? styles.postContentCollapsed : null,
        ]}
      >
        {children}
      </View>

      {shouldMeasureBody ? (
        <Text
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          onTextLayout={handleBodyLayout}
          pointerEvents="none"
          style={[styles.postBody, styles.postBodyMeasure]}
        >
          {body}
        </Text>
      ) : null}

      {isCollapsed ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.postBodyBlur,
            hasFollowingMedia ? styles.postBodyBlurWithMedia : null,
          ]}
        >
          <BlurView
            intensity={7}
            pointerEvents="none"
            style={[styles.postBodyBlurBand, styles.postBodyBlurBandSoft]}
            tint="light"
          />
          <BlurView
            intensity={16}
            pointerEvents="none"
            style={[styles.postBodyBlurBand, styles.postBodyBlurBandMedium]}
            tint="light"
          />
          <BlurView
            intensity={28}
            pointerEvents="none"
            style={[styles.postBodyBlurBand, styles.postBodyBlurBandStrong]}
            tint="light"
          />
          <LinearGradient
            colors={postBodyFadeColors}
            locations={[0, 0.18, 0.54, 1]}
            pointerEvents="none"
            style={styles.postBodyFade}
          />
          <Pressable
            accessibilityLabel="Read full post"
            accessibilityRole="button"
            onPress={toggleExpanded}
            style={({ pressed }) => [
              styles.readMoreButton,
              hasFollowingMedia ? styles.readMoreButtonWithMedia : null,
              pressed ? styles.pressedButton : null,
            ]}
          >
            <Text style={styles.readMoreText}>Read more</Text>
          </Pressable>
        </View>
      ) : null}

      {expanded && canToggle ? (
        <Pressable
          accessibilityLabel="Collapse post"
          accessibilityRole="button"
          onPress={toggleExpanded}
          style={({ pressed }) => [
            styles.showLessButton,
            pressed ? styles.pressedButton : null,
          ]}
        >
          <Text style={styles.readMoreText}>Show less</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const contentImageMediaIds = (
  content?: MemoryRichTextDocument,
  contentImageMap: Record<string, string> = {},
  media: MemoryMedia[] = [],
) =>
  new Set(
    richTextImageSources(content)
      .map((source) => {
        const mapped = contentImageMap[source];
        return (
          mapped ??
          media.find(
            (item) => item.uri === source || item.thumbnailUri === source,
          )?.id
        );
      })
      .filter((id): id is string => Boolean(id)),
  );

function RichMemoryContent({
  content,
  contentImageMap = {},
  media,
}: {
  content: MemoryRichTextDocument;
  contentImageMap?: Record<string, string>;
  media: MemoryMedia[];
}) {
  const imageMedia = useMemo(
    () => collectRichContentImages(content, contentImageMap, media),
    [content, contentImageMap, media],
  );
  const thumbnailCacheRequests = useMemo(
    () =>
      imageMedia.map((image) => ({
        media: image,
        uri: image.thumbnailUri ?? image.uri,
        variant: "thumbnail" as const,
      })),
    [imageMedia],
  );
  const cachedThumbnailUris = useImageUriCache(thumbnailCacheRequests);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const closePreview = useCallback(() => setPreviewIndex(null), []);

  const openImage = useCallback(
    (image: MemoryMedia) => {
      const nextIndex = imageMedia.findIndex((item) => item.id === image.id);
      if (nextIndex >= 0) {
        setPreviewIndex(nextIndex);
      }
    },
    [imageMedia],
  );

  return (
    <View style={styles.richContent}>
      {content.content?.map((node, index) =>
        renderRichBlock({
          cachedThumbnailUris,
          contentImageMap,
          key: String(index),
          media,
          node,
          onOpenImage: openImage,
        }),
      )}
      <MediaPreviewer
        images={imageMedia}
        initialIndex={previewIndex ?? 0}
        onClose={closePreview}
        visible={previewIndex !== null}
      />
    </View>
  );
}

const collectRichContentImages = (
  content: MemoryRichTextDocument,
  contentImageMap: Record<string, string>,
  media: MemoryMedia[],
) => {
  const images: MemoryMedia[] = [];
  const seen = new Set<string>();

  richTextImageSources(content).forEach((source, index) => {
    const item = resolveRichImageMedia(source, contentImageMap, media, index);
    if (!seen.has(item.id)) {
      seen.add(item.id);
      images.push(item);
    }
  });

  return images;
};

const resolveRichImageMedia = (
  source: string,
  contentImageMap: Record<string, string>,
  media: MemoryMedia[],
  index = 0,
): MemoryMedia => {
  const mappedId = contentImageMap[source];
  return (
    media.find((item) => item.id === mappedId) ??
    media.find(
      (item) =>
        item.kind === "image" &&
        (item.uri === source || item.thumbnailUri === source),
    ) ?? {
      id: `content-image-${index}`,
      kind: "image",
      uri: source,
    }
  );
};

const renderRichBlock = ({
  cachedThumbnailUris,
  contentImageMap,
  key,
  media,
  node,
  onOpenImage,
}: {
  cachedThumbnailUris: Record<string, string>;
  contentImageMap: Record<string, string>;
  key: string;
  media: MemoryMedia[];
  node: MemoryRichTextNode;
  onOpenImage: (media: MemoryMedia) => void;
}): ReactNode => {
  switch (node.type) {
    case "heading":
      return (
        <Text key={key} style={styles.richHeading}>
          {renderRichInline(node.content)}
        </Text>
      );
    case "paragraph":
      return (
        <Text key={key} style={styles.postBody}>
          {renderRichInline(node.content)}
        </Text>
      );
    case "blockquote":
      return (
        <View key={key} style={styles.richQuote}>
          {node.content?.map((child, index) =>
            renderRichBlock({
              cachedThumbnailUris,
              contentImageMap,
              key: `${key}-${index}`,
              media,
              node: child,
              onOpenImage,
            }),
          )}
        </View>
      );
    case "bulletList":
    case "orderedList":
      return (
        <View key={key} style={styles.richList}>
          {node.content?.map((child, index) => (
            <View key={`${key}-${index}`} style={styles.richListItem}>
              <Text style={styles.richListBullet}>
                {node.type === "orderedList" ? `${index + 1}.` : "•"}
              </Text>
              <View style={styles.richListItemBody}>
                {child.content?.map((grandchild, grandchildIndex) =>
                  renderRichBlock({
                    cachedThumbnailUris,
                    contentImageMap,
                    key: `${key}-${index}-${grandchildIndex}`,
                    media,
                    node: grandchild,
                    onOpenImage,
                  }),
                )}
              </View>
            </View>
          ))}
        </View>
      );
    case "horizontalRule":
      return <View key={key} style={styles.richRule} />;
    case "image": {
      const source = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      if (!source) {
        return null;
      }
      const image = resolveRichImageMedia(source, contentImageMap, media);
      const uri =
        cachedThumbnailUris[image.thumbnailUri ?? image.uri] ??
        image.thumbnailUri ??
        image.uri;

      return (
        <Pressable
          accessibilityLabel="Open image"
          accessibilityRole="button"
          key={key}
          onPress={() => onOpenImage(image)}
          style={styles.richImageButton}
        >
          <Image
            resizeMode="cover"
            source={imageSource(uri)}
            style={styles.richImage as ImageStyle}
          />
        </Pressable>
      );
    }
    default:
      return node.content?.map((child, index) =>
        renderRichBlock({
          cachedThumbnailUris,
          contentImageMap,
          key: `${key}-${index}`,
          media,
          node: child,
          onOpenImage,
        }),
      );
  }
};

const renderRichInline = (nodes: MemoryRichTextNode[] = []): ReactNode[] =>
  nodes.map((node, index) => {
    if (node.type === "hardBreak") {
      return "\n";
    }
    if (node.type !== "text") {
      return renderRichInline(node.content);
    }

    return (
      <Text key={index} style={richTextMarkStyle(node.marks)}>
        {node.text}
      </Text>
    );
  });

const richTextMarkStyle = (marks: MemoryRichTextMark[] = []) =>
  marks.map((mark) => {
    switch (mark.type) {
      case "bold":
        return styles.richBold;
      case "italic":
        return styles.richItalic;
      case "strike":
        return styles.richStrike;
      case "underline":
        return styles.richUnderline;
      case "link":
        return styles.richLink;
      case "code":
        return styles.richCode;
      default:
        return null;
    }
  });

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
  const [videoPreview, setVideoPreview] = useState<MemoryMedia | null>(null);
  const audioOnly = media.every((item) => item.kind === "audio");
  const height = audioOnly ? 76 : Math.round(slideWidth * 0.75);

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
  const closeVideoPreview = useCallback(() => setVideoPreview(null), []);

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
                onOpenVideo={setVideoPreview}
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
          <VideoPreviewer
            media={videoPreview}
            onClose={closeVideoPreview}
            visible={videoPreview !== null}
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
  onOpenVideo,
  width,
}: {
  cachedUri?: string;
  height: number;
  media: MemoryMedia;
  onOpenPreview?: (media: MemoryMedia) => void;
  onOpenVideo?: (media: MemoryMedia) => void;
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

  if (media.kind === "audio") {
    return <AudioMediaSlide height={height} media={media} width={width} />;
  }

  return (
    <Pressable
      accessibilityLabel="Open video"
      accessibilityRole="button"
      onPress={() => onOpenVideo?.(media)}
      style={({ pressed }) => [
        styles.mediaSlide,
        styles.videoTile,
        { height, width },
        pressed ? styles.pressedButton : null,
      ]}
    >
      <View style={styles.videoIcon}>
        <Film color="#fff" size={28} />
      </View>
      <Text style={styles.mediaFallbackTitle}>Video memory</Text>
      <View style={styles.videoMetaRow}>
        <Play color={palette.berry} fill={palette.berry} size={13} />
        <Text style={styles.mediaFallbackMeta}>
          {media.durationMs
            ? formatMediaDuration(media.durationMs / 1000)
            : "Watch"}
        </Text>
      </View>
    </Pressable>
  );
}

function AudioMediaSlide({
  height,
  media,
  width,
}: {
  height: number;
  media: MemoryMedia;
  width: number;
}) {
  return <AudioMediaPlayer media={media} style={{ height, width }} />;
}

function VideoPreviewer({
  media,
  onClose,
  visible,
}: {
  media: MemoryMedia | null;
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(media?.uri ?? null, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    if (!visible || !media) {
      player.pause();
      return;
    }

    player.currentTime = 0;
    player.play();

    return () => {
      player.pause();
    };
  }, [media, player, visible]);

  if (!media) {
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
        style={[
          styles.previewSafeArea,
          { paddingTop: Math.max(insets.top, 24) },
        ]}
      >
        <View style={styles.previewHeader}>
          <Text style={styles.previewCounter}>Video memory</Text>
          <Pressable
            accessibilityLabel="Close video"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.previewClose}
          >
            <X color="#fff" size={22} />
          </Pressable>
        </View>

        <View style={styles.videoPreviewBody}>
          <VideoView
            contentFit="contain"
            fullscreenOptions={{ enable: true }}
            nativeControls
            player={player}
            style={styles.videoPlayer}
          />
        </View>
      </SafeAreaView>
    </Modal>
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
  const previewPanRef = useRef<PanGestureHandler>(null);
  const previewDragY = useRef(new Animated.Value(0)).current;
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
  const previewBodyOpacity = previewDragY.interpolate({
    inputRange: [0, 180],
    outputRange: [1, 0.72],
    extrapolate: "clamp",
  });

  const indexFromOffset = useCallback(
    (offset: number) =>
      Math.max(0, Math.min(images.length - 1, Math.round(offset / width))),
    [images.length, width],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    previewDragY.setValue(0);
    setIndex(initialIndex);
    if (images.length > 1) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          animated: false,
          x: initialIndex * width,
        });
      });
    }
  }, [images.length, initialIndex, previewDragY, visible, width]);

  const resetPreviewDrag = useCallback(() => {
    Animated.spring(previewDragY, {
      speed: 18,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }, [previewDragY]);

  const closeFromSwipe = useCallback(() => {
    Animated.timing(previewDragY, {
      duration: 160,
      toValue: height,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        previewDragY.setValue(0);
        onClose();
      }
    });
  }, [height, onClose, previewDragY]);

  const handlePreviewPan = useCallback(
    ({ nativeEvent }: PanGestureHandlerGestureEvent) => {
      previewDragY.setValue(Math.max(0, nativeEvent.translationY));
    },
    [previewDragY],
  );

  const handlePreviewPanState = useCallback(
    ({ nativeEvent }: PanGestureHandlerStateChangeEvent) => {
      if (nativeEvent.state === State.BEGAN) {
        previewDragY.stopAnimation();
        return;
      }

      if (
        nativeEvent.state === State.END ||
        nativeEvent.state === State.CANCELLED ||
        nativeEvent.state === State.FAILED
      ) {
        if (nativeEvent.translationY > 84 || nativeEvent.velocityY > 850) {
          closeFromSwipe();
          return;
        }

        resetPreviewDrag();
      }
    },
    [closeFromSwipe, previewDragY, resetPreviewDrag],
  );

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

  const previewDragStyle = {
    opacity: previewBodyOpacity,
    transform: [{ translateY: previewDragY }],
  };
  const activeImage = images[index] ?? images[0];
  const previewContent =
    images.length === 1 ? (
      <Animated.View
        collapsable={false}
        style={[styles.previewGestureArea, previewDragStyle]}
      >
        <View style={[styles.previewSlide, { height: imageHeight, width }]}>
          <Image
            resizeMode="contain"
            source={imageSource(
              cachedOriginalUris[activeImage.uri] ?? activeImage.uri,
            )}
            style={styles.previewImage}
          />
        </View>
      </Animated.View>
    ) : (
      <Animated.View
        collapsable={false}
        style={[styles.previewGestureArea, previewDragStyle]}
      >
        <GestureHandlerScrollView
          horizontal
          onMomentumScrollEnd={handleScrollSettled}
          onScroll={handleScroll}
          onScrollEndDrag={handleScrollSettled}
          pagingEnabled
          ref={scrollRef}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          simultaneousHandlers={previewPanRef}
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
        </GestureHandlerScrollView>
      </Animated.View>
    );

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

        <PanGestureHandler
          activeOffsetY={[-100000, 8]}
          enabled={visible}
          failOffsetX={[-56, 56]}
          maxPointers={1}
          onGestureEvent={handlePreviewPan}
          onHandlerStateChange={handlePreviewPanState}
          ref={previewPanRef}
          simultaneousHandlers={scrollRef}
        >
          {previewContent}
        </PanGestureHandler>

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

function formatMediaDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
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
    backgroundColor: "transparent",
    gap: 8,
    marginHorizontal: -18,
    marginTop: -18,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
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
    fontWeight: "700",
    lineHeight: 32,
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
  backToFirstPostDock: {
    bottom: 88,
    position: "absolute",
    right: 18,
  },
  backToFirstPostButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
    borderColor: "rgba(255,255,255,0.86)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 50,
    justifyContent: "center",
    width: 50,
    ...shadow.soft,
  },
  backToFirstPostPressed: {
    opacity: 0.72,
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
    alignSelf: "stretch",
    gap: 14,
    padding: 16,
    width: "100%",
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
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  postContentShell: {
    position: "relative",
  },
  postContentClip: {
    overflow: "visible",
  },
  postContentCollapsed: {
    maxHeight: postBodyPreviewHeight,
    overflow: "hidden",
  },
  postBodyMeasure: {
    left: 0,
    opacity: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  postBodyBlur: {
    alignItems: "center",
    bottom: 0,
    height: postBodyBlurHeight,
    justifyContent: "center",
    left: -1,
    overflow: "visible",
    position: "absolute",
    right: -1,
  },
  postBodyBlurWithMedia: {
    bottom: -postBodyMediaOverlap,
    height: postBodyBlurHeight + postBodyMediaOverlap,
  },
  postBodyBlurBand: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
  },
  postBodyBlurBandSoft: {
    height: "72%",
    opacity: 0.38,
  },
  postBodyBlurBandMedium: {
    height: "52%",
    opacity: 0.72,
  },
  postBodyBlurBandStrong: {
    height: "34%",
    opacity: 1,
  },
  postBodyFade: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  readMoreButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  readMoreButtonWithMedia: {
    alignSelf: "center",
    bottom: postBodyMediaOverlap + 22,
    position: "absolute",
  },
  showLessButton: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: radius.pill,
    marginTop: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  readMoreText: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "900",
    textShadowColor: "rgba(255,255,255,0.72)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 5,
  },
  pressedButton: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  mediaBehindPostPreview: {
    marginTop: -postBodyMediaOverlap + postBodyMediaGap,
    zIndex: 1,
  },
  richContent: {
    gap: 12,
  },
  richHeading: {
    color: palette.ink,
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 25,
  },
  richQuote: {
    borderLeftColor: "rgba(91,126,102,0.42)",
    borderLeftWidth: 3,
    gap: 8,
    paddingLeft: 12,
  },
  richList: {
    gap: 7,
  },
  richListItem: {
    flexDirection: "row",
    gap: 8,
  },
  richListBullet: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 22,
    minWidth: 20,
  },
  richListItemBody: {
    flex: 1,
    gap: 6,
  },
  richRule: {
    backgroundColor: "rgba(37,45,43,0.12)",
    height: 1,
    marginVertical: 4,
  },
  richImageButton: {
    aspectRatio: 4 / 3,
    backgroundColor: palette.surface,
    borderRadius: radius.medium,
    overflow: "hidden",
    width: "100%",
  },
  richImage: {
    height: "100%",
    width: "100%",
  },
  richBold: {
    fontWeight: "900",
  },
  richItalic: {
    fontStyle: "italic",
  },
  richStrike: {
    textDecorationLine: "line-through",
  },
  richUnderline: {
    textDecorationLine: "underline",
  },
  richLink: {
    color: palette.moss,
    textDecorationLine: "underline",
  },
  richCode: {
    backgroundColor: "rgba(37,45,43,0.08)",
    fontFamily: Platform.select({
      android: "monospace",
      ios: "Menlo",
      default: undefined,
    }),
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
  videoTile: {
    alignItems: "center",
    backgroundColor: "rgba(176,76,64,0.08)",
    gap: 10,
    justifyContent: "center",
  },
  videoIcon: {
    alignItems: "center",
    backgroundColor: palette.berry,
    borderRadius: radius.pill,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  videoMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
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
  previewGestureArea: {
    flexGrow: 0,
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
  videoPreviewBody: {
    flex: 1,
    justifyContent: "center",
  },
  videoPlayer: {
    flex: 1,
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
    alignSelf: "stretch",
    backgroundColor: "rgba(37,45,43,0.04)",
    borderRadius: radius.small,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    padding: 6,
  },
  commentInput: {
    color: palette.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    minHeight: 36,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlignVertical: "center",
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
