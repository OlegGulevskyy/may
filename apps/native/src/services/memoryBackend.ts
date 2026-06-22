import {
  collection,
  doc,
  getCountFromServer,
  getDocsFromServer,
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
  MemoryContentImageMap,
  MemoryDeliveryStatus,
  MemoryMedia,
  MemoryPost,
  MemoryRichTextDocument,
  MemoryRichTextNode,
} from "@may/core";
import { isMemoryRichTextDocument } from "@may/core";

import { getFirebaseServices } from "./firebase";
import { uploadOriginalMedia } from "./originalMediaStorage";
import { originalMediaStreamUrl } from "./originalMediaPlayback";

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

const normalizeOptionalString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const normalizeContentImageMap = (value: unknown): MemoryContentImageMap =>
  value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

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
  media.some(
    (item) =>
      isUploadableLocalUri(item.uri) ||
      (typeof item.thumbnailUri === "string" &&
        isUploadableLocalUri(item.thumbnailUri)),
  );

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
    emailSubject: normalizeOptionalString(data.emailSubject),
    body: String(data.body ?? ""),
    content: isMemoryRichTextDocument(data.content) ? data.content : undefined,
    contentImageMap: normalizeContentImageMap(data.contentImageMap),
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

const mediaThumbnailStoragePath = (storagePath: string) =>
  storagePath.replace(/\/original$/, "/thumb_960.jpg");

const mediaPreviewStoragePath = (storagePath: string, media: MemoryMedia) => {
  const extension =
    fileExtension(media.fileName) ?? fileExtension(media.uri) ?? "jpg";
  return storagePath.replace(/\/original$/, `/preview.${extension}`);
};

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
      return "audio/mp4";
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
      return "audio/mp4";
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

const uploadLocalMediaThumbnail = async (
  storage: FirebaseStorage,
  post: MemoryPost,
  media: MemoryMedia,
  originalStoragePath: string,
): Promise<Pick<MemoryMedia, "thumbnailStoragePath" | "thumbnailUri">> => {
  const thumbnailSourceUri =
    media.thumbnailUri && isUploadableLocalUri(media.thumbnailUri)
      ? media.thumbnailUri
      : media.kind === "image" && isUploadableLocalUri(media.uri)
        ? media.uri
        : undefined;

  if (!thumbnailSourceUri) {
    return {};
  }

  const thumbnailStoragePath =
    media.thumbnailStoragePath ??
    (media.kind === "image" && thumbnailSourceUri === media.uri
      ? mediaPreviewStoragePath(originalStoragePath, media)
      : mediaThumbnailStoragePath(originalStoragePath));
  const thumbnailRef = ref(storage, thumbnailStoragePath);
  const contentType =
    media.kind === "image" && thumbnailSourceUri === media.uri
      ? mediaContentType(media)
      : "image/jpeg";

  syncLog("media thumbnail upload starting", {
    contentType,
    kind: media.kind,
    mediaId: media.id,
    postId: post.id,
    storagePath: thumbnailStoragePath,
  });

  const blob = await blobFromLocalUri(thumbnailSourceUri);
  try {
    await uploadBytes(thumbnailRef, blob, { contentType });
  } finally {
    (blob as Blob & { close?: () => void }).close?.();
  }

  const thumbnailUri = await getDownloadURL(thumbnailRef);

  syncLog("media thumbnail upload finished", {
    kind: media.kind,
    mediaId: media.id,
    postId: post.id,
    storagePath: thumbnailStoragePath,
  });

  return { thumbnailStoragePath, thumbnailUri };
};

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

  const thumbnailBaseStoragePath = mediaStoragePath(post, media);
  const contentType = mediaContentType(media);

  syncLog("media upload starting", {
    contentType,
    kind: media.kind,
    mediaId: media.id,
    postId: post.id,
    provider: "googleDrive",
  });

  const originalMedia = await uploadOriginalMedia(post, {
    ...media,
    mimeType: contentType,
  });
  const hasUploadableThumbnail =
    typeof media.thumbnailUri === "string" &&
    isUploadableLocalUri(media.thumbnailUri);
  const remoteThumbnailUri =
    originalMedia.thumbnailUri &&
    !isUploadableLocalUri(originalMedia.thumbnailUri)
      ? originalMedia.thumbnailUri
      : undefined;
  let uploadedThumbnail: Pick<
    MemoryMedia,
    "thumbnailStoragePath" | "thumbnailUri"
  > = {};

  try {
    uploadedThumbnail = await uploadLocalMediaThumbnail(
      storage,
      post,
      media,
      thumbnailBaseStoragePath,
    );
  } catch (error) {
    syncWarn("media thumbnail upload failed", {
      kind: media.kind,
      mediaId: media.id,
      message: getErrorMessage(error),
      postId: post.id,
    });
  }

  syncLog("media upload finished", {
    kind: media.kind,
    mediaId: media.id,
    postId: post.id,
    provider: originalMedia.originalStorage?.provider ?? "unknown",
  });

  return {
    ...originalMedia,
    mimeType: contentType,
    storagePath:
      originalMedia.originalStorage?.provider === "firebaseStorage"
        ? originalMedia.storagePath
        : undefined,
    thumbnailStoragePath:
      uploadedThumbnail.thumbnailStoragePath ??
      originalMedia.thumbnailStoragePath,
    thumbnailUri:
      media.kind === "image"
        ? (uploadedThumbnail.thumbnailUri ??
          remoteThumbnailUri ??
          originalMedia.uri)
        : (uploadedThumbnail.thumbnailUri ??
          (hasUploadableThumbnail ? undefined : media.thumbnailUri)),
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

  const media: MemoryMedia[] = [];
  for (const item of post.media) {
    media.push(await uploadLocalMedia(storage, post, item));
  }

  syncLog("post media upload finished", {
    mediaCount: media.length,
    postId: post.id,
  });

  return {
    ...post,
    content: rewriteContentImageSources(
      post.content,
      post.contentImageMap,
      media,
    ),
    contentImageMap: rewriteContentImageMap(post.contentImageMap, media),
    media,
    status: "synced",
    updatedAt: new Date().toISOString(),
  };
};

const rewriteContentImageSources = (
  content: MemoryRichTextDocument | undefined,
  contentImageMap: MemoryContentImageMap | undefined,
  media: MemoryMedia[],
): MemoryRichTextDocument | undefined => {
  if (!content) {
    return content;
  }

  const mediaById = new Map(media.map((item) => [item.id, item]));
  const mediaByUri = new Map(media.map((item) => [item.uri, item]));
  const imageMap = contentImageMap ?? {};
  const contentImageUri = (item: MemoryMedia) =>
    item.kind === "image" ? (item.thumbnailUri ?? item.uri) : item.uri;

  const rewriteNode = (node: MemoryRichTextNode): MemoryRichTextNode => {
    const attrs = node.attrs;
    const source = typeof attrs?.src === "string" ? attrs.src : undefined;
    const mappedMedia = source
      ? (mediaById.get(imageMap[source] ?? "") ?? mediaByUri.get(source))
      : undefined;

    return {
      ...node,
      attrs:
        node.type === "image" && attrs && mappedMedia
          ? { ...attrs, src: contentImageUri(mappedMedia) }
          : attrs,
      content: node.content?.map(rewriteNode),
    };
  };

  return {
    ...content,
    content: content.content?.map(rewriteNode),
  };
};

const rewriteContentImageMap = (
  contentImageMap: MemoryContentImageMap | undefined,
  media: MemoryMedia[],
): MemoryContentImageMap | undefined => {
  if (!contentImageMap) {
    return contentImageMap;
  }

  const mediaById = new Map(media.map((item) => [item.id, item]));
  const next: MemoryContentImageMap = {};

  Object.entries(contentImageMap).forEach(([source, mediaId]) => {
    const item = mediaById.get(mediaId);
    next[source] = mediaId;
    if (item) {
      next[item.uri] = mediaId;
      if (item.thumbnailUri) {
        next[item.thumbnailUri] = mediaId;
      }
    }
  });

  return next;
};

const getPostsCollection = (familyId: string) => {
  const services = getSignedInServices();
  if (!services) {
    return null;
  }

  return {
    postsCollection: collection(services.db, "families", familyId, "posts"),
    services,
  };
};

const getPostsPageQuery = (familyId: string, postLimit: number) => {
  const posts = getPostsCollection(familyId);
  if (!posts) {
    return null;
  }

  return {
    ...posts,
    postsQuery: query(
      posts.postsCollection,
      orderBy("createdAt", "desc"),
      queryLimit(postLimit + 1),
    ),
  };
};

const resolveThumbnailDownloadUrl = async (
  storage: FirebaseStorage,
  media: MemoryMedia,
  originalUri: string,
) => {
  const thumbnailStoragePath =
    media.thumbnailStoragePath ??
    (media.kind === "image" && media.storagePath
      ? mediaThumbnailStoragePath(media.storagePath)
      : undefined);

  if (!thumbnailStoragePath) {
    return media.kind === "image" ? originalUri : media.thumbnailUri;
  }

  try {
    return await getDownloadURL(ref(storage, thumbnailStoragePath));
  } catch {
    return media.kind === "image" ? originalUri : media.thumbnailUri;
  }
};

const withDownloadUrl = async (
  storage: FirebaseStorage,
  post: MemoryPost,
  media: MemoryMedia,
): Promise<MemoryMedia> => {
  const streamUri =
    (media.kind === "image" || media.kind === "video") &&
    media.originalStorage?.provider === "googleDrive"
      ? originalMediaStreamUrl({
          familyId: post.familyId,
          mediaId: media.id,
          postId: post.id,
        })
      : undefined;
  const uri =
    streamUri ??
    (media.storagePath
      ? await getDownloadURL(ref(storage, media.storagePath))
      : media.uri);
  const thumbnailUri = await resolveThumbnailDownloadUrl(storage, media, uri);

  return thumbnailUri ? { ...media, thumbnailUri, uri } : { ...media, uri };
};

const withDownloadUrls = async (
  storage: FirebaseStorage,
  post: MemoryPost,
): Promise<MemoryPost> => ({
  ...post,
  media: await Promise.all(
    post.media.map((media) => withDownloadUrl(storage, post, media)),
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
  const postsPageQuery = getPostsPageQuery(familyId, postLimit);
  if (!postsPageQuery) {
    return null;
  }
  const { postsCollection, postsQuery, services } = postsPageQuery;

  syncLog("remote wall subscribe", { familyId, postLimit });

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

export const fetchRemoteMemoryWallPage = async ({
  familyId,
  postLimit,
}: {
  familyId: string;
  postLimit: number;
}) => {
  const postsPageQuery = getPostsPageQuery(familyId, postLimit);
  if (!postsPageQuery) {
    return null;
  }
  const { postsCollection, postsQuery, services } = postsPageQuery;

  syncLog("remote wall refresh starting", { familyId, postLimit });

  const snapshot = await getDocsFromServer(postsQuery);
  const visibleDocs = snapshot.docs.slice(0, postLimit);
  const hasMore = snapshot.docs.length > postLimit;
  const posts = visibleDocs.map((post) =>
    toMemoryPost(post.id, familyId, post.data() as Record<string, unknown>),
  );

  const [resolvedPosts, totalPostCount] = await Promise.all([
    Promise.all(
      posts.map((post) => withDownloadUrls(services.storage, post)),
    ).catch((error) => {
      syncWarn("remote refresh media URL resolution failed", {
        familyId,
        message: getErrorMessage(error),
      });
      return posts;
    }),
    getCountFromServer(postsCollection)
      .then((countSnapshot) => countSnapshot.data().count)
      .catch((error) => {
        syncWarn("remote refresh count failed", {
          familyId,
          message: getErrorMessage(error),
        });
        return undefined;
      }),
  ]);

  syncLog("remote wall refresh finished", {
    familyId,
    hasMore,
    loadedPostCount: resolvedPosts.length,
    totalPostCount,
  });

  return {
    hasMore,
    posts: resolvedPosts,
    totalPostCount,
  };
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

  return withDownloadUrls(services.storage, remotePost);
};
