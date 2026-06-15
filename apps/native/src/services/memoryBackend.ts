import {
  collection,
  doc,
  getCountFromServer,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

import type {
  MemoryComment,
  MemoryDeliveryStatus,
  MemoryMedia,
  MemoryPost,
} from "@may/core";

import { getFirebaseServices } from "./firebase";

const syncLog = (event: string, details?: Record<string, unknown>) => {
  console.info(`[MaySync] ${event}`, details ?? {});
};

const syncWarn = (event: string, details?: Record<string, unknown>) => {
  console.warn(`[MaySync] ${event}`, details ?? {});
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const uriScheme = (uri: string) => uri.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];

const isUploadableLocalUri = (uri: string) => uri.startsWith("file://");

const normalizeIsoString = (value: unknown, fallback: string) => {
  if (typeof value === "string") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString();
  }
  return fallback;
};

const normalizeMediaItem = (value: unknown): MemoryMedia => {
  const media = value as MemoryMedia;
  if (
    media.kind === "image" &&
    typeof media.uri === "string" &&
    typeof media.thumbnailUri === "string" &&
    isUploadableLocalUri(media.thumbnailUri) &&
    !isUploadableLocalUri(media.uri)
  ) {
    return { ...media, thumbnailUri: media.uri };
  }

  return media;
};

const normalizeMedia = (value: unknown): MemoryMedia[] =>
  Array.isArray(value) ? value.map(normalizeMediaItem) : [];

const normalizeComments = (value: unknown): MemoryComment[] =>
  Array.isArray(value) ? (value as MemoryComment[]) : [];

const normalizeReactions = (value: unknown): MemoryPost["reactions"] =>
  value && typeof value === "object" ? (value as MemoryPost["reactions"]) : {};

const normalizeStatus = (value: unknown): MemoryDeliveryStatus =>
  typeof value === "string" &&
  [
    "local",
    "queued",
    "synced",
    "uploading",
    "stored",
    "emailing",
    "delivered",
    "failed",
  ].includes(value)
    ? (value as MemoryDeliveryStatus)
    : "synced";

const hasUploadableRemoteMedia = (media: MemoryMedia[]) =>
  media.some((item) => isUploadableLocalUri(item.uri));

const normalizeRemoteStatus = (
  status: MemoryDeliveryStatus,
  hasLocalMedia: boolean,
): MemoryDeliveryStatus =>
  hasLocalMedia && !["local", "queued", "uploading", "failed"].includes(status)
    ? "failed"
    : status;

const toMemoryPost = (
  id: string,
  familyId: string,
  data: Record<string, unknown>,
): MemoryPost => {
  const now = new Date().toISOString();
  const media = normalizeMedia(data.media);
  const status = normalizeStatus(data.status);
  const hasLocalMedia = hasUploadableRemoteMedia(media);

  return {
    id,
    familyId: String(data.familyId ?? familyId),
    authorId: String(data.authorId ?? ""),
    body: String(data.body ?? ""),
    media,
    comments: normalizeComments(data.comments),
    reactions: normalizeReactions(data.reactions),
    status: normalizeRemoteStatus(status, hasLocalMedia),
    createdAt: normalizeIsoString(data.createdAt, now),
    updatedAt: normalizeIsoString(data.updatedAt, now),
    deliveredAt:
      data.deliveredAt === undefined
        ? undefined
        : normalizeIsoString(data.deliveredAt, now),
    errorMessage:
      typeof data.errorMessage === "string"
        ? data.errorMessage
        : hasLocalMedia
          ? "Media still needs to be uploaded from this device."
          : undefined,
  };
};

const removeUndefinedFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, removeUndefinedFields(item)]),
  );
};

const getSignedInServices = () => {
  const services = getFirebaseServices();
  if (!services?.auth.currentUser) {
    syncWarn("remote services unavailable", {
      hasFirebaseServices: Boolean(services),
      hasCurrentUser: Boolean(services?.auth.currentUser),
    });
    return null;
  }

  return services;
};

const mediaStoragePath = (post: MemoryPost, media: MemoryMedia) =>
  `families/${post.familyId}/posts/${post.id}/media/${media.id}/original`;

const fileExtension = (value?: string) =>
  value?.split("?")[0]?.split(".").pop()?.toLowerCase();

const mediaContentTypeFromExtension = (media: MemoryMedia) => {
  const extension = fileExtension(media.fileName) ?? fileExtension(media.uri);
  switch (extension) {
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "mov":
      return "video/quicktime";
    case "mp4":
      return "video/mp4";
    case "m4a":
      return "audio/m4a";
    default:
      return undefined;
  }
};

const mediaContentType = (media: MemoryMedia) => {
  const extensionContentType = mediaContentTypeFromExtension(media);
  if (extensionContentType) {
    return extensionContentType;
  }
  if (media.mimeType) {
    return media.mimeType;
  }
  switch (media.kind) {
    case "audio":
      return "audio/m4a";
    case "video":
      return "video/mp4";
    case "image":
    default:
      return "image/jpeg";
  }
};

// React Native's Blob polyfill cannot build blobs from an ArrayBuffer/Uint8Array,
// so the Firebase JS SDK's uploadString(BASE64)/uploadBytes(Uint8Array) paths throw
// "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported".
// Reading the file:// URI through XHR yields a native-backed Blob that uploads cleanly.
const blobFromLocalUri = (uri: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = "blob";
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () =>
      reject(new Error("Failed to read local media for upload."));
    xhr.open("GET", uri, true);
    xhr.send(null);
  });

const uploadLocalMedia = async (
  storage: FirebaseStorage,
  post: MemoryPost,
  media: MemoryMedia,
): Promise<MemoryMedia> => {
  if (!isUploadableLocalUri(media.uri)) {
    syncLog("media upload skipped", {
      kind: media.kind,
      mediaId: media.id,
      postId: post.id,
      uriScheme: uriScheme(media.uri) ?? "unknown",
    });
    return media;
  }

  const storagePath = media.storagePath ?? mediaStoragePath(post, media);
  const storageRef = ref(storage, storagePath);
  const contentType = mediaContentType(media);

  syncLog("media upload starting", {
    contentType,
    kind: media.kind,
    mediaId: media.id,
    postId: post.id,
    storagePath,
  });

  const blob = await blobFromLocalUri(media.uri);
  try {
    await uploadBytes(storageRef, blob, { contentType });
  } finally {
    // RN blobs hold a native reference that must be released explicitly.
    (blob as Blob & { close?: () => void }).close?.();
  }

  const uri = await getDownloadURL(storageRef);

  syncLog("media upload finished", {
    kind: media.kind,
    mediaId: media.id,
    postId: post.id,
    storagePath,
  });

  return {
    ...media,
    mimeType: contentType,
    storagePath,
    thumbnailUri: media.kind === "image" ? uri : media.thumbnailUri,
    uri,
  };
};

const uploadPostMedia = async (
  storage: FirebaseStorage,
  post: MemoryPost,
): Promise<MemoryPost> => {
  if (post.media.length === 0) {
    syncLog("post has no media to upload", { postId: post.id });
    return post;
  }

  syncLog("post media upload starting", {
    mediaCount: post.media.length,
    postId: post.id,
  });

  const media = await Promise.all(
    post.media.map((item) => uploadLocalMedia(storage, post, item)),
  );

  syncLog("post media upload finished", {
    mediaCount: media.length,
    postId: post.id,
  });

  return {
    ...post,
    media,
    status: "synced",
    updatedAt: new Date().toISOString(),
  };
};

// The thumbnail lives next to the original at a deterministic path, written by
// the generateImageThumbnail Storage function.
const thumbnailStoragePath = (storagePath: string) =>
  storagePath.replace(/\/original$/, "/thumb_960.jpg");

const withDownloadUrl = async (
  storage: FirebaseStorage,
  media: MemoryMedia,
): Promise<MemoryMedia> => {
  if (!media.storagePath) {
    return media;
  }

  const uri = await getDownloadURL(ref(storage, media.storagePath));

  if (media.kind !== "image") {
    return { ...media, uri };
  }

  // The thumbnail is produced asynchronously after upload, so it may not exist
  // yet for a just-posted image — fall back to the original until it does.
  let thumbnailUri = uri;
  try {
    thumbnailUri = await getDownloadURL(
      ref(storage, thumbnailStoragePath(media.storagePath)),
    );
  } catch {
    // Thumbnail not generated yet; the original stands in until the next load.
  }

  return { ...media, thumbnailUri, uri };
};

const withDownloadUrls = async (
  storage: FirebaseStorage,
  post: MemoryPost,
): Promise<MemoryPost> => ({
  ...post,
  media: await Promise.all(
    post.media.map((media) => withDownloadUrl(storage, media)),
  ),
});

export const subscribeToRemoteMemoryWall = ({
  familyId,
  onError,
  onPosts,
  postLimit,
}: {
  familyId: string;
  onError: (message: string) => void;
  onPosts: (page: {
    hasMore: boolean;
    posts: MemoryPost[];
    totalPostCount?: number;
  }) => void;
  postLimit: number;
}): Unsubscribe | null => {
  const services = getSignedInServices();
  if (!services) {
    return null;
  }

  syncLog("remote wall subscribe", { familyId, postLimit });

  const postsCollection = collection(
    services.db,
    "families",
    familyId,
    "posts",
  );
  const postsQuery = query(
    postsCollection,
    orderBy("createdAt", "desc"),
    queryLimit(postLimit + 1),
  );

  return onSnapshot(
    postsQuery,
    (snapshot) => {
      const visibleDocs = snapshot.docs.slice(0, postLimit);
      const hasMore = snapshot.docs.length > postLimit;

      syncLog("remote wall snapshot", {
        familyId,
        hasMore,
        postCount: snapshot.docs.length,
        visiblePostCount: visibleDocs.length,
      });
      const posts = visibleDocs.map((post) =>
        toMemoryPost(post.id, familyId, post.data() as Record<string, unknown>),
      );
      Promise.all([
        Promise.all(
          posts.map((post) => withDownloadUrls(services.storage, post)),
        ),
        getCountFromServer(postsCollection)
          .then((countSnapshot) => countSnapshot.data().count)
          .catch((error) => {
            syncWarn("remote wall count failed", {
              familyId,
              message: getErrorMessage(error),
            });
            return undefined;
          }),
      ])
        .then(([resolvedPosts, totalPostCount]) => {
          syncLog("remote wall page ready", {
            familyId,
            hasMore,
            loadedPostCount: resolvedPosts.length,
            totalPostCount,
          });
          onPosts({ hasMore, posts: resolvedPosts, totalPostCount });
        })
        .catch((error) => {
          syncWarn("remote media URL resolution failed", {
            familyId,
            message: getErrorMessage(error),
          });
          onPosts({ hasMore, posts });
        });
    },
    (error) => {
      syncWarn("remote wall subscribe failed", {
        familyId,
        message: getErrorMessage(error),
      });
      onError(getErrorMessage(error));
    },
  );
};

export const saveRemoteMemoryPost = async (post: MemoryPost) => {
  const services = getSignedInServices();
  if (!services) {
    throw new Error("Sign in before syncing memories.");
  }

  syncLog("post save starting", {
    familyId: post.familyId,
    localMediaCount: post.media.filter((media) =>
      isUploadableLocalUri(media.uri),
    ).length,
    mediaCount: post.media.length,
    postId: post.id,
    status: post.status,
  });

  const remotePost = await uploadPostMedia(services.storage, post);

  await setDoc(
    doc(services.db, "families", remotePost.familyId, "posts", remotePost.id),
    removeUndefinedFields(remotePost) as Record<string, unknown>,
    { merge: true },
  );

  syncLog("post save finished", {
    mediaCount: remotePost.media.length,
    postId: remotePost.id,
    status: remotePost.status,
  });

  return remotePost;
};
