import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import * as FileSystem from "expo-file-system/legacy";
import {
  getDownloadURL,
  ref,
  StringFormat,
  uploadBytes,
  uploadString,
  type FirebaseStorage,
  type StorageReference,
} from "firebase/storage";

import type {
  MemoryComment,
  MemoryDeliveryStatus,
  MemoryMedia,
  MemoryPost,
} from "@may/core";

import { getFirebaseServices } from "./firebase";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

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

const normalizeMedia = (value: unknown): MemoryMedia[] =>
  Array.isArray(value) ? (value as MemoryMedia[]) : [];

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

const toMemoryPost = (
  id: string,
  familyId: string,
  data: Record<string, unknown>,
): MemoryPost => {
  const now = new Date().toISOString();

  return {
    id,
    familyId: String(data.familyId ?? familyId),
    authorId: String(data.authorId ?? ""),
    body: String(data.body ?? ""),
    media: normalizeMedia(data.media),
    comments: normalizeComments(data.comments),
    reactions: normalizeReactions(data.reactions),
    status: normalizeStatus(data.status),
    createdAt: normalizeIsoString(data.createdAt, now),
    updatedAt: normalizeIsoString(data.updatedAt, now),
    deliveredAt:
      data.deliveredAt === undefined
        ? undefined
        : normalizeIsoString(data.deliveredAt, now),
    errorMessage:
      typeof data.errorMessage === "string" ? data.errorMessage : undefined,
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
    return null;
  }

  return services;
};

const isUploadableLocalUri = (uri: string) => uri.startsWith("file://");

const mediaStoragePath = (post: MemoryPost, media: MemoryMedia) =>
  `families/${post.familyId}/posts/${post.id}/media/${media.id}/original`;

const mediaContentType = (media: MemoryMedia) => {
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

const uploadMediaBlob = async (
  storageRef: StorageReference,
  media: MemoryMedia,
) => {
  const response = await fetch(media.uri);
  const blob = (await response.blob()) as Blob & { close?: () => void };

  try {
    await uploadBytes(storageRef, blob, {
      contentType: mediaContentType(media),
    });
  } finally {
    blob.close?.();
  }
};

const uploadMediaBase64 = async (
  storageRef: StorageReference,
  media: MemoryMedia,
) => {
  const body = await FileSystem.readAsStringAsync(media.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await uploadString(storageRef, body, StringFormat.BASE64, {
    contentType: mediaContentType(media),
  });
};

const uploadLocalMedia = async (
  storage: FirebaseStorage,
  post: MemoryPost,
  media: MemoryMedia,
): Promise<MemoryMedia> => {
  if (!isUploadableLocalUri(media.uri)) {
    return media;
  }

  const storagePath = media.storagePath ?? mediaStoragePath(post, media);
  const storageRef = ref(storage, storagePath);

  try {
    await uploadMediaBlob(storageRef, media);
  } catch {
    await uploadMediaBase64(storageRef, media);
  }

  const uri = await getDownloadURL(storageRef);

  return {
    ...media,
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
    return post;
  }

  const media = await Promise.all(
    post.media.map((item) => uploadLocalMedia(storage, post, item)),
  );

  return {
    ...post,
    media,
    status: "stored",
    updatedAt: new Date().toISOString(),
  };
};

export const subscribeToRemoteMemoryWall = ({
  familyId,
  onError,
  onPosts,
}: {
  familyId: string;
  onError: (message: string) => void;
  onPosts: (posts: MemoryPost[]) => void;
}): Unsubscribe | null => {
  const services = getSignedInServices();
  if (!services) {
    return null;
  }

  const postsQuery = query(
    collection(services.db, "families", familyId, "posts"),
    orderBy("createdAt", "desc"),
  );

  return onSnapshot(
    postsQuery,
    (snapshot) => {
      onPosts(
        snapshot.docs.map((post) =>
          toMemoryPost(
            post.id,
            familyId,
            post.data() as Record<string, unknown>,
          ),
        ),
      );
    },
    (error) => onError(getErrorMessage(error)),
  );
};

export const saveRemoteMemoryPost = async (post: MemoryPost) => {
  const services = getSignedInServices();
  if (!services) {
    throw new Error("Sign in before syncing memories.");
  }

  const remotePost = await uploadPostMedia(services.storage, post);

  await setDoc(
    doc(services.db, "families", remotePost.familyId, "posts", remotePost.id),
    removeUndefinedFields(remotePost) as Record<string, unknown>,
    { merge: true },
  );

  return remotePost;
};
