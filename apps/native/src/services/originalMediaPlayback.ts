import type { VideoSource } from "expo-video";

import type { MemoryMedia } from "@may/core";

import { nativeEnv } from "./env";
import { getFirebaseServices } from "./firebase";

const functionsRegion = "us-east1";

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

export const originalMediaStreamHeaders = async (uri: string) => {
  if (!isOriginalMediaStreamUrl(uri)) {
    return undefined;
  }

  const user = getFirebaseServices()?.auth.currentUser;
  if (!user) {
    throw new Error("Sign in before loading this media.");
  }

  const idToken = await user.getIdToken();
  return {
    Authorization: `Bearer ${idToken}`,
  };
};

export const resolvePlayableVideoSource = async (
  media: MemoryMedia,
): Promise<VideoSource> => {
  const headers = await originalMediaStreamHeaders(media.uri);
  if (!headers) {
    return media.uri;
  }

  return {
    headers,
    uri: media.uri,
  };
};
