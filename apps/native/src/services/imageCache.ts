import { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";

import type { MemoryMedia } from "@may/core";

type ImageCacheVariant = "original" | "thumbnail";

export type ImageCacheRequest = {
  media: MemoryMedia;
  uri: string;
  variant: ImageCacheVariant;
};

const imageCacheDirectories: Record<ImageCacheVariant, string | null> = {
  original: FileSystem.cacheDirectory
    ? `${FileSystem.cacheDirectory}may-original-images/`
    : null,
  thumbnail: FileSystem.cacheDirectory
    ? `${FileSystem.cacheDirectory}may-thumbnail-images/`
    : null,
};
const imageCacheUris = new Map<string, string>();
const imageCacheDownloads = new Map<string, Promise<string>>();
let imageCacheGeneration = 0;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const isNetworkUri = (uri: string) =>
  uri.startsWith("https://") || uri.startsWith("http://");

export const imageSource = (uri: string) =>
  isNetworkUri(uri) ? ({ uri, cache: "force-cache" } as const) : { uri };

const hashString = (value: string) => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
};

const extensionFromMedia = (
  media: MemoryMedia,
  uri: string,
  variant: ImageCacheVariant,
) => {
  const fileNameExtension = media.fileName?.split(".").pop();
  const uriExtension = uri.split("?")[0]?.split("#")[0]?.split(".").pop();
  const raw =
    variant === "thumbnail"
      ? (uriExtension ?? fileNameExtension)
      : (fileNameExtension ?? uriExtension);
  const extension = raw?.toLowerCase();

  if (extension && /^[a-z0-9]+$/.test(extension) && extension.length <= 5) {
    return extension;
  }

  if (variant === "thumbnail" && media.kind !== "image") {
    return "jpg";
  }

  switch (media.mimeType?.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
};

const imageCacheKey = (variant: ImageCacheVariant, uri: string) =>
  `${variant}:${uri}`;

const cachedImageFileUri = (
  media: MemoryMedia,
  uri: string,
  variant: ImageCacheVariant,
) => {
  const directory = imageCacheDirectories[variant];
  if (!directory) {
    return null;
  }

  const safeId = media.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${directory}${safeId}-${hashString(uri)}.${extensionFromMedia(
    media,
    uri,
    variant,
  )}`;
};

const cacheImageUri = ({
  media,
  uri,
  variant,
}: ImageCacheRequest): Promise<string> => {
  const directory = imageCacheDirectories[variant];

  const isImageRequest =
    media.kind === "image" ||
    (variant === "thumbnail" && media.thumbnailUri === uri);

  if (!isImageRequest || !isNetworkUri(uri) || !directory) {
    return Promise.resolve(uri);
  }

  const key = imageCacheKey(variant, uri);
  const cachedUri = imageCacheUris.get(key);
  if (cachedUri) {
    return Promise.resolve(cachedUri);
  }

  const download = imageCacheDownloads.get(key);
  if (download) {
    return download;
  }

  const generation = imageCacheGeneration;
  const task = (async () => {
    const fileUri = cachedImageFileUri(media, uri, variant);
    if (!fileUri) {
      return uri;
    }

    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

    const existing = await FileSystem.getInfoAsync(fileUri);
    if (generation !== imageCacheGeneration) {
      return uri;
    }

    if (existing.exists && !existing.isDirectory && existing.size > 0) {
      imageCacheUris.set(key, existing.uri);
      return existing.uri;
    }

    if (existing.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    }

    const result = await FileSystem.downloadAsync(uri, fileUri);
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      throw new Error(`Image download failed with HTTP ${result.status}`);
    }

    if (generation !== imageCacheGeneration) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
      return uri;
    }

    imageCacheUris.set(key, result.uri);
    return result.uri;
  })();

  imageCacheDownloads.set(key, task);

  task
    .catch((error) => {
      console.warn("[MaySync] media image cache failed", {
        error: getErrorMessage(error),
        mediaId: media.id,
        uri,
        variant,
      });
    })
    .finally(() => {
      if (imageCacheDownloads.get(key) === task) {
        imageCacheDownloads.delete(key);
      }
    });

  return task;
};

export const useImageUriCache = (requests: ImageCacheRequest[]) => {
  const [cachedUris, setCachedUris] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    requests.forEach((request) => {
      cacheImageUri(request)
        .then((uri) => {
          if (cancelled) {
            return;
          }

          setCachedUris((current) =>
            current[request.uri] === uri
              ? current
              : { ...current, [request.uri]: uri },
          );
        })
        .catch(() => {
          // cacheImageUri already logs a useful diagnostic and leaves the
          // remote URI usable as a fallback.
        });
    });

    return () => {
      cancelled = true;
    };
  }, [requests]);

  return cachedUris;
};

const directorySize = async (directoryUri: string): Promise<number> => {
  const info = await FileSystem.getInfoAsync(directoryUri);
  if (!info.exists) {
    return 0;
  }

  if (!info.isDirectory) {
    return info.size;
  }

  const entries = await FileSystem.readDirectoryAsync(directoryUri);
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const childUri = `${directoryUri}${entry}`;
      const childInfo = await FileSystem.getInfoAsync(childUri);

      if (!childInfo.exists) {
        return 0;
      }

      if (childInfo.isDirectory) {
        return directorySize(`${childUri}/`);
      }

      return childInfo.size;
    }),
  );

  return sizes.reduce((total, size) => total + size, 0);
};

export const getImageCacheSizeBytes = async () => {
  const sizes = await Promise.all(
    Object.values(imageCacheDirectories)
      .filter((directory): directory is string => Boolean(directory))
      .map(directorySize),
  );

  return sizes.reduce((total, size) => total + size, 0);
};

export const clearImageCache = async () => {
  imageCacheGeneration += 1;
  imageCacheUris.clear();
  imageCacheDownloads.clear();

  await Promise.all(
    Object.values(imageCacheDirectories)
      .filter((directory): directory is string => Boolean(directory))
      .map((directory) =>
        FileSystem.deleteAsync(directory, { idempotent: true }),
      ),
  );
};
