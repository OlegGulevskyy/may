import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import sharp from "sharp";

initializeApp();

const firestoreDatabaseId = "may-default";
const db = getFirestore(firestoreDatabaseId);
const storageFunctionRegion = "us-east1";

type StoragePathParts = {
  familyId: string;
  postId: string;
  mediaId: string;
};

const parseOriginalMediaPath = (path?: string): StoragePathParts | null => {
  if (!path) {
    return null;
  }

  const match = path.match(
    /^families\/([^/]+)\/posts\/([^/]+)\/media\/([^/]+)\/original$/,
  );

  if (!match) {
    return null;
  }

  return {
    familyId: match[1],
    postId: match[2],
    mediaId: match[3],
  };
};

export const generateImageThumbnail = onObjectFinalized(
  {
    memory: "1GiB",
    region: storageFunctionRegion,
    timeoutSeconds: 120,
  },
  async (event) => {
    const object = event.data;
    const pathParts = parseOriginalMediaPath(object.name);

    if (!pathParts || !object.contentType?.startsWith("image/")) {
      return;
    }

    const bucket = getStorage().bucket(object.bucket);
    const sourceFile = bucket.file(object.name);
    const thumbnailPath = `families/${pathParts.familyId}/posts/${pathParts.postId}/media/${pathParts.mediaId}/thumb_960.jpg`;
    const tempOriginal = join(tmpdir(), `${pathParts.mediaId}-original`);
    const tempThumb = join(tmpdir(), `${pathParts.mediaId}-thumb.jpg`);

    await mkdir(dirname(tempOriginal), { recursive: true });
    await sourceFile.download({ destination: tempOriginal });

    await sharp(tempOriginal)
      .rotate()
      .resize({ width: 960, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(tempThumb);

    await bucket.upload(tempThumb, {
      destination: thumbnailPath,
      metadata: {
        contentType: "image/jpeg",
        metadata: {
          sourceMediaId: pathParts.mediaId,
        },
      },
    });

    await db
      .doc(
        `families/${pathParts.familyId}/posts/${pathParts.postId}/media/${pathParts.mediaId}`,
      )
      .set(
        {
          thumbnailStoragePath: thumbnailPath,
          thumbnailStatus: "ready",
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

    await Promise.allSettled([unlink(tempOriginal), unlink(tempThumb)]);
    logger.info("Generated image thumbnail", { thumbnailPath });
  },
);
