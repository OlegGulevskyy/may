import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type DimensionValue,
  type ImageStyle,
} from "react-native";
import { useEventListener } from "expo";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  CalendarDays,
  ChevronRight,
  Film,
  Image as ImageIcon,
  Mic,
  Play,
  RefreshCw,
  Sparkles,
  Trophy,
  X,
} from "lucide-react-native";

import type {
  MemoryRecap,
  MemoryMedia,
  MemoryRecapPeriodKind,
  MemoryRecapSource,
} from "@may/core";

import {
  requestFamilyRecap,
  subscribeToFamilyRecaps,
} from "../services/recapBackend";
import {
  imageSource,
  useImageUriCache,
  type ImageCacheRequest,
} from "../services/imageCache";
import {
  isOriginalMediaStreamUrl,
  originalMediaStreamUrl,
  resolvePlayableVideoSource,
} from "../services/originalMediaPlayback";
import { GlassCard, Surface } from "../ui/Glass";
import { HapticPressable as Pressable } from "../ui/HapticPressable";
import { palette, radius, shadow } from "../theme";

type RecapPeriodOption = {
  key: string;
  label: string;
  periodKind: MemoryRecapPeriodKind;
  periodStart: string;
  periodEnd: string;
};

type RecapMediaItem = {
  id: string;
  sourceId: string;
  kind: "image" | "video" | "audio" | "note";
  uri?: string;
  thumbnailUri?: string;
  createdAt: string;
  bodyPreview?: string;
  transcriptPreview?: string;
  cacheMedia?: MemoryMedia;
};

type RecapMediaGroup = {
  dateLabel?: string;
  id: string;
  title: string;
  items: RecapMediaItem[];
};

type ResolveRecapAuthor = (id: string) => {
  displayName: string;
  id: string;
  initials: string;
};

const uriScheme = (uri: string) => uri.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];

export function RecapsPanel({
  childName,
  familyId,
  initialRecapId,
  resolveAuthor,
}: {
  childName: string;
  familyId: string;
  initialRecapId?: string;
  resolveAuthor: ResolveRecapAuthor;
}) {
  const [error, setError] = useState<string | null>(null);
  const [recaps, setRecaps] = useState<MemoryRecap[]>([]);
  const [requestingKey, setRequestingKey] = useState<string | null>(null);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("week");
  const [selectedRecapId, setSelectedRecapId] = useState<string | null>(null);
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const periodOptions = useMemo(() => currentPeriodOptions(), []);
  const selectedRecap = useMemo(
    () => recaps.find((recap) => recap.id === selectedRecapId) ?? null,
    [recaps, selectedRecapId],
  );

  useEffect(() => {
    const unsubscribe = subscribeToFamilyRecaps({
      familyId,
      onError: setError,
      onRecaps: (nextRecaps) => {
        setError(null);
        setRecaps(nextRecaps);
      },
    });

    return () => unsubscribe?.();
  }, [familyId]);

  useEffect(() => {
    if (
      selectedRecapId &&
      recaps.length > 0 &&
      !recaps.some((recap) => recap.id === selectedRecapId)
    ) {
      setSelectedRecapId(null);
    }
  }, [recaps, selectedRecapId]);

  useEffect(() => {
    if (initialRecapId) {
      setSelectedRecapId(initialRecapId);
    }
  }, [initialRecapId]);

  const requestRecap = useCallback(
    async (option: RecapPeriodOption) => {
      setSelectedPeriodKey(option.key);
      setRequestingKey(option.key);
      try {
        const result = await requestFamilyRecap({
          familyId,
          periodKind: option.periodKind,
          periodStart: option.periodStart,
          periodEnd: option.periodEnd,
          timezone,
        });
        if (result.status === "ready") {
          setSelectedRecapId(result.recapId);
        }
      } catch (requestError) {
        Alert.alert("Could not start recap", getErrorMessage(requestError));
      } finally {
        setRequestingKey(null);
      }
    },
    [familyId, timezone],
  );

  if (selectedRecap) {
    return (
      <RecapDetail
        childName={childName}
        onClose={() => setSelectedRecapId(null)}
        recap={selectedRecap}
        resolveAuthor={resolveAuthor}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.panel}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.kicker}>Recaps</Text>
        <Text numberOfLines={1} style={styles.title}>
          {`${childName}'s chapters`}
        </Text>
      </View>

      <View style={styles.periodGrid}>
        {periodOptions.map((option) => (
          <PeriodButton
            active={selectedPeriodKey === option.key}
            busy={requestingKey === option.key}
            key={option.key}
            onPress={() => requestRecap(option)}
            option={option}
          />
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.recapList}>
        {recaps.length === 0 ? (
          <EmptyRecaps />
        ) : (
          recaps.map((recap) => (
            <RecapRow
              key={recap.id}
              onOpen={() => {
                if (recap.status === "ready") {
                  setSelectedRecapId(recap.id);
                }
              }}
              onRetry={() =>
                requestRecap({
                  key: recap.id,
                  label: "Retry",
                  periodKind: recap.periodKind,
                  periodStart: recap.periodStart,
                  periodEnd: recap.periodEnd,
                })
              }
              recap={recap}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

function PeriodButton({
  active,
  busy,
  onPress,
  option,
}: {
  active: boolean;
  busy: boolean;
  onPress: () => void;
  option: RecapPeriodOption;
}) {
  return (
    <Pressable
      accessibilityLabel={`Generate ${option.label.toLowerCase()} recap`}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.periodButton,
        active ? styles.periodButtonActive : null,
        pressed && !busy ? styles.pressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={active ? palette.porcelain : palette.berry}
          size="small"
        />
      ) : (
        <Sparkles
          color={active ? palette.porcelain : palette.berry}
          size={16}
        />
      )}
      <Text
        numberOfLines={1}
        style={[
          styles.periodButtonText,
          active ? styles.periodButtonTextActive : null,
        ]}
      >
        {option.label}
      </Text>
    </Pressable>
  );
}

function EmptyRecaps() {
  return (
    <GlassCard intensity={34} style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <CalendarDays color={palette.gold} size={22} />
      </View>
      <Text style={styles.emptyTitle}>No recaps yet</Text>
    </GlassCard>
  );
}

function RecapRow({
  onOpen,
  onRetry,
  recap,
}: {
  onOpen: () => void;
  onRetry: () => void;
  recap: MemoryRecap;
}) {
  const rowMedia = useMemo(
    () =>
      recap.sources
        .flatMap((source) =>
          source.media
            .filter((media) => media.kind === "image" && media.thumbnailUri)
            .map((media) => recapMediaCacheItem(recap.familyId, source, media)),
        )
        .slice(0, 3),
    [recap.familyId, recap.sources],
  );
  const cacheRequests = useMemo(
    () =>
      rowMedia
        .map((item) => cacheRequestForItem(item, "thumbnail"))
        .filter((item): item is ImageCacheRequest => Boolean(item)),
    [rowMedia],
  );
  const cachedUris = useImageUriCache(cacheRequests);
  const imageUris = rowMedia
    .map((item) =>
      item.thumbnailUri
        ? (cachedUris[item.thumbnailUri] ?? item.thumbnailUri)
        : "",
    )
    .filter(Boolean);
  const status = recapStatus(recap);

  return (
    <Surface style={styles.recapRow}>
      <Pressable
        accessibilityLabel={`${formatPeriodLabel(recap)} recap`}
        accessibilityRole="button"
        disabled={recap.status !== "ready"}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.recapRowPressable,
          pressed && recap.status === "ready" ? styles.pressed : null,
        ]}
      >
        <View style={styles.recapThumbStack}>
          {imageUris.length > 0 ? (
            imageUris.map((uri, index) => (
              <Image
                key={`${uri}-${index}`}
                source={imageSource(uri)}
                style={[
                  styles.recapThumb as ImageStyle,
                  {
                    left: index * 16,
                    opacity: 1 - index * 0.12,
                    top: index * 6,
                  },
                ]}
              />
            ))
          ) : (
            <View style={styles.recapThumbFallback}>
              <Sparkles color={palette.gold} size={22} />
            </View>
          )}
        </View>

        <View style={styles.recapRowText}>
          <Text numberOfLines={2} style={styles.recapTitle}>
            {formatPeriodLabel(recap)}
          </Text>
          <Text numberOfLines={1} style={styles.recapMeta}>
            {formatPeriodLabel(recap)} · {status.label}
          </Text>
          {recap.errorMessage ? (
            <Text numberOfLines={2} style={styles.recapError}>
              {recap.errorMessage}
            </Text>
          ) : null}
        </View>

        <View style={styles.recapStatusIcon}>
          {status.icon === "loading" ? (
            <ActivityIndicator color={palette.berry} size="small" />
          ) : status.icon === "failed" ? (
            <Pressable
              accessibilityLabel="Retry recap"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onRetry}
              style={styles.retryButton}
            >
              <RefreshCw color={palette.berry} size={18} />
            </Pressable>
          ) : (
            <ChevronRight color={palette.inkFaint} size={22} />
          )}
        </View>
      </Pressable>
    </Surface>
  );
}

function RecapDetail({
  childName,
  onClose,
  recap,
  resolveAuthor,
}: {
  childName: string;
  onClose: () => void;
  recap: MemoryRecap;
  resolveAuthor: ResolveRecapAuthor;
}) {
  const { width } = useWindowDimensions();
  const [viewerItemId, setViewerItemId] = useState<string | null>(null);
  const mediaGroups = useMemo(() => mediaGroupsFromRecap(recap), [recap]);
  const allItems = useMemo(
    () => mediaGroups.flatMap((group) => group.items),
    [mediaGroups],
  );
  const visualItems = useMemo(
    () =>
      allItems.filter(
        (item) =>
          (item.kind === "image" || item.kind === "video") &&
          Boolean(item.uri ?? item.thumbnailUri),
      ),
    [allItems],
  );
  const thumbnailCacheRequests = useMemo(
    () =>
      allItems
        .map((item) => cacheRequestForItem(item, "thumbnail"))
        .filter((item): item is ImageCacheRequest => Boolean(item)),
    [allItems],
  );
  const cachedThumbnailUris = useImageUriCache(thumbnailCacheRequests);
  const coverItem = allItems.find((item) => item.thumbnailUri) ?? allItems[0];
  const coverUri = displayUriForItem(coverItem, cachedThumbnailUris);
  const gridWidth = Math.max(280, width - 32);
  const tileGap = 7;
  const tileSize = Math.floor((gridWidth - tileGap) / 2);
  const summary =
    parentSafeSummary(recap.subtitle) ?? firstMemoryTextPreview(allItems);
  const memoryCount = recap.sourceMemoryIds.length || recap.sources.length;
  const openViewer = useCallback((item: RecapMediaItem) => {
    if (
      (item.kind === "image" || item.kind === "video") &&
      (item.uri || item.thumbnailUri)
    ) {
      setViewerItemId(item.id);
    }
  }, []);

  return (
    <ScrollView
      contentContainerStyle={styles.detailContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.detailTopBar}>
        <Pressable
          accessibilityLabel="Close recap"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onClose}
          style={({ pressed }) => [
            styles.closeButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <X color={palette.ink} size={21} />
        </Pressable>
      </View>

      <View style={styles.mediaHero}>
        {coverUri ? (
          <Image
            source={imageSource(coverUri)}
            style={styles.mediaHeroImage as ImageStyle}
          />
        ) : (
          <View style={styles.mediaHeroFallback}>
            <Sparkles color={palette.gold} size={32} />
          </View>
        )}
        <View style={styles.mediaHeroScrim} />
        <View style={styles.mediaHeroText}>
          <Text style={styles.mediaHeroKicker}>{formatPeriodLabel(recap)}</Text>
          <Text numberOfLines={2} style={styles.mediaHeroTitle}>
            {recapTitle(recap)}
          </Text>
          {summary ? (
            <Text numberOfLines={2} style={styles.mediaHeroSummary}>
              {summary}
            </Text>
          ) : null}
          <Text style={styles.mediaHeroMeta}>
            {memoryCount} memor{memoryCount === 1 ? "y" : "ies"} for {childName}
          </Text>
        </View>
      </View>

      <RecapContributorSummary recap={recap} resolveAuthor={resolveAuthor} />

      <View style={styles.mediaGroups}>
        {mediaGroups.map((group) => (
          <View key={group.id} style={styles.mediaGroup}>
            {!isSingleImageGroup(group) || group.dateLabel ? (
              <View style={styles.mediaGroupHeader}>
                {isSingleImageGroup(group) ? null : (
                  <Text style={styles.mediaGroupTitle}>{group.title}</Text>
                )}
                {group.dateLabel ? (
                  <Text style={styles.mediaGroupDate}>{group.dateLabel}</Text>
                ) : null}
              </View>
            ) : null}
            <View style={[styles.mediaGrid, { gap: tileGap }]}>
              {group.items.map((item, index) => {
                const spanFull = shouldFeatureRecapItem(
                  index,
                  group.items.length,
                );
                const overlayTitle =
                  isSingleImageGroup(group) && item.kind === "image"
                    ? group.title
                    : undefined;
                return (
                  <RecapMediaTile
                    displayUri={displayThumbnailUriForItem(
                      item,
                      cachedThumbnailUris,
                    )}
                    item={item}
                    key={item.id}
                    overlayTitle={overlayTitle}
                    onPress={
                      item.kind === "image" || item.kind === "video"
                        ? () => openViewer(item)
                        : undefined
                    }
                    size={spanFull ? gridWidth : tileSize}
                    spanFull={spanFull}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </View>
      <RecapMediaViewer
        initialItemId={viewerItemId}
        items={visualItems}
        onClose={() => setViewerItemId(null)}
        visible={Boolean(viewerItemId)}
      />
    </ScrollView>
  );
}

function RecapContributorSummary({
  recap,
  resolveAuthor,
}: {
  recap: MemoryRecap;
  resolveAuthor: ResolveRecapAuthor;
}) {
  const contributors = useMemo(
    () => contributorEntriesFromRecap(recap, resolveAuthor),
    [recap, resolveAuthor],
  );
  const maxPostCount = contributors[0]?.postCount ?? 0;

  if (contributors.length === 0 || maxPostCount <= 0) {
    return null;
  }

  return (
    <View style={styles.contributorPanel}>
      <View style={styles.contributorHeader}>
        <Trophy color={palette.gold} size={18} />
        <Text style={styles.contributorTitle}>Posts this period</Text>
      </View>
      <View style={styles.contributorRows}>
        {contributors.map((contributor, index) => {
          const fillWidth = `${Math.max(
            8,
            Math.round((contributor.postCount / maxPostCount) * 100),
          )}%` as DimensionValue;
          return (
            <View key={contributor.authorId} style={styles.contributorRow}>
              <Text style={styles.contributorRank}>{index + 1}</Text>
              <View style={styles.contributorInfo}>
                <View style={styles.contributorNameRow}>
                  <Text numberOfLines={1} style={styles.contributorName}>
                    {contributor.displayName}
                  </Text>
                  <Text style={styles.contributorCount}>
                    {contributor.postCount} post
                    {contributor.postCount === 1 ? "" : "s"}
                  </Text>
                </View>
                <View style={styles.contributorTrack}>
                  <View
                    style={[styles.contributorFill, { width: fillWidth }]}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RecapMediaTile({
  displayUri,
  item,
  onPress,
  overlayTitle,
  size,
  spanFull,
}: {
  displayUri?: string;
  item: RecapMediaItem;
  onPress?: () => void;
  overlayTitle?: string;
  size: number;
  spanFull: boolean;
}) {
  const note = itemTextPreview(item);
  const canOpen = Boolean(onPress);
  const height = spanFull ? Math.min(340, Math.round(size * 0.72)) : size;
  const accessibilityLabel = overlayTitle
    ? `${overlayTitle}. ${note ?? `${item.kind} memory`}`
    : (note ?? `${item.kind} memory`);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={canOpen ? "button" : undefined}
      disabled={!canOpen}
      onPress={onPress}
      style={({ pressed }) => [
        styles.mediaTile,
        { height, width: size },
        pressed && canOpen ? styles.mediaTilePressed : null,
      ]}
    >
      {displayUri ? (
        <Image
          source={imageSource(displayUri)}
          style={styles.mediaTileImage as ImageStyle}
        />
      ) : (
        <View style={styles.mediaTileFallback}>
          <MediaKindIcon item={item} />
        </View>
      )}
      {overlayTitle ? (
        <>
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.58)"]}
            pointerEvents="none"
            style={styles.mediaTileTitleScrim}
          />
          <View style={styles.mediaTileTitleOverlay}>
            <Text style={styles.mediaTileTitleText}>{overlayTitle}</Text>
          </View>
        </>
      ) : null}
      {item.kind === "video" ? (
        <View style={styles.mediaTilePlayBadge}>
          <Play color="#fff" fill="#fff" size={22} />
        </View>
      ) : null}
    </Pressable>
  );
}

function RecapMediaViewer({
  initialItemId,
  items,
  onClose,
  visible,
}: {
  initialItemId: string | null;
  items: RecapMediaItem[];
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const cacheRequests = useMemo(
    () =>
      items
        .filter((item) => item.kind === "image")
        .flatMap((item) => [
          cacheRequestForItem(item, "original"),
          cacheRequestForItem(item, "thumbnail"),
        ])
        .filter((request): request is ImageCacheRequest => Boolean(request)),
    [items],
  );
  const cachedUris = useImageUriCache(cacheRequests);
  const topOffset = Math.max(insets.top, 22);
  const initialIndex = useMemo(() => {
    const nextIndex = items.findIndex((item) => item.id === initialItemId);
    return nextIndex >= 0 ? nextIndex : 0;
  }, [initialItemId, items]);

  useEffect(() => {
    if (!visible || items.length === 0) {
      return;
    }

    setIndex(initialIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: false,
        y: initialIndex * height,
      });
    });
  }, [height, initialIndex, items.length, visible]);

  const indexFromOffset = useCallback(
    (offset: number) =>
      Math.max(0, Math.min(items.length - 1, Math.round(offset / height))),
    [height, items.length],
  );

  const handleScrollSettled = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = indexFromOffset(nativeEvent.contentOffset.y);
      setIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [indexFromOffset],
  );

  if (items.length === 0) {
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
      <View style={styles.viewer}>
        <Pressable
          accessibilityLabel="Close media preview"
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.viewerClose, { top: topOffset }]}
        >
          <X color="#fff" size={23} />
        </Pressable>

        <Text style={[styles.viewerCounter, { top: topOffset + 12 }]}>
          {index + 1} / {items.length}
        </Text>

        <ScrollView
          onMomentumScrollEnd={handleScrollSettled}
          onScrollEndDrag={handleScrollSettled}
          pagingEnabled
          ref={scrollRef}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          {items.map((item, itemIndex) => (
            <RecapMediaViewerSlide
              active={itemIndex === index && visible}
              cachedImageUri={
                item.kind === "image"
                  ? displayUriForItem(item, cachedUris, "original")
                  : undefined
              }
              height={height}
              item={item}
              key={item.id}
              safeBottom={insets.bottom}
              width={width}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function RecapMediaViewerSlide({
  active,
  cachedImageUri,
  height,
  item,
  safeBottom,
  width,
}: {
  active: boolean;
  cachedImageUri?: string;
  height: number;
  item: RecapMediaItem;
  safeBottom: number;
  width: number;
}) {
  const note = itemTextPreview(item);

  return (
    <View style={[styles.viewerSlide, { height, width }]}>
      {item.kind === "video" ? (
        <RecapVideoViewer active={active} item={item} />
      ) : cachedImageUri ? (
        <Image
          resizeMode="contain"
          source={imageSource(cachedImageUri)}
          style={styles.viewerImage as ImageStyle}
        />
      ) : (
        <View style={styles.viewerFallback}>
          <ImageIcon color="rgba(255,255,255,0.72)" size={34} />
        </View>
      )}
      {note ? (
        <View
          style={[styles.viewerCaption, { paddingBottom: safeBottom + 18 }]}
        >
          <Text numberOfLines={4} style={styles.viewerCaptionText}>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RecapVideoViewer({
  active,
  item,
}: {
  active: boolean;
  item: RecapMediaItem;
}) {
  const [videoSource, setVideoSource] =
    useState<Parameters<typeof useVideoPlayer>[0]>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const player = useVideoPlayer(videoSource, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.timeUpdateEventInterval = 0.25;
  });
  const [playerStatus, setPlayerStatus] = useState(player.status);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const loggedErrorRef = useRef<string | null>(null);

  useEventListener(player, "statusChange", (event) => {
    setPlayerStatus(event.status);

    if (event.status === "error") {
      setPlaybackError(
        event.error?.message ?? "The video file could not be loaded.",
      );
      return;
    }

    setPlaybackError(null);
  });

  useEffect(() => {
    setPlayerStatus(player.status);
  }, [player]);

  useEffect(() => {
    let cancelled = false;
    setVideoSource(null);
    setPrepareError(null);

    if (!active) {
      player.pause();
      return;
    }

    if (!item.cacheMedia) {
      setPrepareError("This video does not have a playable file.");
      player.pause();
      return;
    }

    resolvePlayableVideoSource(item.cacheMedia)
      .then((source) => {
        if (!cancelled) {
          setVideoSource(source);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Could not load video.";
          setPrepareError(message);
          console.warn("[MaySync] recap video prepare failed", {
            error: message,
            mediaId: item.cacheMedia?.id,
            uriScheme: item.cacheMedia?.uri
              ? (uriScheme(item.cacheMedia.uri) ?? "unknown")
              : "none",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [active, item.cacheMedia, player]);

  useEffect(() => {
    if (!active || !videoSource || prepareError) {
      player.pause();
      return;
    }

    player.currentTime = 0;
    player.play();

    return () => {
      player.pause();
    };
  }, [active, player, prepareError, videoSource]);

  useEffect(() => {
    loggedErrorRef.current = null;
    setPlaybackError(null);
    setPlayerStatus("idle");
  }, [item.id, item.uri]);

  useEffect(() => {
    if (
      !item.cacheMedia ||
      !playbackError ||
      loggedErrorRef.current === playbackError
    ) {
      return;
    }

    loggedErrorRef.current = playbackError;
    console.warn("[MaySync] recap video playback failed", {
      error: playbackError,
      mediaId: item.cacheMedia.id,
      uriScheme: uriScheme(item.cacheMedia.uri) ?? "unknown",
    });
  }, [item.cacheMedia, playbackError]);

  const showLoading =
    active &&
    !prepareError &&
    !playbackError &&
    (!videoSource || playerStatus === "idle" || playerStatus === "loading");

  return (
    <View style={styles.viewerVideo}>
      <VideoView
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        player={player}
        style={styles.viewerVideoPlayer}
      />
      {showLoading ? (
        <View pointerEvents="none" style={styles.viewerLoadingOverlay}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}
      {prepareError || playbackError ? (
        <View pointerEvents="none" style={styles.viewerErrorOverlay}>
          <Text style={styles.viewerErrorTitle}>Could not play video</Text>
          <Text style={styles.viewerErrorMessage}>
            {prepareError ?? playbackError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function MediaKindIcon({
  compact,
  item,
}: {
  compact?: boolean;
  item: RecapMediaItem;
}) {
  const size = compact ? 13 : 30;
  const color = compact ? "#fff" : palette.berry;

  if (item.kind === "audio") {
    return <Mic color={color} size={size} />;
  }
  if (item.kind === "video") {
    return <Film color={color} size={size} />;
  }
  if (item.kind === "note") {
    return <Sparkles color={color} size={size} />;
  }
  return <ImageIcon color={color} size={size} />;
}

const mediaGroupsFromRecap = (recap: MemoryRecap): RecapMediaGroup[] => {
  const sourcesById = new Map(
    recap.sources.map((source) => [source.id, source]),
  );
  const usedSourceIds = new Set<string>();
  const groups = recap.sections
    .map((section, sectionIndex): RecapMediaGroup | null => {
      const sources = section.memoryIds
        .map((memoryId) => sourcesById.get(memoryId))
        .filter((source): source is MemoryRecapSource => Boolean(source));
      const items = sources.flatMap((source) => {
        usedSourceIds.add(source.id);
        return mediaItemsFromSource(recap.familyId, source);
      });

      if (items.length === 0) {
        return null;
      }

      return {
        dateLabel: dateLabelForSources(sources),
        id: section.id || `group_${sectionIndex + 1}`,
        title: section.title || fallbackMediaGroupTitle(sources, items),
        items,
      };
    })
    .filter((group): group is RecapMediaGroup => Boolean(group));
  const remainingSources = recap.sources.filter(
    (source) => !usedSourceIds.has(source.id),
  );
  const remainingItems = remainingSources.flatMap((source) =>
    mediaItemsFromSource(recap.familyId, source),
  );

  if (remainingItems.length > 0) {
    groups.push({
      dateLabel: dateLabelForSources(remainingSources),
      id: "more",
      title: "More moments",
      items: remainingItems,
    });
  }

  if (groups.length > 0) {
    return groups;
  }

  const allItems = recap.sources.flatMap((source) =>
    mediaItemsFromSource(recap.familyId, source),
  );
  return allItems.length > 0
    ? [
        {
          dateLabel: dateLabelForSources(recap.sources),
          id: "all",
          title: "Moments",
          items: allItems,
        },
      ]
    : [];
};

const mediaItemsFromSource = (
  familyId: string,
  source: MemoryRecapSource,
): RecapMediaItem[] => {
  const mediaItems = source.media.map(
    (media): RecapMediaItem => ({
      id: `${source.id}_${media.id}`,
      sourceId: source.id,
      kind: media.kind,
      uri: recapMediaUri(familyId, source, media),
      thumbnailUri: media.thumbnailUri,
      createdAt: source.createdAt,
      bodyPreview: source.bodyPreview,
      transcriptPreview: source.transcriptPreview,
      cacheMedia: recapMediaCacheItem(familyId, source, media).cacheMedia,
    }),
  );

  if (mediaItems.length > 0) {
    return mediaItems;
  }

  if (source.bodyPreview || source.transcriptPreview) {
    return [
      {
        id: `${source.id}_note`,
        sourceId: source.id,
        kind: "note",
        createdAt: source.createdAt,
        bodyPreview: source.bodyPreview,
        transcriptPreview: source.transcriptPreview,
      },
    ];
  }

  return [];
};

const recapMediaCacheItem = (
  familyId: string,
  source: MemoryRecapSource,
  media: MemoryRecapSource["media"][number],
): RecapMediaItem => {
  const uri = recapMediaUri(familyId, source, media) ?? media.thumbnailUri;
  const cacheMedia: MemoryMedia | undefined = uri
    ? {
        durationMs: media.durationMs,
        id: media.id,
        kind: media.kind,
        thumbnailUri: media.thumbnailUri,
        uri,
      }
    : undefined;

  return {
    cacheMedia,
    createdAt: source.createdAt,
    id: `${source.id}_${media.id}`,
    kind: media.kind,
    sourceId: source.id,
    thumbnailUri: media.thumbnailUri,
    uri,
  };
};

const recapMediaUri = (
  familyId: string,
  source: MemoryRecapSource,
  media: MemoryRecapSource["media"][number],
) => {
  if (!media.uri) {
    return undefined;
  }

  if (isOriginalMediaStreamUrl(media.uri)) {
    return media.uri;
  }

  if (
    (media.kind === "image" || media.kind === "video") &&
    isGoogleDriveUri(media.uri)
  ) {
    return (
      originalMediaStreamUrl({
        familyId,
        mediaId: media.id,
        postId: source.id,
      }) ?? media.uri
    );
  }

  return media.uri;
};

const isGoogleDriveUri = (uri: string) =>
  uri.includes("drive.google.com") || uri.includes("googleapis.com/drive/");

const cacheRequestForItem = (
  item: RecapMediaItem,
  variant: "original" | "thumbnail",
): ImageCacheRequest | null => {
  const uri =
    variant === "original" ? item.uri : (item.thumbnailUri ?? item.uri);

  if (!uri || !item.cacheMedia) {
    return null;
  }

  return {
    media: item.cacheMedia,
    uri,
    variant,
  };
};

const displayUriForItem = (
  item: RecapMediaItem | undefined | null,
  cachedUris: Record<string, string>,
  preferred: "original" | "thumbnail" = "thumbnail",
) => {
  if (!item) {
    return undefined;
  }

  const primary =
    preferred === "original"
      ? (item.uri ?? item.thumbnailUri)
      : (item.thumbnailUri ?? item.uri);
  const fallback =
    preferred === "original"
      ? (item.thumbnailUri ?? item.uri)
      : (item.uri ?? item.thumbnailUri);

  if (primary) {
    return cachedUris[primary] ?? primary;
  }
  if (fallback) {
    return cachedUris[fallback] ?? fallback;
  }
  return undefined;
};

const displayThumbnailUriForItem = (
  item: RecapMediaItem,
  cachedUris: Record<string, string>,
) => {
  if (item.kind === "image") {
    return displayUriForItem(item, cachedUris, "thumbnail");
  }

  return item.thumbnailUri
    ? (cachedUris[item.thumbnailUri] ?? item.thumbnailUri)
    : undefined;
};

const fallbackMediaGroupTitle = (
  sources: MemoryRecapSource[],
  items: RecapMediaItem[],
) => {
  const dates = Array.from(
    new Set(sources.map((source) => formatShortDate(source.createdAt))),
  );
  if (dates.length === 1) {
    return dates[0];
  }
  if (items.every((item) => item.kind === "image")) {
    return "Photo moments";
  }
  return "Everyday moments";
};

const dateLabelForSources = (sources: MemoryRecapSource[]) => {
  const timestamps = sources
    .map((source) => new Date(source.createdAt).getTime())
    .filter((timestamp) => Number.isFinite(timestamp));

  if (timestamps.length === 0) {
    return undefined;
  }

  const start = new Date(Math.min(...timestamps)).toISOString();
  const end = new Date(Math.max(...timestamps)).toISOString();
  const startLabel = formatShortDate(start);
  const endLabel = formatShortDate(end);

  return startLabel === endLabel ? startLabel : `${startLabel}-${endLabel}`;
};

const itemTextPreview = (item: RecapMediaItem) =>
  item.bodyPreview?.trim() || item.transcriptPreview?.trim() || undefined;

const groupCaptionFromItems = (items: RecapMediaItem[]) =>
  items.map(itemTextPreview).find(Boolean);

const firstMemoryTextPreview = (items: RecapMediaItem[]) =>
  groupCaptionFromItems(items);

const shouldFeatureRecapItem = (index: number, itemCount: number) => {
  if (itemCount === 1) {
    return true;
  }
  if (itemCount < 3) {
    return false;
  }
  return index === 0 || (index > 0 && index % 6 === 0);
};

const isSingleImageGroup = (group: RecapMediaGroup) =>
  group.items.length === 1 && group.items[0]?.kind === "image";

const parentSafeSummary = (value?: string) => {
  const text = value?.trim();
  if (!text || /\b(you|your|yours)\b/i.test(text)) {
    return undefined;
  }
  return text;
};

const contributorEntriesFromRecap = (
  recap: MemoryRecap,
  resolveAuthor: ResolveRecapAuthor,
) => {
  const counts =
    recap.contributorSummaries && recap.contributorSummaries.length > 0
      ? recap.contributorSummaries
      : Array.from(
          recap.sources.reduce((byAuthor, source) => {
            if (source.authorId) {
              byAuthor.set(
                source.authorId,
                (byAuthor.get(source.authorId) ?? 0) + 1,
              );
            }
            return byAuthor;
          }, new Map<string, number>()),
          ([authorId, postCount]) => ({ authorId, postCount }),
        );

  return counts
    .filter((entry) => entry.authorId && entry.postCount > 0)
    .map((entry) => ({
      ...entry,
      displayName: resolveAuthor(entry.authorId).displayName,
    }))
    .sort(
      (first, second) =>
        second.postCount - first.postCount ||
        first.displayName.localeCompare(second.displayName),
    );
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfWeek = (date: Date) => {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return startOfDay(addDays(date, mondayOffset));
};

const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const startOfYear = (date: Date) => new Date(date.getFullYear(), 0, 1);

const currentPeriodOptions = (): RecapPeriodOption[] => {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const yearStart = startOfYear(now);

  return [
    {
      key: "week",
      label: "This week",
      periodKind: "week",
      periodStart: weekStart.toISOString(),
      periodEnd: addDays(weekStart, 7).toISOString(),
    },
    {
      key: "month",
      label: "This month",
      periodKind: "month",
      periodStart: monthStart.toISOString(),
      periodEnd: new Date(
        monthStart.getFullYear(),
        monthStart.getMonth() + 1,
        1,
      ).toISOString(),
    },
    {
      key: "year",
      label: "This year",
      periodKind: "year",
      periodStart: yearStart.toISOString(),
      periodEnd: new Date(yearStart.getFullYear() + 1, 0, 1).toISOString(),
    },
  ];
};

const formatDate = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, options).format(new Date(value));

const formatShortDate = (value: string) =>
  formatDate(value, { month: "short", day: "numeric" });

const formatPeriodLabel = (recap: MemoryRecap) => {
  if (recap.periodKind === "year") {
    return formatDate(recap.periodStart, { year: "numeric" });
  }
  if (recap.periodKind === "month") {
    return formatDate(recap.periodStart, { month: "long", year: "numeric" });
  }
  return `${formatShortDate(recap.periodStart)}-${formatShortDate(
    addDays(new Date(recap.periodEnd), -1).toISOString(),
  )}`;
};

const recapTitle = (recap: MemoryRecap) => {
  switch (recap.periodKind) {
    case "week":
      return "A week in pictures";
    case "month":
      return "A month in pictures";
    case "year":
      return "A year in pictures";
  }
};

const recapStatus = (recap: MemoryRecap) => {
  switch (recap.status) {
    case "queued":
      return { icon: "loading" as const, label: "Queued" };
    case "processing":
      return { icon: "loading" as const, label: "In progress" };
    case "failed":
      return { icon: "failed" as const, label: "Needs retry" };
    case "ready":
      return { icon: "ready" as const, label: "Ready" };
  }
};

const styles = StyleSheet.create({
  panel: {
    gap: 18,
    paddingBottom: 128,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  header: {
    gap: 5,
    paddingHorizontal: 2,
  },
  kicker: {
    color: palette.berry,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: palette.ink,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0,
  },
  periodGrid: {
    flexDirection: "row",
    gap: 8,
  },
  periodButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.58)",
    borderColor: palette.rim,
    borderRadius: radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 8,
    ...shadow.soft,
  },
  periodButtonActive: {
    backgroundColor: palette.ink,
    borderColor: "rgba(37,45,43,0.14)",
  },
  periodButtonText: {
    color: palette.ink,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
  },
  periodButtonTextActive: {
    color: palette.porcelain,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  errorText: {
    color: palette.berry,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  recapList: {
    gap: 12,
  },
  emptyCard: {
    alignItems: "center",
    gap: 12,
    padding: 28,
  },
  emptyIcon: {
    alignItems: "center",
    backgroundColor: "rgba(183,133,45,0.12)",
    borderRadius: radius.pill,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  emptyTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 0,
  },
  recapRow: {
    overflow: "hidden",
    padding: 0,
  },
  recapRowPressable: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    minHeight: 112,
    padding: 14,
  },
  recapThumbStack: {
    height: 78,
    width: 94,
  },
  recapThumb: {
    backgroundColor: palette.surface,
    borderColor: "rgba(255,255,255,0.86)",
    borderRadius: radius.medium,
    borderWidth: 2,
    height: 64,
    position: "absolute",
    width: 64,
  },
  recapThumbFallback: {
    alignItems: "center",
    backgroundColor: "rgba(183,133,45,0.13)",
    borderRadius: radius.medium,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  recapRowText: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  recapTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0,
    lineHeight: 22,
  },
  recapMeta: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
  },
  recapError: {
    color: palette.berry,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  recapStatusIcon: {
    alignItems: "center",
    minWidth: 28,
  },
  retryButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  detailContent: {
    gap: 18,
    paddingBottom: 128,
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  detailTopBar: {
    alignItems: "flex-end",
    paddingHorizontal: 18,
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.58)",
    borderColor: palette.rim,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  mediaHero: {
    backgroundColor: palette.surface,
    borderRadius: radius.large,
    height: 360,
    marginHorizontal: 16,
    overflow: "hidden",
    ...shadow.lifted,
  },
  mediaHeroImage: {
    height: "100%",
    width: "100%",
  },
  mediaHeroFallback: {
    alignItems: "center",
    backgroundColor: "rgba(183,133,45,0.11)",
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  mediaHeroScrim: {
    backgroundColor: "rgba(0,0,0,0.28)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  mediaHeroText: {
    bottom: 0,
    gap: 8,
    left: 0,
    padding: 20,
    position: "absolute",
    right: 0,
  },
  mediaHeroKicker: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  mediaHeroTitle: {
    color: "#fff",
    fontSize: 35,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 38,
  },
  mediaHeroSummary: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 21,
  },
  mediaHeroMeta: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  contributorPanel: {
    backgroundColor: "rgba(255,255,255,0.64)",
    borderColor: palette.rim,
    borderRadius: radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginHorizontal: 16,
    padding: 14,
  },
  contributorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  contributorTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0,
  },
  contributorRows: {
    gap: 10,
  },
  contributorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  contributorRank: {
    color: palette.berry,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    width: 20,
  },
  contributorInfo: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  contributorNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  contributorName: {
    color: palette.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0,
  },
  contributorCount: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
  },
  contributorTrack: {
    backgroundColor: "rgba(37,45,43,0.08)",
    borderRadius: radius.pill,
    height: 7,
    overflow: "hidden",
  },
  contributorFill: {
    backgroundColor: palette.gold,
    borderRadius: radius.pill,
    height: "100%",
  },
  mediaGroups: {
    gap: 24,
    paddingHorizontal: 16,
  },
  mediaGroup: {
    gap: 9,
  },
  mediaGroupHeader: {
    alignItems: "flex-start",
    gap: 3,
  },
  mediaGroupTitle: {
    color: palette.ink,
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: 0,
    lineHeight: 25,
  },
  mediaGroupDate: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  mediaTile: {
    backgroundColor: palette.surface,
    borderRadius: radius.medium,
    overflow: "hidden",
  },
  mediaTilePressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  mediaTileImage: {
    height: "100%",
    width: "100%",
  },
  mediaTileFallback: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  mediaTileTitleScrim: {
    bottom: 0,
    height: "64%",
    left: 0,
    position: "absolute",
    right: 0,
  },
  mediaTileTitleOverlay: {
    bottom: 0,
    left: 0,
    paddingBottom: 18,
    paddingHorizontal: 18,
    position: "absolute",
    right: 0,
  },
  mediaTileTitleText: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 33,
    textShadowColor: "rgba(0,0,0,0.18)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 5,
  },
  mediaTilePlayBadge: {
    alignItems: "center",
    backgroundColor: "rgba(31,28,24,0.64)",
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    left: "50%",
    position: "absolute",
    top: "50%",
    transform: [{ translateX: -29 }, { translateY: -29 }],
    width: 58,
  },
  viewer: {
    backgroundColor: "#000",
    flex: 1,
  },
  viewerClose: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderRadius: radius.pill,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 18,
    top: 58,
    width: 44,
    zIndex: 3,
  },
  viewerCounter: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    fontWeight: "800",
    left: 18,
    letterSpacing: 0,
    position: "absolute",
    zIndex: 3,
  },
  viewerSlide: {
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: {
    height: "100%",
    width: "100%",
  },
  viewerFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    width: "100%",
  },
  viewerCaption: {
    backgroundColor: "rgba(0,0,0,0.66)",
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    paddingTop: 14,
    position: "absolute",
    right: 0,
  },
  viewerCaptionText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0,
    lineHeight: 21,
    textAlign: "left",
  },
  viewerVideo: {
    flex: 1,
    justifyContent: "center",
    width: "100%",
  },
  viewerVideoPlayer: {
    flex: 1,
    width: "100%",
  },
  viewerLoadingOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  viewerErrorOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(16,18,24,0.86)",
    borderRadius: radius.medium,
    left: 24,
    paddingHorizontal: 18,
    paddingVertical: 16,
    position: "absolute",
    right: 24,
  },
  viewerErrorTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
  },
  viewerErrorMessage: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
