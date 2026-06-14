import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

import {
  createId,
  createMemoryPost,
  type MemoryAuthorId,
  type MemoryComment,
  type MemoryDeliveryStatus,
  type MemoryMedia,
  type MemoryPost,
} from "@repo/core";

import { demoMemories } from "../data/demoMemories";

const STORAGE_KEY = "may.memory-wall.v1";
const ACTIVE_AUTHOR_KEY = "may.active-author.v1";
const FAMILY_ID = "family-demo";

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

export const useMemoryWall = () => {
  const [posts, setPosts] = useState<MemoryPost[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [forcedOffline, setForcedOffline] = useState(false);
  const [activeAuthorId, setActiveAuthorIdState] =
    useState<MemoryAuthorId>("dad");
  const syncingPostIds = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isOnline = networkOnline && !forcedOffline;

  useEffect(() => {
    const hydrate = async () => {
      const [storedPosts, storedAuthor] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(ACTIVE_AUTHOR_KEY),
      ]);

      if (storedPosts) {
        setPosts(JSON.parse(storedPosts) as MemoryPost[]);
      } else {
        setPosts(demoMemories);
      }

      if (storedAuthor === "dad" || storedAuthor === "mom") {
        setActiveAuthorIdState(storedAuthor);
      }

      setHydrated(true);
    };

    hydrate().catch(() => {
      setPosts(demoMemories);
      setHydrated(true);
    });
  }, []);

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

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(posts)).catch(
      () => undefined,
    );
  }, [hydrated, posts]);

  useEffect(() => {
    AsyncStorage.setItem(ACTIVE_AUTHOR_KEY, activeAuthorId).catch(
      () => undefined,
    );
  }, [activeAuthorId]);

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
          familyId: FAMILY_ID,
          authorId: activeAuthorId,
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
    [activeAuthorId, isOnline, runDemoSync],
  );

  const addComment = useCallback(
    (postId: string, body: string) => {
      const comment: MemoryComment = {
        id: createId("comment"),
        authorId: activeAuthorId,
        body,
        createdAt: new Date().toISOString(),
      };

      updatePost(postId, (post) => ({
        ...post,
        comments: [...post.comments, comment],
        updatedAt: new Date().toISOString(),
      }));
    },
    [activeAuthorId, updatePost],
  );

  const toggleReaction = useCallback(
    (postId: string, reaction: string) => {
      updatePost(postId, (post) => {
        const current = post.reactions[reaction] ?? [];
        const next = current.includes(activeAuthorId)
          ? current.filter((authorId) => authorId !== activeAuthorId)
          : [...current, activeAuthorId];

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
    [activeAuthorId, updatePost],
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

  const clearLocalData = useCallback(() => {
    setPosts([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  }, []);

  const setActiveAuthorId = useCallback((authorId: MemoryAuthorId) => {
    setActiveAuthorIdState(authorId);
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
    activeAuthorId,
    addComment,
    clearLocalData,
    forcedOffline,
    hydrated,
    isOnline,
    posts: sortedPosts,
    retryPost,
    sendMemory,
    setActiveAuthorId,
    toggleForcedOffline: () => setForcedOffline((current) => !current),
    toggleReaction,
  };
};
