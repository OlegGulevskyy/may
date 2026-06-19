import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState as NativeAppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import {
  createId,
  createMemoryPost,
  type MemoryContentImageMap,
  type MemoryComment,
  type MemoryDeliveryStatus,
  type MemoryMedia,
  type MemoryPost,
  type MemoryRichTextDocument,
} from "@may/core";

import { buildSampleMemories } from "../data/demoMemories";
import {
  fetchRemoteMemoryWallPage,
  saveRemoteMemoryPost,
  subscribeToRemoteMemoryWall,
} from "../services/memoryBackend";
import { getLocalString, setLocalString } from "../services/storage";
import { wallStorageKey } from "../state/AppState";

const syncableStatuses = new Set<MemoryDeliveryStatus>([
  "local",
  "queued",
  "uploading",
  "failed",
]);
const autoSyncStatuses = new Set<MemoryDeliveryStatus>([
  "local",
  "queued",
  "uploading",
]);
const wallPostPageSize = 10;

type SendMemoryInput = {
  emailSubject?: string;
  body: string;
  content?: MemoryRichTextDocument;
  contentImageMap?: MemoryContentImageMap;
  media: MemoryMedia[];
};

type PostsUpdater = (current: MemoryPost[]) => MemoryPost[];

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const syncLog = (event: string, details?: Record<string, unknown>) => {
  console.info(`[MaySync] ${event}`, details ?? {});
};

const syncWarn = (event: string, details?: Record<string, unknown>) => {
  console.warn(`[MaySync] ${event}`, details ?? {});
};

const sortPostsByCreatedAt = (posts: MemoryPost[]) =>
  [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

const shouldKeepLocalOnlyPost = (
  post: MemoryPost,
  localPostIds = new Set<string>(),
) => syncableStatuses.has(post.status) || localPostIds.has(post.id);

const selectInitialPosts = (storedPosts: MemoryPost[]) => {
  const visiblePosts = sortPostsByCreatedAt(storedPosts).slice(
    0,
    wallPostPageSize,
  );
  const visiblePostIds = new Set(visiblePosts.map((post) => post.id));
  const localOnlyPosts = storedPosts.filter(
    (post) => !visiblePostIds.has(post.id) && shouldKeepLocalOnlyPost(post),
  );

  return sortPostsByCreatedAt([...visiblePosts, ...localOnlyPosts]);
};

const mergeRemotePosts = (
  localPosts: MemoryPost[],
  remotePosts: MemoryPost[],
  localPostIds: Set<string>,
) => {
  const localPostsById = new Map(localPosts.map((post) => [post.id, post]));
  const remotePostIds = new Set(remotePosts.map((post) => post.id));
  const mergedRemotePosts = remotePosts.map((post) => {
    const currentPost = localPostsById.get(post.id);

    return currentPost &&
      currentPost.updatedAt === post.updatedAt &&
      currentPost.status === post.status
      ? currentPost
      : post;
  });
  const localOnlyPosts = localPosts.filter(
    (post) =>
      !remotePostIds.has(post.id) &&
      shouldKeepLocalOnlyPost(post, localPostIds),
  );

  return sortPostsByCreatedAt([...mergedRemotePosts, ...localOnlyPosts]);
};

const toRemotePost = (post: MemoryPost): MemoryPost => ({
  ...post,
  errorMessage: undefined,
  status: syncableStatuses.has(post.status) ? "synced" : post.status,
  updatedAt: new Date().toISOString(),
});

const hasUploadableLocalMedia = (post: MemoryPost) =>
  post.media.some((media) => media.uri.startsWith("file://"));

const shouldAutoSyncPost = ({
  isRemotePost,
  isSyncing,
  post,
}: {
  isRemotePost: boolean;
  isSyncing: boolean;
  post: MemoryPost;
}) =>
  !isSyncing &&
  autoSyncStatuses.has(post.status) &&
  (!isRemotePost || hasUploadableLocalMedia(post));

/**
 * Family-scoped memory wall. Posts persist locally per family as a cache/outbox
 * and sync to Firestore when the device is online. A new family starts empty —
 * sample content is only added on explicit request via {@link seedSampleMemories}.
 */
export const useMemoryWall = (familyId: string, activeMemberId: string) => {
  const storageKey = wallStorageKey(familyId);
  const [posts, setPosts] = useState<MemoryPost[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [forcedOffline, setForcedOffline] = useState(false);
  const [remoteSyncEnabled, setRemoteSyncEnabled] = useState(false);
  const [remotePostLimit, setRemotePostLimit] = useState(wallPostPageSize);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [isLoadingMorePosts, setIsLoadingMorePosts] = useState(false);
  const [isRefreshingPosts, setIsRefreshingPosts] = useState(false);
  const [loadedRemotePostCount, setLoadedRemotePostCount] = useState(0);
  const [totalRemotePostCount, setTotalRemotePostCount] = useState<
    number | undefined
  >(undefined);
  const pendingRemotePosts = useRef(new Map<string, MemoryPost>());
  const didInitialRemoteRefreshRef = useRef(false);
  const localPostIds = useRef(new Set<string>());
  const postsRef = useRef<MemoryPost[]>([]);
  const refreshingPostsRef = useRef(false);
  const remotePostIds = useRef(new Set<string>());
  const remotePostsRef = useRef<MemoryPost[]>([]);
  const remoteSubscriptionKeyRef = useRef<string | null>(null);
  const syncingPostIds = useRef(new Set<string>());

  const isOnline = networkOnline && !forcedOffline;

  const updatePosts = useCallback((updater: PostsUpdater) => {
    setPosts((current) => {
      const next = updater(current);
      postsRef.current = next;
      return next;
    });
  }, []);

  const applyRemotePosts = useCallback(
    ({
      hasMore,
      posts: remotePosts,
      totalPostCount,
    }: {
      hasMore: boolean;
      posts: MemoryPost[];
      totalPostCount?: number;
    }) => {
      const nextRemotePostIds = new Set(remotePosts.map((post) => post.id));
      nextRemotePostIds.forEach((postId) =>
        localPostIds.current.delete(postId),
      );
      remotePostIds.current = nextRemotePostIds;
      remotePostsRef.current = remotePosts;
      setHasMorePosts(hasMore);
      setIsLoadingMorePosts(false);
      setLoadedRemotePostCount(remotePosts.length);
      setTotalRemotePostCount(totalPostCount);
      setRemoteSyncEnabled(true);
      updatePosts((current) =>
        mergeRemotePosts(current, remotePosts, localPostIds.current),
      );
    },
    [updatePosts],
  );

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);

    try {
      const stored = getLocalString(storageKey);
      if (!cancelled) {
        const parsedPosts = stored ? JSON.parse(stored) : [];
        const storedPosts = Array.isArray(parsedPosts)
          ? (parsedPosts as MemoryPost[])
          : [];
        const nextPosts = selectInitialPosts(storedPosts);
        postsRef.current = nextPosts;
        setPosts(nextPosts);
        setHydrated(true);
      }
    } catch {
      if (!cancelled) {
        postsRef.current = [];
        setPosts([]);
        setHydrated(true);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetworkOnline(
        Boolean(state.isConnected) && state.isInternetReachable !== false,
      );
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    setLocalString(storageKey, JSON.stringify(posts));
  }, [hydrated, posts, storageKey]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const subscriptionKey =
      familyId && activeMemberId ? `${familyId}:${activeMemberId}` : "";

    if (remoteSubscriptionKeyRef.current !== subscriptionKey) {
      remoteSubscriptionKeyRef.current = subscriptionKey;
      didInitialRemoteRefreshRef.current = false;
      remotePostIds.current = new Set();
      remotePostsRef.current = [];
      pendingRemotePosts.current.clear();
      localPostIds.current.clear();
      syncingPostIds.current.clear();
      setRemoteSyncEnabled(false);
      setHasMorePosts(false);
      setIsLoadingMorePosts(false);
      setLoadedRemotePostCount(0);
      setTotalRemotePostCount(undefined);

      if (remotePostLimit !== wallPostPageSize) {
        setRemotePostLimit(wallPostPageSize);
        return;
      }
    }

    if (!familyId || !activeMemberId) {
      return;
    }

    try {
      unsubscribe = subscribeToRemoteMemoryWall({
        familyId,
        onError: () => {
          if (!cancelled) {
            setRemoteSyncEnabled(false);
            setIsLoadingMorePosts(false);
          }
        },
        onPosts: (page) => {
          if (cancelled) {
            return;
          }
          applyRemotePosts(page);
        },
        postLimit: remotePostLimit,
      });
    } catch {
      setRemoteSyncEnabled(false);
      setIsLoadingMorePosts(false);
      return;
    }

    if (!unsubscribe) {
      setRemoteSyncEnabled(false);
      setIsLoadingMorePosts(false);
      setLoadedRemotePostCount(0);
      setTotalRemotePostCount(undefined);
      return;
    }

    setRemoteSyncEnabled(true);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [activeMemberId, applyRemotePosts, familyId, hydrated, remotePostLimit]);

  const refreshPosts = useCallback(async () => {
    if (
      !hydrated ||
      !familyId ||
      !activeMemberId ||
      refreshingPostsRef.current
    ) {
      return;
    }

    refreshingPostsRef.current = true;
    setIsRefreshingPosts(true);

    try {
      const page = await fetchRemoteMemoryWallPage({
        familyId,
        postLimit: remotePostLimit,
      });

      if (!page) {
        setRemoteSyncEnabled(false);
        return;
      }

      applyRemotePosts(page);
    } catch (error) {
      syncWarn("remote wall refresh failed", {
        familyId,
        message: getErrorMessage(error),
      });
    } finally {
      refreshingPostsRef.current = false;
      setIsRefreshingPosts(false);
    }
  }, [activeMemberId, applyRemotePosts, familyId, hydrated, remotePostLimit]);

  useEffect(() => {
    if (!hydrated || !familyId || !activeMemberId) {
      return;
    }

    if (!didInitialRemoteRefreshRef.current) {
      didInitialRemoteRefreshRef.current = true;
      refreshPosts();
    }

    const subscription = NativeAppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshPosts();
      }
    });

    return () => subscription.remove();
  }, [activeMemberId, familyId, hydrated, refreshPosts]);

  const markPostSynced = useCallback(
    (savedPost: MemoryPost) => {
      updatePosts((current) =>
        current.map((post) =>
          post.id === savedPost.id
            ? {
                ...post,
                content: savedPost.content,
                contentImageMap: savedPost.contentImageMap,
                errorMessage: undefined,
                media: savedPost.media,
                status: syncableStatuses.has(post.status)
                  ? savedPost.status
                  : post.status,
                updatedAt: savedPost.updatedAt,
              }
            : post,
        ),
      );
    },
    [updatePosts],
  );

  const markPostFailed = useCallback(
    (postId: string, error: unknown) => {
      syncWarn("post sync failed", {
        message: getErrorMessage(error),
        postId,
      });
      updatePosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                errorMessage: getErrorMessage(error),
                status: "failed",
                updatedAt: new Date().toISOString(),
              }
            : post,
        ),
      );
    },
    [updatePosts],
  );

  const persistPost = useCallback(
    (post: MemoryPost) => {
      if (!remoteSyncEnabled || !isOnline) {
        syncLog("post sync deferred", {
          isOnline,
          postId: post.id,
          remoteSyncEnabled,
          status: post.status,
        });
        return;
      }

      if (syncingPostIds.current.has(post.id)) {
        syncLog("post sync already running", {
          postId: post.id,
          status: post.status,
        });
        pendingRemotePosts.current.set(post.id, post);
        return;
      }

      syncingPostIds.current.add(post.id);
      const remotePost = toRemotePost(post);
      const hasLocalMedia = hasUploadableLocalMedia(post);

      syncLog("post sync starting", {
        hasLocalMedia,
        mediaCount: post.media.length,
        postId: post.id,
        status: post.status,
      });

      if (hasLocalMedia) {
        updatePosts((current) =>
          current.map((item) =>
            item.id === post.id && syncableStatuses.has(item.status)
              ? {
                  ...item,
                  status: "uploading",
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
      }

      saveRemoteMemoryPost(remotePost)
        .then((savedPost) => {
          syncLog("post sync finished", {
            mediaCount: savedPost.media.length,
            postId: post.id,
            status: savedPost.status,
          });
          remotePostIds.current.add(post.id);
          markPostSynced(savedPost);
        })
        .catch((error) => markPostFailed(post.id, error))
        .finally(() => {
          syncingPostIds.current.delete(post.id);
          const pendingPost = pendingRemotePosts.current.get(post.id);

          if (pendingPost) {
            syncLog("post sync flushing pending update", {
              postId: post.id,
              status: pendingPost.status,
            });
            pendingRemotePosts.current.delete(post.id);
            persistPost(pendingPost);
          }
        });
    },
    [isOnline, markPostFailed, markPostSynced, remoteSyncEnabled, updatePosts],
  );

  useEffect(() => {
    if (!hydrated || !isOnline || !remoteSyncEnabled) {
      return;
    }

    posts
      .filter((post) => {
        const isRemotePost = remotePostIds.current.has(post.id);
        const isSyncing = syncingPostIds.current.has(post.id);
        return shouldAutoSyncPost({ isRemotePost, isSyncing, post });
      })
      .forEach(persistPost);
  }, [hydrated, isOnline, persistPost, posts, remoteSyncEnabled]);

  const replacePost = useCallback(
    (nextPost: MemoryPost) => {
      updatePosts((current) =>
        current.map((post) => (post.id === nextPost.id ? nextPost : post)),
      );
    },
    [updatePosts],
  );

  const shouldPersistPost = useCallback(
    (post: MemoryPost) =>
      syncableStatuses.has(post.status) ||
      remotePostIds.current.has(post.id) ||
      localPostIds.current.has(post.id),
    [],
  );

  const sendMemory = useCallback(
    ({
      emailSubject,
      body,
      content,
      contentImageMap,
      media,
    }: SendMemoryInput) => {
      const post = {
        ...createMemoryPost({
          familyId,
          authorId: activeMemberId,
          emailSubject,
          body,
          content,
          contentImageMap,
          media,
        }),
        status: "queued" as const,
      };

      localPostIds.current.add(post.id);
      updatePosts((current) => [post, ...current]);
      persistPost(post);
    },
    [activeMemberId, familyId, persistPost, updatePosts],
  );

  const addComment = useCallback(
    (postId: string, body: string) => {
      const post = postsRef.current.find((current) => current.id === postId);
      if (!post) {
        return;
      }

      const comment: MemoryComment = {
        id: createId("comment"),
        authorId: activeMemberId,
        body,
        createdAt: new Date().toISOString(),
      };
      const nextPost = {
        ...post,
        comments: [...post.comments, comment],
        updatedAt: new Date().toISOString(),
      };

      replacePost(nextPost);
      if (shouldPersistPost(post)) {
        persistPost(nextPost);
      }
    },
    [activeMemberId, persistPost, replacePost, shouldPersistPost],
  );

  const toggleReaction = useCallback(
    (postId: string, reaction: string) => {
      const post = postsRef.current.find((current) => current.id === postId);
      if (!post) {
        return;
      }

      const current = post.reactions[reaction] ?? [];
      const nextReaction = current.includes(activeMemberId)
        ? current.filter((memberId) => memberId !== activeMemberId)
        : [...current, activeMemberId];
      const nextPost = {
        ...post,
        reactions: {
          ...post.reactions,
          [reaction]: nextReaction,
        },
        updatedAt: new Date().toISOString(),
      };

      replacePost(nextPost);
      if (shouldPersistPost(post)) {
        persistPost(nextPost);
      }
    },
    [activeMemberId, persistPost, replacePost, shouldPersistPost],
  );

  const retryPost = useCallback(
    (postId: string) => {
      const post = postsRef.current.find((current) => current.id === postId);
      if (!post) {
        return;
      }

      syncingPostIds.current.delete(postId);
      pendingRemotePosts.current.delete(postId);
      const nextPost = {
        ...post,
        status: "queued",
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      } satisfies MemoryPost;

      syncLog("post retry requested", {
        isOnline,
        mediaCount: post.media.length,
        postId,
        remoteSyncEnabled,
        status: post.status,
      });
      replacePost(nextPost);
      persistPost(nextPost);
    },
    [isOnline, persistPost, remoteSyncEnabled, replacePost],
  );

  const seedSampleMemories = useCallback(
    (partnerId?: string) => {
      updatePosts((current) =>
        current.length > 0
          ? current
          : buildSampleMemories({
              familyId,
              authorId: activeMemberId,
              partnerId,
            }).map((post) => {
              localPostIds.current.add(post.id);
              return post;
            }),
      );
    },
    [activeMemberId, familyId, updatePosts],
  );

  const hasMoreKnownPosts =
    totalRemotePostCount === undefined
      ? hasMorePosts
      : loadedRemotePostCount < totalRemotePostCount;

  const loadMorePosts = useCallback(() => {
    if (!hasMoreKnownPosts || isLoadingMorePosts || !remoteSyncEnabled) {
      return;
    }

    setIsLoadingMorePosts(true);
    setRemotePostLimit((current) => current + wallPostPageSize);
  }, [hasMoreKnownPosts, isLoadingMorePosts, remoteSyncEnabled]);

  const sortedPosts = useMemo(() => sortPostsByCreatedAt(posts), [posts]);

  const toggleForcedOffline = useCallback(
    () => setForcedOffline((current) => !current),
    [],
  );

  return {
    addComment,
    forcedOffline,
    hasMorePosts: hasMoreKnownPosts,
    hydrated,
    isOnline,
    isLoadingMorePosts,
    isRefreshingPosts,
    loadMorePosts,
    loadedRemotePostCount,
    posts: sortedPosts,
    retryPost,
    refreshPosts,
    seedSampleMemories,
    sendMemory,
    toggleForcedOffline,
    toggleReaction,
    totalRemotePostCount,
  };
};
