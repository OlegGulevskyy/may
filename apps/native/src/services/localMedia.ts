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
    fileName: asset.fileName ?? `${id}.${extension}`,
    mimeType: asset.mimeType ?? defaultMimeType(kind, extension),
    durationMs: asset.duration ?? undefined,
    width: asset.width,
    height: asset.height,
  };
};

const getExtension = (asset: ImagePickerAsset, kind: MemoryMediaKind) => {
  const fromFileName = asset.fileName?.split(".").pop();
  const fromUri = asset.uri.split("?")[0]?.split(".").pop();
  const raw = fromFileName || fromUri;

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

const defaultMimeType = (kind: MemoryMediaKind, extension: string) => {
  if (kind === "video") {
    return extension === "mov" ? "video/quicktime" : "video/mp4";
  }

  if (kind === "audio") {
    return "audio/m4a";
  }

  return extension === "png" ? "image/png" : "image/jpeg";
};
