import * as FileSystem from "expo-file-system/legacy";
import type { ImagePickerAsset } from "expo-image-picker";

import { createId, type MemoryMedia, type MemoryMediaKind } from "@may/core";

const mediaDirectory = `${FileSystem.documentDirectory}may-media/`;

export const persistPickedAsset = async (
  asset: ImagePickerAsset,
  kind: MemoryMediaKind,
): Promise<MemoryMedia> => {
  const id = createId("media");
  const extension = getExtension(asset, kind);
  const destination = `${mediaDirectory}${id}.${extension}`;

  await FileSystem.makeDirectoryAsync(mediaDirectory, { intermediates: true });
  await FileSystem.copyAsync({
    from: asset.uri,
    to: destination,
  });

  return {
    id,
    kind,
    uri: destination,
    thumbnailUri: kind === "image" ? destination : undefined,
    fileName: `${id}.${extension}`,
    mimeType: defaultMimeType(kind, extension),
    durationMs: asset.duration ?? undefined,
    width: asset.width,
    height: asset.height,
  };
};

export const persistRecordedAudio = async (
  uri: string,
  durationMs: number,
  waveformPeaks?: number[],
): Promise<MemoryMedia> => {
  const id = createId("media");
  const extension = extensionFromMimeType("audio/mp4") ?? "m4a";
  const destination = `${mediaDirectory}${id}.${extension}`;

  await FileSystem.makeDirectoryAsync(mediaDirectory, { intermediates: true });
  await FileSystem.copyAsync({
    from: uri,
    to: destination,
  });

  const media: MemoryMedia = {
    id,
    kind: "audio",
    uri: destination,
    durationMs,
    fileName: `${id}.${extension}`,
    mimeType: "audio/mp4",
  };

  if (waveformPeaks) {
    media.waveformPeaks = waveformPeaks;
  }

  return media;
};

const getExtension = (asset: ImagePickerAsset, kind: MemoryMediaKind) => {
  const fromUri = asset.uri.split("?")[0]?.split(".").pop();
  const fromFileName = asset.fileName?.split(".").pop();
  const fromMimeType = extensionFromMimeType(asset.mimeType);
  const raw = fromUri || fromFileName || fromMimeType;

  if (raw && raw.length <= 5) {
    return raw.toLowerCase();
  }

  if (kind === "video") {
    return "mp4";
  }

  if (kind === "audio") {
    return "m4a";
  }

  return "jpg";
};

const extensionFromMimeType = (mimeType?: string) => {
  switch (mimeType?.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "audio/m4a":
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    default:
      return undefined;
  }
};

const defaultMimeType = (kind: MemoryMediaKind, extension: string) => {
  if (kind === "video") {
    return extension === "mov" ? "video/quicktime" : "video/mp4";
  }

  if (kind === "audio") {
    return "audio/mp4";
  }

  switch (extension) {
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "png":
      return "image/png";
    default:
      return "image/jpeg";
  }
};
