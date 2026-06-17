import * as FileSystem from "expo-file-system/legacy";

import type { MemoryMedia } from "@may/core";

const audioPlaybackDirectory = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}may-audio-playback/`
  : null;

const audioPlaybackCopies = new Map<string, Promise<string>>();

const uriScheme = (uri: string) => uri.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];

const hashString = (value: string) => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
};

const safePathPart = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "audio";

const extensionFromMimeType = (mimeType?: string) => {
  switch (mimeType?.toLowerCase()) {
    case "audio/aac":
      return "aac";
    case "audio/caf":
    case "audio/x-caf":
      return "caf";
    case "audio/m4a":
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    default:
      return undefined;
  }
};

const extensionFromPath = (value?: string) => {
  const extension = value?.split("?")[0]?.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]+$/.test(extension) && extension.length <= 5
    ? extension
    : undefined;
};

const audioExtension = (media: MemoryMedia) =>
  extensionFromMimeType(media.mimeType) ??
  extensionFromPath(media.fileName) ??
  extensionFromPath(media.uri) ??
  "m4a";

export const isPlayableAudioUri = (uri: string) => {
  const scheme = uriScheme(uri);
  return scheme === "file" || scheme === "http" || scheme === "https";
};

export const resolvePlayableAudioUri = async (media: MemoryMedia) => {
  const scheme = uriScheme(media.uri);
  if (
    !audioPlaybackDirectory ||
    (scheme !== "file" && scheme !== "http" && scheme !== "https")
  ) {
    return media.uri;
  }

  const key = `${media.id}:${media.uri}`;
  const existing = audioPlaybackCopies.get(key);
  if (existing) {
    return existing;
  }

  const copy = (async () => {
    await FileSystem.makeDirectoryAsync(audioPlaybackDirectory, {
      intermediates: true,
    });

    const destination = `${audioPlaybackDirectory}${safePathPart(
      media.id,
    )}-${hashString(media.uri)}.${audioExtension(media)}`;
    const destinationInfo = await FileSystem.getInfoAsync(destination);

    if (destinationInfo.exists) {
      return destination;
    }

    if (scheme === "file") {
      await FileSystem.copyAsync({
        from: media.uri,
        to: destination,
      });
      return destination;
    }

    await FileSystem.downloadAsync(media.uri, destination);

    return destination;
  })().catch(async (error: unknown) => {
    audioPlaybackCopies.delete(key);
    throw error;
  });

  audioPlaybackCopies.set(key, copy);

  return copy;
};
