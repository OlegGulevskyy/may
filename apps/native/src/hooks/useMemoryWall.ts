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
import { getLocalString, setLocalString } from "../services/storage";
import { wallStorageKey } from "../state/AppState";

const syncStages: Array<{ status: MemoryDeliveryStatus; delayMs: number }> = [
  { status: "queued", delayMs: 80 },
  { status: "uploading", delayMs: 900 },
  { status: "stored", delayMs: 1800 },
  { status: "emailing", delayMs: 2800 },
  { status: "delivered", delayMs: 3900 },
];

type SendMemoryInput = {
  body: string;
  media: MemoryMedia[];
};

/**
 * Family-scoped memory wall. Posts persist locally per family and walk through
 * a simulated delivery pipeline when online. A new family starts empty — sample
 * content is only added on explicit request via {@link seedSampleMemories}.
 */
export const useMemoryWall = (familyId: string, activeMemberId: string) => {
  const storageKey = wallStorageKey(familyId);
  const [posts, setPosts] = useState<MemoryPost[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [forcedOffline, setForcedOffline] = useState(false);
  const syncingPostIds = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isOnline = networkOnline && !forcedOffline;

  useEffect(() => {
    let cancelled = false;
    setHydrated(false);

    try {
      const stored = getLocalString(storageKey);
      if (!cancelled) {
        setPosts(stored ? (JSON.parse(stored) as MemoryPost[]) : []);
        setHydrated(true);
      }
    } catch {
      if (!cancelled) {
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
    if (!hydrated) {
      return;
    }
    setLocalString(storageKey, JSON.stringify(posts));
  }, [hydrated, posts, storageKey]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const updatePost = useCallback(
    (postId: string, updater: (post: MemoryPost) => MemoryPost) => {
      setPosts((current) =>
        current.map((post) => (post.id === postId ? updater(post) : post)),
      );
    },
    [],
  );

  const runDemoSync = useCallback(
    (postId: string) => {
      if (!isOnline || syncingPostIds.current.has(postId)) {
        return;
      }

      syncingPostIds.current.add(postId);

      syncStages.forEach((stage) => {
        const timer = setTimeout(() => {
          updatePost(postId, (post) => ({
            ...post,
            status: stage.status,
            updatedAt: new Date().toISOString(),
            deliveredAt:
              stage.status === "delivered"
                ? new Date().toISOString()
                : post.deliveredAt,
          }));

          if (stage.status === "delivered") {
            syncingPostIds.current.delete(postId);
          }
        }, stage.delayMs);

        timers.current.push(timer);
      });
    },
    [isOnline, updatePost],
  );

  useEffect(() => {
    if (!isOnline) {
      return;
    }

    posts
      .filter((post) => ["local", "queued", "failed"].includes(post.status))
      .forEach((post) => runDemoSync(post.id));
  }, [isOnline, posts, runDemoSync]);

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

      setPosts((current) => [post, ...current]);

      if (isOnline) {
        runDemoSync(post.id);
      }
    },
    [activeMemberId, familyId, isOnline, runDemoSync],
  );

  const addComment = useCallback(
    (postId: string, body: string) => {
      const comment: MemoryComment = {
        id: createId("comment"),
        authorId: activeMemberId,
        body,
        createdAt: new Date().toISOString(),
      };

      updatePost(postId, (post) => ({
        ...post,
        comments: [...post.comments, comment],
        updatedAt: new Date().toISOString(),
      }));
    },
    [activeMemberId, updatePost],
  );

  const toggleReaction = useCallback(
    (postId: string, reaction: string) => {
      updatePost(postId, (post) => {
        const current = post.reactions[reaction] ?? [];
        const next = current.includes(activeMemberId)
          ? current.filter((memberId) => memberId !== activeMemberId)
          : [...current, activeMemberId];

        return {
          ...post,
          reactions: {
            ...post.reactions,
            [reaction]: next,
          },
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [activeMemberId, updatePost],
  );

  const retryPost = useCallback(
    (postId: string) => {
      syncingPostIds.current.delete(postId);
      updatePost(postId, (post) => ({
        ...post,
        status: "queued",
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      }));
      runDemoSync(postId);
    },
    [runDemoSync, updatePost],
  );

  const seedSampleMemories = useCallback(
    (partnerId?: string) => {
      setPosts((current) =>
        current.length > 0
          ? current
          : buildSampleMemories({
              familyId,
              authorId: activeMemberId,
              partnerId,
            }),
      );
    },
    [activeMemberId, familyId],
  );

  const clearLocalData = useCallback(() => {
    setPosts([]);
  }, []);

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
