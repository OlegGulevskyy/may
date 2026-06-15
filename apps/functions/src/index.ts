import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import sharp from "sharp";

initializeApp();

const firestoreDatabaseId = "may-default";
const db = getFirestore(firestoreDatabaseId);
const storageFunctionRegion = "us-east1";
const googleOauthClientId = defineString("GOOGLE_OAUTH_CLIENT_ID");
const googleOauthClientSecret = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");
const googleDeliveryScopes = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.file",
] as const;

type GoogleDeliveryScope = (typeof googleDeliveryScopes)[number];

type GoogleDeliveryGrantRequest = {
  createdAt?: unknown;
  createdBy?: unknown;
  googleEmail?: unknown;
  familyId?: unknown;
  serverAuthCode?: unknown;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleDeliveryPrivateState = {
  googleEmail?: unknown;
  refreshToken?: unknown;
  status?: unknown;
};

type GoogleDriveFile = {
  id?: string;
  name?: string;
  webContentLink?: string;
  webViewLink?: string;
  error?: {
    message?: string;
  };
};

type GoogleGmailMessage = {
  id?: string;
  threadId?: string;
  error?: {
    message?: string;
  };
};

type MemoryMedia = {
  id?: unknown;
  kind?: unknown;
  uri?: unknown;
  thumbnailUri?: unknown;
  storagePath?: unknown;
  thumbnailStoragePath?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  durationMs?: unknown;
  width?: unknown;
  height?: unknown;
};

type MemoryPost = {
  authorId?: unknown;
  body?: unknown;
  createdAt?: unknown;
  deliveredAt?: unknown;
  errorMessage?: unknown;
  familyId?: unknown;
  media?: unknown;
  status?: unknown;
  updatedAt?: unknown;
};

type DeliveredDriveFile = {
  id: string;
  mediaId: string;
  name: string;
  webContentLink?: string;
  webViewLink?: string;
};

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

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }

  return value.trim();
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const isDeliveryReadyStatus = (status: unknown) =>
  status === "synced" || status === "stored";

const isNonEmptyPost = (post: MemoryPost) =>
  optionalString(post.body) || normalizePostMedia(post.media).length > 0;

const normalizePostMedia = (value: unknown): MemoryMedia[] =>
  Array.isArray(value) ? (value as MemoryMedia[]) : [];

const sanitizeHeaderValue = (value: string) =>
  value.replace(/[\r\n]+/g, " ").trim();

const encodeHeader = (value: string) =>
  `=?UTF-8?B?${Buffer.from(sanitizeHeaderValue(value), "utf8").toString("base64")}?=`;

const base64UrlEncode = (value: string) =>
  Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const fileNameFromStoragePath = (storagePath: string) =>
  storagePath.split("/").filter(Boolean).at(-1) ?? "memory";

const fileNameFromMedia = (media: MemoryMedia, index: number) => {
  const explicitName = optionalString(media.fileName);
  if (explicitName) {
    return sanitizeHeaderValue(explicitName);
  }

  const storagePath = optionalString(media.storagePath);
  if (storagePath) {
    const storageFileName = fileNameFromStoragePath(storagePath);
    if (storageFileName !== "original") {
      return sanitizeHeaderValue(storageFileName);
    }
  }

  const kind = optionalString(media.kind) ?? "file";
  const mediaId = optionalString(media.id) ?? String(index + 1);
  return `may-${kind}-${mediaId}`;
};

const assertGoogleJsonResponse = async <T extends { error?: unknown }>(
  response: Response,
  fallbackMessage: string,
) => {
  const json = (await response.json()) as T;

  if (!response.ok || json.error) {
    const error = json.error;
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : fallbackMessage;
    throw new Error(message);
  }

  return json;
};

const exchangeGoogleServerAuthCode = async (serverAuthCode: string) => {
  const clientId = googleOauthClientId.value();
  const clientSecret = googleOauthClientSecret.value();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: serverAuthCode,
    grant_type: "authorization_code",
    redirect_uri: "",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const tokenResponse = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || tokenResponse.error) {
    logger.warn("Google OAuth token exchange failed", {
      error: tokenResponse.error,
      status: response.status,
    });
    throw new Error(
      tokenResponse.error_description ??
        "Google did not accept the permission grant.",
    );
  }

  return tokenResponse;
};

const refreshGoogleAccessToken = async (refreshToken: string) => {
  const clientId = googleOauthClientId.value();
  const clientSecret = googleOauthClientSecret.value();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const tokenResponse = (await response.json()) as GoogleTokenResponse;

  if (!response.ok || tokenResponse.error) {
    logger.warn("Google OAuth refresh failed", {
      error: tokenResponse.error,
      status: response.status,
    });
    throw new Error(
      tokenResponse.error_description ??
        "Google did not refresh the delivery permission.",
    );
  }

  const accessToken = optionalString(tokenResponse.access_token);
  if (!accessToken) {
    throw new Error("Google did not return an access token.");
  }

  return accessToken;
};

const scopesFromTokenResponse = (tokenResponse: GoogleTokenResponse) =>
  new Set(
    String(tokenResponse.scope ?? "")
      .split(/\s+/)
      .filter(Boolean),
  );

const validateGoogleDeliveryScopes = (grantedScopes: Set<string>) => {
  const missingScopes = googleDeliveryScopes.filter(
    (scope) => !grantedScopes.has(scope),
  );
  if (missingScopes.length > 0) {
    throw new Error("Google did not grant all requested delivery permissions.");
  }
};

const markGoogleDeliveryNeedsReconnect = async ({
  connectedBy,
  familyId,
  googleEmail,
}: {
  connectedBy: string;
  familyId: string;
  googleEmail: string;
}) => {
  const now = new Date().toISOString();
  await db.doc(`families/${familyId}`).set(
    {
      deliveryConnection: {
        status: "needs_reconnect",
        googleEmail,
        scopes: [],
        connectedBy,
        connectedAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );
};

const buildMemoryEmailText = ({
  authorName,
  childName,
  driveFiles,
  post,
}: {
  authorName: string;
  childName: string;
  driveFiles: DeliveredDriveFile[];
  post: MemoryPost;
}) => {
  const lines = [
    `${authorName} sent a memory for ${childName}.`,
    "",
    optionalString(post.body) ?? "",
  ].filter((line, index) => index < 2 || line.length > 0);

  if (driveFiles.length > 0) {
    lines.push("", "Files:");
    driveFiles.forEach((file, index) => {
      lines.push(
        `${index + 1}. ${file.name}: ${file.webViewLink ?? file.webContentLink ?? `https://drive.google.com/file/d/${file.id}/view`}`,
      );
    });
  }

  lines.push("", "Sent by May.");
  return lines.join("\n");
};

const sendMemoryEmail = async ({
  accessToken,
  authorName,
  childEmail,
  childName,
  driveFiles,
  fromEmail,
  post,
}: {
  accessToken: string;
  authorName: string;
  childEmail: string;
  childName: string;
  driveFiles: DeliveredDriveFile[];
  fromEmail: string;
  post: MemoryPost;
}) => {
  const subject = `New memory for ${childName}`;
  const text = buildMemoryEmailText({
    authorName,
    childName,
    driveFiles,
    post,
  });
  const rawMessage = [
    `From: ${encodeHeader("May")} <${sanitizeHeaderValue(fromEmail)}>`,
    `To: ${sanitizeHeaderValue(childEmail)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
  ].join("\r\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      body: JSON.stringify({
        raw: base64UrlEncode(rawMessage),
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  return assertGoogleJsonResponse<GoogleGmailMessage>(
    response,
    "Google did not send the email.",
  );
};

const uploadMediaToDrive = async ({
  accessToken,
  familyId,
  index,
  media,
  postId,
}: {
  accessToken: string;
  familyId: string;
  index: number;
  media: MemoryMedia;
  postId: string;
}): Promise<DeliveredDriveFile> => {
  const storagePath = requireString(media.storagePath, "media.storagePath");
  const bucket = getStorage().bucket();
  const file = bucket.file(storagePath);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  const mimeType =
    optionalString(media.mimeType) ??
    optionalString(metadata.contentType) ??
    "application/octet-stream";
  const name = fileNameFromMedia(media, index);

  const startResponse = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink",
    {
      body: JSON.stringify({
        appProperties: {
          familyId,
          mediaId: optionalString(media.id) ?? "",
          postId,
          source: "may",
        },
        name,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(buffer.length),
        "X-Upload-Content-Type": mimeType,
      },
      method: "POST",
    },
  );

  if (!startResponse.ok) {
    await assertGoogleJsonResponse<GoogleDriveFile>(
      startResponse,
      "Google Drive did not start the upload.",
    );
  }

  const uploadUrl = startResponse.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Google Drive did not return an upload URL.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    body: buffer,
    headers: {
      "Content-Length": String(buffer.length),
      "Content-Type": mimeType,
    },
    method: "PUT",
  });

  const driveFile = await assertGoogleJsonResponse<GoogleDriveFile>(
    uploadResponse,
    "Google Drive did not upload the file.",
  );
  const fileId = requireString(driveFile.id, "driveFile.id");

  return {
    id: fileId,
    mediaId: optionalString(media.id) ?? String(index + 1),
    name: optionalString(driveFile.name) ?? name,
    webContentLink: optionalString(driveFile.webContentLink),
    webViewLink: optionalString(driveFile.webViewLink),
  };
};

const shareDriveFileWithChild = async ({
  accessToken,
  childEmail,
  fileId,
}: {
  accessToken: string;
  childEmail: string;
  fileId: string;
}) => {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`,
    {
      body: JSON.stringify({
        emailAddress: childEmail,
        role: "reader",
        type: "user",
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  await assertGoogleJsonResponse<{ error?: { message?: string } }>(
    response,
    "Google Drive did not share the file.",
  );
};

const deliverMemoryPost = async ({
  familyId,
  post,
  postId,
}: {
  familyId: string;
  post: MemoryPost;
  postId: string;
}) => {
  const [familySnap, privateSnap] = await Promise.all([
    db.doc(`families/${familyId}`).get(),
    db.doc(`families/${familyId}/private/googleDelivery`).get(),
  ]);

  if (!familySnap.exists) {
    throw new Error("Family was not found.");
  }

  const family = familySnap.data() ?? {};
  const childEmail = requireString(family.childEmail, "childEmail");
  const childName = requireString(family.childName, "childName");
  const privateState = privateSnap.data() as
    | GoogleDeliveryPrivateState
    | undefined;

  if (!privateSnap.exists || privateState?.status !== "connected") {
    throw new Error("Google delivery is not connected.");
  }

  const refreshToken = requireString(
    privateState.refreshToken,
    "googleDelivery.refreshToken",
  );
  const fromEmail = requireString(
    privateState.googleEmail,
    "googleDelivery.googleEmail",
  );
  const accessToken = await refreshGoogleAccessToken(refreshToken);
  const media = normalizePostMedia(post.media);
  const driveFiles = [];

  for (const [index, item] of media.entries()) {
    const driveFile = await uploadMediaToDrive({
      accessToken,
      familyId,
      index,
      media: item,
      postId,
    });
    await shareDriveFileWithChild({
      accessToken,
      childEmail,
      fileId: driveFile.id,
    });
    driveFiles.push(driveFile);
  }

  const authorId = optionalString(post.authorId);
  const authorSnap = authorId
    ? await db.doc(`families/${familyId}/members/${authorId}`).get()
    : undefined;
  const authorName =
    optionalString(authorSnap?.data()?.displayName) ?? "Someone";
  const gmailMessage = await sendMemoryEmail({
    accessToken,
    authorName,
    childEmail,
    childName,
    driveFiles,
    fromEmail,
    post,
  });

  return {
    driveFiles,
    gmailMessageId: optionalString(gmailMessage.id),
    gmailThreadId: optionalString(gmailMessage.threadId),
  };
};

export const processGoogleDeliveryGrantRequest = onDocumentCreated(
  {
    database: firestoreDatabaseId,
    document: "families/{familyId}/deliveryGrantRequests/{requestId}",
    region: storageFunctionRegion,
    secrets: [googleOauthClientSecret],
    timeoutSeconds: 30,
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }

    const request = snapshot.data() as GoogleDeliveryGrantRequest;
    const familyId = requireString(event.params.familyId, "familyId");
    const createdBy = requireString(request.createdBy, "createdBy");
    const googleEmail = requireString(request.googleEmail, "googleEmail");
    const serverAuthCode = requireString(
      request.serverAuthCode,
      "serverAuthCode",
    );

    try {
      const memberRef = db.doc(`families/${familyId}/members/${createdBy}`);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) {
        throw new Error("Only family members can connect Google delivery.");
      }

      const tokenResponse = await exchangeGoogleServerAuthCode(serverAuthCode);
      const grantedScopes = scopesFromTokenResponse(tokenResponse);
      validateGoogleDeliveryScopes(grantedScopes);

      const privateRef = db.doc(`families/${familyId}/private/googleDelivery`);
      const existingPrivateSnap = await privateRef.get();
      const existingPrivate = existingPrivateSnap.exists
        ? existingPrivateSnap.data()
        : undefined;
      const existingRefreshToken = existingPrivate?.refreshToken;
      const refreshToken =
        tokenResponse.refresh_token ??
        (typeof existingRefreshToken === "string"
          ? existingRefreshToken
          : undefined);

      if (!refreshToken) {
        throw new Error(
          "Google did not return a refresh token. Revoke May in your Google Account permissions, then connect again.",
        );
      }

      const now = new Date().toISOString();
      const scopes = googleDeliveryScopes.filter((scope) =>
        grantedScopes.has(scope),
      );
      const connection = {
        status: "connected",
        googleEmail,
        scopes,
        connectedBy: createdBy,
        connectedAt:
          typeof existingPrivate?.connectedAt === "string"
            ? existingPrivate.connectedAt
            : now,
        updatedAt: now,
      } satisfies {
        status: "connected";
        googleEmail: string;
        scopes: GoogleDeliveryScope[];
        connectedBy: string;
        connectedAt: string;
        updatedAt: string;
      };

      await Promise.all([
        privateRef.set(
          {
            ...connection,
            refreshToken,
            tokenType: tokenResponse.token_type ?? "Bearer",
          },
          { merge: true },
        ),
        db.doc(`families/${familyId}`).set(
          {
            deliveryConnection: connection,
            updatedAt: now,
          },
          { merge: true },
        ),
      ]);

      logger.info("Connected Google delivery", {
        familyId,
        uid: createdBy,
      });
    } catch (error) {
      logger.error("Google delivery grant request failed", {
        error: error instanceof Error ? error.message : String(error),
        familyId,
      });
      await markGoogleDeliveryNeedsReconnect({
        connectedBy: createdBy,
        familyId,
        googleEmail,
      }).catch((writeError) =>
        logger.error("Failed to mark Google delivery reconnect state", {
          error:
            writeError instanceof Error
              ? writeError.message
              : String(writeError),
          familyId,
        }),
      );
    } finally {
      await snapshot.ref.delete().catch((error) =>
        logger.warn("Failed to delete Google delivery grant request", {
          error: error instanceof Error ? error.message : String(error),
          familyId,
        }),
      );
    }
  },
);

export const deliverMemoryPostToGoogle = onDocumentWritten(
  {
    database: firestoreDatabaseId,
    document: "families/{familyId}/posts/{postId}",
    memory: "1GiB",
    region: storageFunctionRegion,
    secrets: [googleOauthClientSecret],
    timeoutSeconds: 300,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) {
      return;
    }

    const familyId = requireString(event.params.familyId, "familyId");
    const postId = requireString(event.params.postId, "postId");
    const postRef = db.doc(`families/${familyId}/posts/${postId}`);
    const post = after.data() as MemoryPost;

    if (
      !isDeliveryReadyStatus(post.status) ||
      post.deliveredAt ||
      !isNonEmptyPost(post)
    ) {
      return;
    }

    const claimed = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(postRef);
      if (!snapshot.exists) {
        return false;
      }

      const current = snapshot.data() as MemoryPost;
      if (
        !isDeliveryReadyStatus(current.status) ||
        current.deliveredAt ||
        !isNonEmptyPost(current)
      ) {
        return false;
      }

      transaction.set(
        postRef,
        {
          deliveryStartedAt: new Date().toISOString(),
          errorMessage: FieldValue.delete(),
          status: "emailing",
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      return true;
    });

    if (!claimed) {
      return;
    }

    try {
      const currentSnap = await postRef.get();
      const currentPost = currentSnap.data() as MemoryPost;
      const delivery = await deliverMemoryPost({
        familyId,
        post: currentPost,
        postId,
      });
      const now = new Date().toISOString();

      await postRef.set(
        {
          deliveredAt: now,
          deliveryFinishedAt: now,
          driveFiles: delivery.driveFiles,
          errorMessage: FieldValue.delete(),
          gmailMessageId: delivery.gmailMessageId,
          gmailThreadId: delivery.gmailThreadId,
          status: "delivered",
          updatedAt: now,
        },
        { merge: true },
      );

      logger.info("Delivered memory post to Google", {
        driveFileCount: delivery.driveFiles.length,
        familyId,
        postId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await postRef.set(
        {
          deliveryFinishedAt: new Date().toISOString(),
          errorMessage: message,
          status: "failed",
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      logger.error("Memory post Google delivery failed", {
        error: message,
        familyId,
        postId,
      });
    }
  },
);

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
