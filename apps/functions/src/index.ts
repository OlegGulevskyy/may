import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { google } from "googleapis";
import sharp from "sharp";

import { isPostReadyForDelivery, type MemoryPost } from "@may/core";

initializeApp();

const babyGmailAddress = defineString("BABY_GMAIL_ADDRESS");
const driveFolderId = defineString("GOOGLE_DRIVE_FOLDER_ID");
const googleClientId = defineString("GOOGLE_OAUTH_CLIENT_ID");
const googleClientSecret = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const googleRefreshToken = defineSecret("GOOGLE_OAUTH_REFRESH_TOKEN");

const db = getFirestore();
const functionRegion = "europe-west1";

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
    region: functionRegion,
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

export const enqueuePostDelivery = onDocumentWritten(
  {
    document: "families/{familyId}/posts/{postId}",
    region: functionRegion,
  },
  async (event) => {
    const after = event.data?.after.data() as MemoryPost | undefined;

    if (!after || !isPostReadyForDelivery(after)) {
      return;
    }

    const postRef = db.doc(event.data!.after.ref.path);
    await postRef.set(
      {
        status: "emailing",
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    const queue = getFunctions().taskQueue("deliverMemoryEmail");
    const targetUri = await getFunctionUrl("deliverMemoryEmail");
    await queue.enqueue(
      {
        familyId: event.params.familyId,
        postId: event.params.postId,
      },
      {
        dispatchDeadlineSeconds: 300,
        uri: targetUri,
      },
    );

    logger.info("Queued post for Gmail/Drive delivery", {
      familyId: event.params.familyId,
      postId: event.params.postId,
    });
  },
);

export const deliverMemoryEmail = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 60,
      maxBackoffSeconds: 600,
    },
    rateLimits: {
      maxConcurrentDispatches: 2,
    },
    region: functionRegion,
    secrets: [googleClientSecret, googleRefreshToken],
  },
  async (req) => {
    const { familyId, postId } = req.data as {
      familyId?: string;
      postId?: string;
    };

    if (!familyId || !postId) {
      throw new Error("deliverMemoryEmail requires familyId and postId.");
    }

    const postRef = db.doc(`families/${familyId}/posts/${postId}`);
    const postSnap = await postRef.get();
    const post = postSnap.data() as MemoryPost | undefined;

    if (!post) {
      throw new Error(`Post ${postId} does not exist.`);
    }

    const auth = new google.auth.OAuth2(
      googleClientId.value(),
      googleClientSecret.value(),
    );
    auth.setCredentials({ refresh_token: googleRefreshToken.value() });

    const drive = google.drive({ version: "v3", auth });
    const gmail = google.gmail({ version: "v1", auth });

    const uploadSummaryPath = join(tmpdir(), `${postId}-summary.txt`);
    await writeFile(uploadSummaryPath, post.body || "Memory media update");

    const driveFile = await drive.files.create({
      requestBody: {
        name: `${post.createdAt.slice(0, 10)}-${postId}.txt`,
        parents: driveFolderId.value() ? [driveFolderId.value()] : undefined,
      },
      media: {
        mimeType: "text/plain",
        body: createReadStream(uploadSummaryPath),
      },
      fields: "id, webViewLink",
    });

    const message = [
      `To: ${babyGmailAddress.value()}`,
      "Subject: A new memory for you",
      "Content-Type: text/plain; charset=utf-8",
      "",
      post.body || "We saved a new memory for you.",
      "",
      driveFile.data.webViewLink
        ? `Drive copy: ${driveFile.data.webViewLink}`
        : "Drive copy created.",
    ].join("\n");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: Buffer.from(message).toString("base64url"),
      },
    });

    await postRef.set(
      {
        status: "delivered",
        deliveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    await unlink(uploadSummaryPath);
  },
);

const getFunctionUrl = async (name: string) => {
  const auth = new google.auth.GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });
  const projectId = await auth.getProjectId();
  const client = await auth.getClient();
  const url =
    `https://cloudfunctions.googleapis.com/v2/projects/${projectId}` +
    `/locations/${functionRegion}/functions/${name}`;
  const response = await client.request<{
    serviceConfig?: { uri?: string };
  }>({ url });
  const uri = response.data.serviceConfig?.uri;

  if (!uri) {
    throw new Error(`Unable to resolve deployed function URI for ${name}.`);
  }

  return uri;
};
