import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

import {
  createId,
  createMemoryPost,
  type MemoryComment,
  type MemoryDeliveryStatus,
  type MemoryMedia,
  type MemoryPost,
} from "@may/core";

import { buildSampleMemories } from "../data/demoMemories";
import {
  saveRemoteMemoryPost,
  subscribeToRemoteMemoryWall,
} from "../services/memoryBackend";
import { getLocalString, setLocalString } from "../services/storage";
import { wallStorageKey } from "../state/AppState";

const syncableStatuses = new Set<MemoryDeliveryStatus>([
  "local",
  "queued",
  "failed",
]);
const autoSyncStatuses = new Set<MemoryDeliveryStatus>(["local", "queued"]);

type SendMemoryInput = {
  body: string;
  media: MemoryMedia[];
};

type PostsUpdater = (current: MemoryPost[]) => MemoryPost[];

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const mergeRemotePosts = (
  localPosts: MemoryPost[],
  remotePosts: MemoryPost[],
) => {
  const remotePostIds = new Set(remotePosts.map((post) => post.id));
  const localOnlyPosts = localPosts.filter(
    (post) => !remotePostIds.has(post.id),
  );

  return [...remotePosts, ...localOnlyPosts];
};

const toRemotePost = (post: MemoryPost): MemoryPost => ({
  ...post,
  errorMessage: undefined,
  status: syncableStatuses.has(post.status) ? "synced" : post.status,
  updatedAt: new Date().toISOString(),
});

const hasUploadableLocalMedia = (post: MemoryPost) =>
  post.media.some((media) => media.uri.startsWith("file://"));

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
  const pendingRemotePosts = useRef(new Map<string, MemoryPost>());
  const postsRef = useRef<MemoryPost[]>([]);
  const remotePostIds = useRef(new Set<string>());
  const remotePostsRef = useRef<MemoryPost[]>([]);
  const syncingPostIds = useRef(new Set<string>());

  const isOnline = networkOnline && !forcedOffline;

  const updatePosts = useCallback((updater: PostsUpdater) => {
    setPosts((current) => {
      const next = updater(current);
      postsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);

    try {
      const stored = getLocalString(storageKey);
      if (!cancelled) {
        const nextPosts = stored ? (JSON.parse(stored) as MemoryPost[]) : [];
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

    remotePostIds.current = new Set();
    remotePostsRef.current = [];
    pendingRemotePosts.current.clear();
    syncingPostIds.current.clear();
    setRemoteSyncEnabled(false);

    try {
      unsubscribe = subscribeToRemoteMemoryWall({
        familyId,
        onError: () => {
          if (!cancelled) {
            setRemoteSyncEnabled(false);
          }
        },
        onPosts: (remotePosts) => {
          if (cancelled) {
            return;
          }
          remotePostIds.current = new Set(remotePosts.map((post) => post.id));
          remotePostsRef.current = remotePosts;
          setRemoteSyncEnabled(true);
          updatePosts((current) => mergeRemotePosts(current, remotePosts));
        },
      });
    } catch {
      setRemoteSyncEnabled(false);
      return;
    }

    if (!unsubscribe) {
      return;
    }

    setRemoteSyncEnabled(true);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [familyId, hydrated, updatePosts]);

  const markPostSynced = useCallback(
    (
      postId: string,
      status: MemoryDeliveryStatus,
      updatedAt: string,
      media?: MemoryMedia[],
    ) => {
      updatePosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                errorMessage: undefined,
                media: media ?? post.media,
                status: syncableStatuses.has(post.status)
                  ? status
                  : post.status,
                updatedAt,
              }
            : post,
        ),
      );
    },
    [updatePosts],
  );

  const markPostFailed = useCallback(
    (postId: string, error: unknown) => {
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
        return;
      }

      if (syncingPostIds.current.has(post.id)) {
        pendingRemotePosts.current.set(post.id, post);
        return;
      }

      syncingPostIds.current.add(post.id);
      const remotePost = toRemotePost(post);

      saveRemoteMemoryPost(remotePost)
        .then((savedPost) => {
          remotePostIds.current.add(post.id);
          markPostSynced(
            post.id,
            savedPost.status,
            savedPost.updatedAt,
            savedPost.media,
          );
        })
        .catch((error) => markPostFailed(post.id, error))
        .finally(() => {
          syncingPostIds.current.delete(post.id);
          const pendingPost = pendingRemotePosts.current.get(post.id);

          if (pendingPost) {
            pendingRemotePosts.current.delete(post.id);
            persistPost(pendingPost);
          }
        });
    },
    [isOnline, markPostFailed, markPostSynced, remoteSyncEnabled],
  );

  useEffect(() => {
    if (!hydrated || !isOnline || !remoteSyncEnabled) {
      return;
    }

    posts
      .filter((post) => {
        const isRemotePost = remotePostIds.current.has(post.id);
        return (
          (autoSyncStatuses.has(post.status) && !isRemotePost) ||
          (isRemotePost && hasUploadableLocalMedia(post))
        );
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
      syncableStatuses.has(post.status) || remotePostIds.current.has(post.id),
    [],
  );

  const sendMemory = useCallback(
    ({ body, media }: SendMemoryInput) => {
      const post = {
        ...createMemoryPost({
          familyId,
          authorId: activeMemberId,
          body,
          media,
        }),
        status: "queued" as const,
      };

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

      replacePost(nextPost);
      persistPost(nextPost);
    },
    [persistPost, replacePost],
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
            }),
      );
    },
    [activeMemberId, familyId, updatePosts],
  );

  const clearLocalData = useCallback(() => {
    updatePosts(() => (remoteSyncEnabled ? remotePostsRef.current : []));
  }, [remoteSyncEnabled, updatePosts]);

  const sortedPosts = useMemo(
    () =>
      [...posts].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [posts],
  );

  return {
    addComment,
    clearLocalData,
    forcedOffline,
    hydrated,
    isOnline,
    posts: sortedPosts,
    retryPost,
    seedSampleMemories,
    sendMemory,
    toggleForcedOffline: () => setForcedOffline((current) => !current),
    toggleReaction,
  };
};
