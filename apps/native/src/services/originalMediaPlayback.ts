import type { VideoSource } from "expo-video";

import type { MemoryMedia } from "@may/core";

import { nativeEnv } from "./env";
import { getFirebaseServices } from "./firebase";

const functionsRegion = "us-east1";

type OriginalMediaPlaybackSource = {
  expiresInSeconds?: number;
  headers?: Record<string, string>;
  uri: string;
};

const playbackSourceCache = new Map<
  string,
  { expiresAt: number; source: OriginalMediaPlaybackSource }
>();

export const originalMediaStreamUrl = ({
  familyId,
  mediaId,
  postId,
}: {
  familyId: string;
  mediaId: string;
  postId: string;
}) => {
  const projectId = nativeEnv.firebaseProjectId;
  if (!projectId) {
    return undefined;
  }

  const query = new URLSearchParams({
    familyId,
    mediaId,
    postId,
  });

  return `https://${functionsRegion}-${projectId}.cloudfunctions.net/streamOriginalMedia?${query.toString()}`;
};

export const isOriginalMediaStreamUrl = (uri: string) =>
  uri.includes(".cloudfunctions.net/streamOriginalMedia?");

const playbackSourceRequestUrl = (uri: string) => {
  const url = new URL(uri);
  url.searchParams.set("mode", "source");
  return url.toString();
};

const fetchOriginalMediaPlaybackSource = async (
  uri: string,
): Promise<OriginalMediaPlaybackSource> => {
  if (!isOriginalMediaStreamUrl(uri)) {
    return { uri };
  }

  const cached = playbackSourceCache.get(uri);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.source;
  }

  const user = getFirebaseServices()?.auth.currentUser;
  if (!user) {
    throw new Error("Sign in before loading this media.");
  }

  const idToken = await user.getIdToken();
  const response = await fetch(playbackSourceRequestUrl(uri), {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Media source request failed with HTTP ${response.status}`);
  }

  const source = (await response.json()) as OriginalMediaPlaybackSource;
  if (
    typeof source.uri !== "string" ||
    (source.headers !== undefined &&
      (typeof source.headers !== "object" || source.headers === null))
  ) {
    throw new Error("Media source response was invalid.");
  }

  playbackSourceCache.set(uri, {
    expiresAt:
      Date.now() + Math.max(60, (source.expiresInSeconds ?? 3000) - 120) * 1000,
    source,
  });

  return source;
};

export const resolveOriginalMediaDownload = async (uri: string) => {
  const source = await fetchOriginalMediaPlaybackSource(uri);
  return {
    headers: source.headers,
    uri: source.uri,
  };
};

export const resolvePlayableVideoSource = async (
  media: MemoryMedia,
): Promise<VideoSource> => {
  const source = await fetchOriginalMediaPlaybackSource(media.uri);
  if (!source.headers) {
    return media.uri;
  }

  return {
    headers: source.headers,
    uri: source.uri,
  };
};
