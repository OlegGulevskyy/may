import * as FileSystem from "expo-file-system/legacy";
import { httpsCallable } from "firebase/functions";

import type { MemoryMedia, MemoryOriginalStorage, MemoryPost } from "@may/core";

import { getFirebaseServices } from "./firebase";

type OriginalMediaUploadSessionRequest = {
  authorId: string;
  familyId: string;
  fileName?: string;
  mediaId: string;
  mimeType: string;
  postId: string;
  sizeBytes?: number;
};

type GoogleDriveUploadSession = {
  fileName: string;
  mimeType: string;
  provider: "googleDrive";
  uploadMethod: "resumable";
  uploadUrl: string;
};

type GoogleDriveFileResponse = {
  error?: {
    message?: string;
  };
  id?: string;
  name?: string;
  webContentLink?: string;
  webViewLink?: string;
};

type OriginalMediaStorageProvider = {
  uploadOriginal: (
    post: MemoryPost,
    media: MemoryMedia,
  ) => Promise<MemoryMedia>;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const isUploadableLocalUri = (uri: string) => uri.startsWith("file://");

const getLocalFileSize = async (uri: string) => {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) {
    throw new Error("Local media file is no longer available.");
  }

  return info.size;
};

const parseDriveUploadResponse = (body: string) => {
  try {
    return JSON.parse(body) as GoogleDriveFileResponse;
  } catch {
    throw new Error("Google Drive returned an unreadable upload response.");
  }
};

const googleDriveOriginalStorage: OriginalMediaStorageProvider = {
  uploadOriginal: async (post, media) => {
    if (!isUploadableLocalUri(media.uri)) {
      return media;
    }

    const services = getFirebaseServices();
    if (!services?.auth.currentUser) {
      throw new Error("Sign in before uploading media.");
    }

    const sizeBytes = await getLocalFileSize(media.uri);
    const mimeType = media.mimeType ?? "application/octet-stream";
    const createUploadSession = httpsCallable<
      OriginalMediaUploadSessionRequest,
      GoogleDriveUploadSession
    >(services.functions, "createOriginalMediaUploadSession");
    const sessionResult = await createUploadSession({
      authorId: post.authorId,
      familyId: post.familyId,
      fileName: media.fileName,
      mediaId: media.id,
      mimeType,
      postId: post.id,
      sizeBytes,
    });
    const session = sessionResult.data;

    if (
      session.provider !== "googleDrive" ||
      session.uploadMethod !== "resumable" ||
      !session.uploadUrl
    ) {
      throw new Error(
        "The media storage provider returned an invalid upload session.",
      );
    }

    const uploadResult = await FileSystem.uploadAsync(
      session.uploadUrl,
      media.uri,
      {
        headers: {
          "Content-Type": session.mimeType,
        },
        httpMethod: "PUT",
        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      },
    );
    const driveFile = parseDriveUploadResponse(uploadResult.body);

    if (uploadResult.status < 200 || uploadResult.status >= 300) {
      throw new Error(
        driveFile.error?.message ??
          `Google Drive upload failed with HTTP ${uploadResult.status}.`,
      );
    }

    if (!driveFile.id) {
      throw new Error("Google Drive did not return an uploaded file id.");
    }

    const originalStorage: MemoryOriginalStorage = {
      fileId: driveFile.id,
      name: driveFile.name ?? session.fileName,
      provider: "googleDrive",
      webContentLink: driveFile.webContentLink,
      webViewLink: driveFile.webViewLink,
    };

    return {
      ...media,
      mimeType: session.mimeType,
      originalStorage,
      sizeBytes,
      uri:
        driveFile.webContentLink ??
        driveFile.webViewLink ??
        `https://drive.google.com/file/d/${driveFile.id}/view`,
    };
  },
};

const originalMediaStorage = googleDriveOriginalStorage;

export const uploadOriginalMedia = async (
  post: MemoryPost,
  media: MemoryMedia,
) => {
  try {
    return await originalMediaStorage.uploadOriginal(post, media);
  } catch (error) {
    throw new Error(`Original media upload failed: ${getErrorMessage(error)}`);
  }
};
