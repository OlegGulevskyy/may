import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";

import { createElement, type ReactNode } from "react";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  type DocumentReference,
  FieldValue,
  getFirestore,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  render,
} from "react-email";
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

type GoogleDeliveryConnectionStatus = "connected" | "needs_reconnect";

type GoogleDeliveryConnection = {
  status: GoogleDeliveryConnectionStatus;
  googleEmail: string;
  scopes: GoogleDeliveryScope[];
  connectedBy: string;
  connectedAt: string;
  updatedAt: string;
};

type GoogleDeliveryPrivateState = {
  connectedAt?: unknown;
  connectedBy?: unknown;
  googleEmail?: unknown;
  refreshToken?: unknown;
  scopes?: unknown;
  status?: unknown;
  updatedAt?: unknown;
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

type OriginalMediaPlaybackSource = {
  expiresInSeconds?: number;
  headers: Record<string, string>;
  uri: string;
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
  originalStorage?: unknown;
  storagePath?: unknown;
  thumbnailStoragePath?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  durationMs?: unknown;
  width?: unknown;
  height?: unknown;
};

type GoogleDriveOriginalStorage = {
  fileId: string;
  name: string;
  provider: "googleDrive";
  webContentLink?: string;
  webViewLink?: string;
};

type MemoryRichTextMark = {
  type?: unknown;
  attrs?: unknown;
};

type MemoryRichTextNode = {
  type?: unknown;
  attrs?: unknown;
  content?: unknown;
  marks?: unknown;
  text?: unknown;
};

type MemoryRichTextDocument = {
  type?: unknown;
  content?: unknown;
};

type MemoryPost = {
  authorId?: unknown;
  body?: unknown;
  comments?: unknown;
  content?: unknown;
  contentImageMap?: unknown;
  createdAt?: unknown;
  deliveredAt?: unknown;
  emailSubject?: unknown;
  errorMessage?: unknown;
  familyId?: unknown;
  media?: unknown;
  reactions?: unknown;
  status?: unknown;
  updatedAt?: unknown;
};

type MemoryComment = {
  authorId?: unknown;
  body?: unknown;
  createdAt?: unknown;
  id?: unknown;
};

type DeliveredDriveFile = {
  id: string;
  mediaId: string;
  name: string;
  webContentLink?: string;
  webViewLink?: string;
};

type UploadedDriveFile = DeliveredDriveFile & {
  content?: Buffer;
  mediaKind?: string;
  mimeType: string;
};

type EmailLinkedFile = DeliveredDriveFile & {
  mediaKind?: string;
};

type InlineEmailImage = {
  cid: string;
  content: Buffer;
  fileName: string;
  mediaId: string;
  mimeType: string;
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

const optionalHttpUrl = (value: unknown) => {
  const candidate = optionalString(value);
  if (!candidate) {
    return undefined;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const normalizeEmailRecipients = (value: unknown) => {
  const values = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();

  return values
    .map(optionalString)
    .filter((email): email is string => Boolean(email))
    .filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

const normalizeFamilyDeliveryCcEmails = (family: Record<string, unknown>) =>
  normalizeEmailRecipients([
    ...(Array.isArray(family.deliveryCcEmails) ? family.deliveryCcEmails : []),
    family.deliveryCcEmail,
  ]);

const isDeliveryReadyStatus = (status: unknown) =>
  status === "synced" || status === "stored";

const isNonEmptyPost = (post: MemoryPost) =>
  optionalString(post.body) ||
  richTextPlainText(normalizeRichTextDocument(post.content)) ||
  richTextImageSources(normalizeRichTextDocument(post.content)).length > 0 ||
  normalizePostMedia(post.media).length > 0;

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

const base64MimeEncode = (value: Buffer) =>
  value
    .toString("base64")
    .replace(/.{1,76}/g, (line) => `${line}\r\n`)
    .trimEnd();

const contentTypeBoundary = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

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
  return `memory-${kind}-${mediaId}`;
};

const normalizeRichTextNode = (value: unknown): MemoryRichTextNode | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const node = value as MemoryRichTextNode;
  return typeof node.type === "string" ? node : null;
};

const normalizeRichTextChildren = (value: unknown): MemoryRichTextNode[] =>
  Array.isArray(value)
    ? value
        .map(normalizeRichTextNode)
        .filter((node): node is MemoryRichTextNode => Boolean(node))
    : [];

const normalizeRichTextDocument = (
  value: unknown,
): MemoryRichTextDocument | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const document = value as MemoryRichTextDocument;
  return document.type === "doc" ? document : undefined;
};

const normalizeContentImageMap = (value: unknown) =>
  value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

const richTextImageSources = (content?: MemoryRichTextDocument): string[] => {
  const sources: string[] = [];

  const visit = (node: MemoryRichTextNode) => {
    const attrs =
      node.attrs && typeof node.attrs === "object" ? node.attrs : {};
    const source =
      "src" in attrs && typeof attrs.src === "string" ? attrs.src : "";
    if (node.type === "image" && source) {
      sources.push(source);
    }
    normalizeRichTextChildren(node.content).forEach(visit);
  };

  normalizeRichTextChildren(content?.content).forEach(visit);
  return sources;
};

const richTextPlainText = (content?: MemoryRichTextDocument) => {
  const visit = (node: MemoryRichTextNode): string => {
    if (typeof node.text === "string") {
      return node.text;
    }

    const children = normalizeRichTextChildren(node.content)
      .map(visit)
      .join("");

    switch (node.type) {
      case "hardBreak":
        return "\n";
      case "paragraph":
      case "heading":
      case "blockquote":
        return children ? `${children}\n` : "\n";
      case "bulletList":
      case "orderedList":
        return children ? `${children}\n` : "";
      case "image":
        return "";
      default:
        return children;
    }
  };

  return normalizeRichTextChildren(content?.content).map(visit).join("").trim();
};

type NormalizedMemoryComment = {
  authorId: string;
  body: string;
  id: string;
};

type FamilyMemberSummary = {
  displayName: string;
  id: string;
};

type MemoryActivityNotification = {
  actorId: string;
  body: string;
  data: Record<string, string>;
  title: string;
};

type RegisteredPushToken = {
  memberId: string;
  ref: DocumentReference;
  token: string;
};

type ExpoPushMessage = {
  body: string;
  data: Record<string, string>;
  sound: "default";
  title: string;
  to: string;
};

type PendingExpoPushMessage = ExpoPushMessage & {
  tokenRef: DocumentReference;
};

type ExpoPushTicket = {
  details?: {
    error?: string;
  };
  id?: string;
  message?: string;
  status?: string;
};

const expoPushSendUrl = "https://exp.host/--/api/v2/push/send";
const expoPushChunkSize = 100;

const truncatePreview = (value: string, maxLength = 140) => {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const normalizeMemoryComments = (value: unknown): NormalizedMemoryComment[] =>
  Array.isArray(value)
    ? value
        .map((item): NormalizedMemoryComment | null => {
          const comment = item as MemoryComment;
          const id = optionalString(comment.id);
          const authorId = optionalString(comment.authorId);
          const body = optionalString(comment.body);

          return id && authorId && body ? { authorId, body, id } : null;
        })
        .filter((comment): comment is NormalizedMemoryComment =>
          Boolean(comment),
        )
    : [];

const normalizeReactionMap = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([reaction, authors]) => [
        reaction,
        Array.isArray(authors)
          ? authors
              .map(optionalString)
              .filter((author): author is string => Boolean(author))
          : [],
      ])
      .filter(([, authors]) => authors.length > 0),
  ) as Record<string, string[]>;
};

const memoryLabelForActivity = ({
  actorId,
  authorId,
  authorName,
}: {
  actorId: string;
  authorId?: string;
  authorName: string;
}) => {
  if (!authorId) {
    return "a memory";
  }

  return authorId === actorId ? "their memory" : `${authorName}'s memory`;
};

const memberName = (
  membersById: Map<string, FamilyMemberSummary>,
  memberId: string,
) => membersById.get(memberId)?.displayName ?? "Someone";

const postTextPreview = (post: MemoryPost) =>
  truncatePreview(
    richTextPlainText(normalizeRichTextDocument(post.content)) ||
      optionalString(post.body) ||
      "Open the family wall.",
  );

const buildPostActivityNotifications = ({
  after,
  before,
  familyId,
  membersById,
  postId,
}: {
  after: MemoryPost;
  before: MemoryPost;
  familyId: string;
  membersById: Map<string, FamilyMemberSummary>;
  postId: string;
}): MemoryActivityNotification[] => {
  const notifications: MemoryActivityNotification[] = [];
  const authorId = optionalString(after.authorId);
  const authorName = authorId ? memberName(membersById, authorId) : "Someone";
  const beforeCommentIds = new Set(
    normalizeMemoryComments(before.comments).map((comment) => comment.id),
  );
  const newComments = normalizeMemoryComments(after.comments).filter(
    (comment) => !beforeCommentIds.has(comment.id),
  );

  for (const comment of newComments) {
    const actorName = memberName(membersById, comment.authorId);
    const memoryLabel = memoryLabelForActivity({
      actorId: comment.authorId,
      authorId,
      authorName,
    });

    notifications.push({
      actorId: comment.authorId,
      body: truncatePreview(comment.body),
      data: {
        actorId: comment.authorId,
        commentId: comment.id,
        familyId,
        postId,
        type: "comment",
      },
      title: `${actorName} commented on ${memoryLabel}`,
    });
  }

  const beforeReactions = normalizeReactionMap(before.reactions);
  const afterReactions = normalizeReactionMap(after.reactions);
  const beforeHeartAuthors = new Set(beforeReactions.heart ?? []);

  for (const actorId of afterReactions.heart ?? []) {
    if (beforeHeartAuthors.has(actorId)) {
      continue;
    }

    const actorName = memberName(membersById, actorId);
    const memoryLabel = memoryLabelForActivity({
      actorId,
      authorId,
      authorName,
    });

    notifications.push({
      actorId,
      body: postTextPreview(after),
      data: {
        actorId,
        familyId,
        postId,
        reaction: "heart",
        type: "like",
      },
      title: `${actorName} liked ${memoryLabel}`,
    });
  }

  return notifications;
};

const postActivityFieldsChanged = (before: MemoryPost, after: MemoryPost) =>
  JSON.stringify(before.comments ?? []) !==
    JSON.stringify(after.comments ?? []) ||
  JSON.stringify(before.reactions ?? {}) !==
    JSON.stringify(after.reactions ?? {});

const fetchFamilyMemberSummaries = async (familyId: string) => {
  const membersSnap = await db.collection(`families/${familyId}/members`).get();

  return new Map(
    membersSnap.docs.map((member) => [
      member.id,
      {
        displayName: optionalString(member.data().displayName) ?? "Someone",
        id: member.id,
      },
    ]),
  );
};

const isExpoPushToken = (token: string) =>
  /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

const fetchRegisteredPushTokens = async ({
  familyId,
  memberIds,
}: {
  familyId: string;
  memberIds: string[];
}): Promise<RegisteredPushToken[]> => {
  const tokenLists = await Promise.all(
    memberIds.map(async (memberId) => {
      const tokensSnap = await db
        .collection(`families/${familyId}/members/${memberId}/pushTokens`)
        .get();

      return tokensSnap.docs
        .map((tokenDoc): RegisteredPushToken | null => {
          const token = optionalString(tokenDoc.data().token);

          return token && isExpoPushToken(token)
            ? { memberId, ref: tokenDoc.ref, token }
            : null;
        })
        .filter((token): token is RegisteredPushToken => Boolean(token));
    }),
  );

  const byToken = new Map<string, RegisteredPushToken>();
  tokenLists.flat().forEach((token) => byToken.set(token.token, token));
  return [...byToken.values()];
};

const deletePushTokenRefs = async (refs: DocumentReference[]) => {
  await Promise.allSettled(refs.map((ref) => ref.delete()));
};

const sendExpoPushMessages = async (messages: PendingExpoPushMessage[]) => {
  const staleTokenRefs: DocumentReference[] = [];

  for (let index = 0; index < messages.length; index += expoPushChunkSize) {
    const chunk = messages.slice(index, index + expoPushChunkSize);
    const response = await fetch(expoPushSendUrl, {
      body: JSON.stringify(
        chunk.map(({ tokenRef: _tokenRef, ...message }) => message),
      ),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch((error) => {
      logger.warn("Expo push send failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });

    if (!response) {
      continue;
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: ExpoPushTicket[] | ExpoPushTicket;
      errors?: unknown;
    };
    const tickets = Array.isArray(body.data)
      ? body.data
      : body.data
        ? [body.data]
        : [];

    if (!response.ok) {
      logger.warn("Expo push send returned an error", {
        errors: body.errors,
        status: response.status,
      });
      continue;
    }

    tickets.forEach((ticket, ticketIndex) => {
      if (ticket.status !== "error") {
        return;
      }

      const message = chunk[ticketIndex];
      logger.warn("Expo push ticket failed", {
        error: ticket.details?.error,
        message: ticket.message,
      });

      if (ticket.details?.error === "DeviceNotRegistered" && message) {
        staleTokenRefs.push(message.tokenRef);
      }
    });
  }

  if (staleTokenRefs.length > 0) {
    await deletePushTokenRefs(staleTokenRefs);
  }
};

const sendMemoryActivityNotifications = async ({
  familyId,
  memberIds,
  notifications,
  postId,
}: {
  familyId: string;
  memberIds: string[];
  notifications: MemoryActivityNotification[];
  postId: string;
}) => {
  const possibleRecipientIds = memberIds.filter((memberId) =>
    notifications.some((notification) => notification.actorId !== memberId),
  );

  if (possibleRecipientIds.length === 0) {
    return;
  }

  const tokens = await fetchRegisteredPushTokens({
    familyId,
    memberIds: possibleRecipientIds,
  });
  const messages = notifications.flatMap((notification) =>
    tokens
      .filter((token) => token.memberId !== notification.actorId)
      .map(
        (token): PendingExpoPushMessage => ({
          body: notification.body,
          data: notification.data,
          sound: "default",
          title: notification.title,
          to: token.token,
          tokenRef: token.ref,
        }),
      ),
  );

  if (messages.length === 0) {
    return;
  }

  await sendExpoPushMessages(messages);
  logger.info("Sent memory activity notifications", {
    familyId,
    notificationCount: notifications.length,
    postId,
    recipientDeviceCount: messages.length,
  });
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

const legacyGoogleDeliveryPrivateRef = (familyId: string) =>
  db.doc(`families/${familyId}/private/googleDelivery`);

const memberGoogleDeliveryPrivateRef = ({
  familyId,
  memberId,
}: {
  familyId: string;
  memberId: string;
}) => db.doc(`families/${familyId}/private/googleDelivery/users/${memberId}`);

const googleDeliveryPrivateStateFromSnapshot = (
  snapshot: DocumentSnapshot | undefined,
) =>
  snapshot?.exists
    ? ((snapshot.data() ?? {}) as GoogleDeliveryPrivateState)
    : undefined;

const legacyGoogleDeliveryStateForMember = ({
  legacyState,
  memberId,
}: {
  legacyState: GoogleDeliveryPrivateState | undefined;
  memberId: string;
}) => {
  if (optionalString(legacyState?.connectedBy) !== memberId) {
    return undefined;
  }

  return legacyState;
};

const connectedGoogleDeliveryPrivateStateForMember = async ({
  familyId,
  memberId,
}: {
  familyId: string;
  memberId: string;
}) => {
  const [privateSnap, legacyPrivateSnap] = await Promise.all([
    memberGoogleDeliveryPrivateRef({ familyId, memberId }).get(),
    legacyGoogleDeliveryPrivateRef(familyId).get(),
  ]);
  const memberPrivateState =
    googleDeliveryPrivateStateFromSnapshot(privateSnap);
  const legacyPrivateState = legacyGoogleDeliveryStateForMember({
    legacyState: googleDeliveryPrivateStateFromSnapshot(legacyPrivateSnap),
    memberId,
  });
  const privateState = memberPrivateState
    ? memberPrivateState.status === "connected"
      ? memberPrivateState
      : undefined
    : legacyPrivateState?.status === "connected"
      ? legacyPrivateState
      : undefined;

  if (!privateState) {
    throw new Error("The post author has not connected Google delivery.");
  }

  return privateState;
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
  const memberRef = db.doc(`families/${familyId}/members/${connectedBy}`);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    return;
  }

  const connection = {
    status: "needs_reconnect",
    googleEmail,
    scopes: [],
    connectedBy,
    connectedAt: now,
    updatedAt: now,
  } satisfies GoogleDeliveryConnection;

  await Promise.all([
    memberRef.set({ deliveryConnection: connection }, { merge: true }),
    memberGoogleDeliveryPrivateRef({ familyId, memberId: connectedBy }).set(
      connection,
      { merge: true },
    ),
  ]);
};

const emailStyles = {
  body: {
    backgroundColor: "#f5efe8",
    color: "#252d2b",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    margin: "0",
    padding: "28px 12px 36px",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid rgba(37,45,43,0.06)",
    borderRadius: "24px",
    margin: "0 auto",
    maxWidth: "560px",
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    display: "flex",
    padding: "20px 20px 10px",
  },
  avatar: {
    backgroundColor: "#252d2b",
    borderRadius: "999px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "16px",
    fontWeight: "800",
    height: "42px",
    lineHeight: "42px",
    marginRight: "12px",
    textAlign: "center" as const,
    width: "42px",
  },
  avatarImage: {
    borderRadius: "999px",
    display: "inline-block",
    height: "42px",
    marginRight: "12px",
    objectFit: "cover" as const,
    verticalAlign: "middle",
    width: "42px",
  },
  authorBlock: {
    display: "inline-block",
    verticalAlign: "middle",
  },
  author: {
    color: "#252d2b",
    fontSize: "16px",
    fontWeight: "800",
    lineHeight: "20px",
    margin: "0",
  },
  letter: {
    padding: "8px 20px 22px",
  },
  paragraph: {
    color: "#252d2b",
    fontSize: "15px",
    fontWeight: "600",
    lineHeight: "22px",
    margin: "0 0 18px",
  },
  heading: {
    color: "#252d2b",
    fontSize: "19px",
    fontWeight: "800",
    lineHeight: "25px",
    margin: "8px 0 14px",
  },
  quote: {
    borderLeft: "3px solid #9db9a5",
    margin: "0 0 16px",
    paddingLeft: "14px",
  },
  list: {
    color: "#252d2b",
    fontSize: "16px",
    lineHeight: "25px",
    margin: "0 0 16px",
    paddingLeft: "22px",
  },
  image: {
    borderRadius: "16px",
    display: "block",
    height: "auto",
    margin: "10px 0 20px",
    maxWidth: "100%",
    width: "100%",
  },
  link: {
    color: "#5b7e66",
  },
  files: {
    borderTop: "1px solid rgba(37,45,43,0.08)",
    marginTop: "4px",
    paddingTop: "14px",
  },
  fileText: {
    color: "rgba(37,45,43,0.72)",
    fontSize: "14px",
    lineHeight: "21px",
    margin: "0 0 8px",
  },
  rule: {
    borderColor: "#eadfd2",
    margin: "18px 0",
  },
} as const;

const h = createElement;

const authorInitial = (authorName: string) =>
  authorName.trim().charAt(0).toUpperCase() || "?";

const friendlyFileLabel = (file: EmailLinkedFile, index: number) => {
  switch (file.mediaKind) {
    case "image":
      return `Photo ${index + 1}`;
    case "video":
      return `Video ${index + 1}`;
    case "audio":
      return `Voice note ${index + 1}`;
    default:
      return `Attachment ${index + 1}`;
  }
};

const contentImageMediaIds = ({
  content,
  contentImageMap,
  media,
}: {
  content?: MemoryRichTextDocument;
  contentImageMap: Record<string, string>;
  media: MemoryMedia[];
}) =>
  new Set(
    richTextImageSources(content)
      .map((source) => {
        const mapped = contentImageMap[source];
        if (mapped) {
          return mapped;
        }

        const item = media.find(
          (mediaItem) =>
            optionalString(mediaItem.kind) === "image" &&
            (optionalString(mediaItem.uri) === source ||
              optionalString(mediaItem.thumbnailUri) === source),
        );
        return optionalString(item?.id);
      })
      .filter((id): id is string => Boolean(id)),
  );

const isMarkType = (mark: MemoryRichTextMark, type: string) =>
  mark.type === type;

const nodeAttrs = (node: MemoryRichTextNode) =>
  node.attrs && typeof node.attrs === "object"
    ? (node.attrs as Record<string, unknown>)
    : {};

const nodeMarks = (node: MemoryRichTextNode): MemoryRichTextMark[] =>
  Array.isArray(node.marks)
    ? node.marks.filter((mark): mark is MemoryRichTextMark =>
        Boolean(mark && typeof mark === "object"),
      )
    : [];

const renderInlineEmailNodes = (
  nodes: MemoryRichTextNode[] = [],
): ReactNode[] =>
  nodes.flatMap((node, index): ReactNode[] => {
    if (node.type === "hardBreak") {
      return [h("br", { key: index })];
    }
    if (node.type !== "text") {
      return renderInlineEmailNodes(normalizeRichTextChildren(node.content));
    }

    const marks = nodeMarks(node);
    let child: ReactNode = String(node.text ?? "");

    if (marks.some((mark) => isMarkType(mark, "code"))) {
      child = h(
        "code",
        {
          key: `${index}-code`,
          style: {
            backgroundColor: "rgba(37,45,43,0.08)",
            borderRadius: "4px",
            padding: "1px 4px",
          },
        },
        child,
      );
    }
    if (marks.some((mark) => isMarkType(mark, "bold"))) {
      child = h("strong", { key: `${index}-bold` }, child);
    }
    if (marks.some((mark) => isMarkType(mark, "italic"))) {
      child = h("em", { key: `${index}-italic` }, child);
    }
    if (marks.some((mark) => isMarkType(mark, "strike"))) {
      child = h("s", { key: `${index}-strike` }, child);
    }

    const link = marks.find((mark) => isMarkType(mark, "link"));
    const linkAttrs =
      link?.attrs && typeof link.attrs === "object"
        ? (link.attrs as Record<string, unknown>)
        : {};
    const href = typeof linkAttrs.href === "string" ? linkAttrs.href : "";
    if (href) {
      child = h(
        Link,
        { href, key: `${index}-link`, style: emailStyles.link },
        child,
      );
    }

    return [h("span", { key: index }, child)];
  });

const renderEmailNode = ({
  contentImageMap,
  inlineImagesByMediaId,
  node,
}: {
  contentImageMap: Record<string, string>;
  inlineImagesByMediaId: Map<string, InlineEmailImage>;
  node: MemoryRichTextNode;
}): ReactNode => {
  const children = normalizeRichTextChildren(node.content);

  switch (node.type) {
    case "heading":
      return h(
        Heading,
        { as: "h2", style: emailStyles.heading },
        renderInlineEmailNodes(children),
      );
    case "paragraph":
      return h(
        Text,
        { style: emailStyles.paragraph },
        renderInlineEmailNodes(children),
      );
    case "blockquote":
      return h(
        Section,
        { style: emailStyles.quote },
        children.map((child, index) =>
          h(
            "div",
            { key: index },
            renderEmailNode({
              contentImageMap,
              inlineImagesByMediaId,
              node: child,
            }),
          ),
        ),
      );
    case "bulletList":
    case "orderedList": {
      const tag = node.type === "orderedList" ? "ol" : "ul";
      return h(
        tag,
        { style: emailStyles.list },
        children.map((child, index) =>
          h(
            "li",
            { key: index },
            normalizeRichTextChildren(child.content).map(
              (grandchild, childIndex) =>
                h(
                  "div",
                  { key: childIndex },
                  renderEmailNode({
                    contentImageMap,
                    inlineImagesByMediaId,
                    node: grandchild,
                  }),
                ),
            ),
          ),
        ),
      );
    }
    case "horizontalRule":
      return h(Hr, { style: emailStyles.rule });
    case "image": {
      const source = String(nodeAttrs(node).src ?? "");
      const mediaId = contentImageMap[source];
      const inline = mediaId ? inlineImagesByMediaId.get(mediaId) : undefined;
      if (!source && !inline) {
        return null;
      }
      return h(Img, {
        alt: "",
        src: inline ? `cid:${inline.cid}` : source,
        style: emailStyles.image,
      });
    }
    default:
      return children.map((child, index) =>
        h(
          "div",
          { key: index },
          renderEmailNode({
            contentImageMap,
            inlineImagesByMediaId,
            node: child,
          }),
        ),
      );
  }
};

const buildMemoryEmailText = ({
  content,
  linkedFiles,
  post,
}: {
  content?: MemoryRichTextDocument;
  linkedFiles: EmailLinkedFile[];
  post: MemoryPost;
}) => {
  const body = richTextPlainText(content) || optionalString(post.body) || "";
  const lines = body.length > 0 ? [body] : [];

  if (linkedFiles.length > 0) {
    lines.push("", "Attachments:");
    linkedFiles.forEach((file, index) => {
      lines.push(
        `${friendlyFileLabel(file, index)}: ${file.webViewLink ?? file.webContentLink ?? `https://drive.google.com/file/d/${file.id}/view`}`,
      );
    });
  }

  return lines.join("\n");
};

const buildMemoryEmailHtml = async ({
  authorName,
  authorPhotoURL,
  content,
  contentImageMap,
  inlineImages,
  linkedFiles,
  post,
}: {
  authorName: string;
  authorPhotoURL?: string;
  content?: MemoryRichTextDocument;
  contentImageMap: Record<string, string>;
  inlineImages: InlineEmailImage[];
  linkedFiles: EmailLinkedFile[];
  post: MemoryPost;
}) => {
  const inlineImagesByMediaId = new Map(
    inlineImages.map((image) => [image.mediaId, image]),
  );
  const bodyText =
    richTextPlainText(content) || optionalString(post.body) || "";
  const contentNodes = normalizeRichTextChildren(content?.content);
  const bodyNodes =
    contentNodes.length > 0
      ? contentNodes.map((node, index) =>
          h(
            "div",
            { key: index },
            renderEmailNode({ contentImageMap, inlineImagesByMediaId, node }),
          ),
        )
      : bodyText
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((paragraph, index) =>
            h(Text, { key: index, style: emailStyles.paragraph }, paragraph),
          );

  const template = h(
    Html,
    { lang: "en" },
    h(Head),
    h(Preview, null, bodyText.trim()),
    h(
      Body,
      { style: emailStyles.body },
      h(
        Container,
        { style: emailStyles.container },
        h(
          Section,
          { style: emailStyles.header },
          authorPhotoURL
            ? h(Img, {
                alt: `${authorName} profile picture`,
                src: authorPhotoURL,
                style: emailStyles.avatarImage,
              })
            : h(
                "span",
                { style: emailStyles.avatar },
                authorInitial(authorName),
              ),
          h(
            "span",
            { style: emailStyles.authorBlock },
            h(Text, { style: emailStyles.author }, authorName),
          ),
        ),
        h(
          Section,
          { style: emailStyles.letter },
          bodyNodes,
          linkedFiles.length > 0
            ? h(
                Section,
                { style: emailStyles.files },
                h(Text, { style: emailStyles.fileText }, "Attachments"),
                linkedFiles.map((file, index) =>
                  h(
                    Text,
                    { key: file.id, style: emailStyles.fileText },
                    h(
                      Link,
                      {
                        href:
                          file.webViewLink ??
                          file.webContentLink ??
                          `https://drive.google.com/file/d/${file.id}/view`,
                        style: emailStyles.link,
                      },
                      friendlyFileLabel(file, index),
                    ),
                  ),
                ),
              )
            : null,
        ),
      ),
    ),
  );

  return render(template);
};

const sendMemoryEmail = async ({
  accessToken,
  authorName,
  authorPhotoURL,
  childEmail,
  childName,
  ccEmails,
  driveFiles,
  fromEmail,
  post,
}: {
  accessToken: string;
  authorName: string;
  authorPhotoURL?: string;
  childEmail: string;
  childName: string;
  ccEmails: string[];
  driveFiles: UploadedDriveFile[];
  fromEmail: string;
  post: MemoryPost;
}) => {
  const subject =
    optionalString(post.emailSubject) ?? `A memory for ${childName}`;
  const content = normalizeRichTextDocument(post.content);
  const contentImageMap = normalizeContentImageMap(post.contentImageMap);
  const inlineMediaIds = contentImageMediaIds({
    content,
    contentImageMap,
    media: normalizePostMedia(post.media),
  });
  const inlineImages: InlineEmailImage[] = driveFiles.flatMap((file) => {
    if (
      !file.content ||
      !inlineMediaIds.has(file.mediaId) ||
      file.mediaKind !== "image" ||
      !file.mimeType.startsWith("image/")
    ) {
      return [];
    }

    return [
      {
        cid: `${file.mediaId.replace(/[^a-zA-Z0-9_.-]/g, "") || "image"}@memory`,
        content: file.content,
        fileName: file.name,
        mediaId: file.mediaId,
        mimeType: file.mimeType,
      },
    ];
  });
  const publicDriveFiles = driveFiles.map(
    ({ content: _content, mimeType: _mimeType, ...file }) => file,
  );
  const linkedFiles = publicDriveFiles.filter(
    (file) => !inlineMediaIds.has(file.mediaId),
  );
  const text = buildMemoryEmailText({
    content,
    linkedFiles,
    post,
  });
  const html = await buildMemoryEmailHtml({
    authorName,
    authorPhotoURL,
    content,
    contentImageMap,
    inlineImages,
    linkedFiles,
    post,
  });
  const rawMessage = buildGmailMimeMessage({
    ccEmails,
    childEmail,
    fromEmail,
    fromName: authorName,
    html,
    inlineImages,
    subject,
    text,
  });

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

const buildGmailMimeMessage = ({
  ccEmails,
  childEmail,
  fromEmail,
  fromName,
  html,
  inlineImages,
  subject,
  text,
}: {
  ccEmails: string[];
  childEmail: string;
  fromEmail: string;
  fromName: string;
  html: string;
  inlineImages: InlineEmailImage[];
  subject: string;
  text: string;
}) => {
  const alternativeBoundary = contentTypeBoundary("alt");
  const relatedBoundary = contentTypeBoundary("related");
  const relatedParts = [
    `--${relatedBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    ...inlineImages.flatMap((image) => [
      `--${relatedBoundary}`,
      `Content-Type: ${sanitizeHeaderValue(image.mimeType)}; name="${sanitizeHeaderValue(image.fileName)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-ID: <${sanitizeHeaderValue(image.cid)}>`,
      `Content-Disposition: inline; filename="${sanitizeHeaderValue(image.fileName)}"`,
      "",
      base64MimeEncode(image.content),
    ]),
    `--${relatedBoundary}--`,
  ];

  return [
    `From: ${encodeHeader(fromName)} <${sanitizeHeaderValue(fromEmail)}>`,
    `To: ${sanitizeHeaderValue(childEmail)}`,
    ...(ccEmails.length > 0
      ? [`Cc: ${ccEmails.map(sanitizeHeaderValue).join(", ")}`]
      : []),
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${alternativeBoundary}`,
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    "",
    ...relatedParts,
    `--${alternativeBoundary}--`,
  ].join("\r\n");
};

type OriginalMediaUploadSessionRequest = {
  authorId?: unknown;
  familyId?: unknown;
  fileName?: unknown;
  mediaId?: unknown;
  mimeType?: unknown;
  postId?: unknown;
  sizeBytes?: unknown;
};

const uploadSessionFileName = ({
  fileName,
  mediaId,
}: {
  fileName?: string;
  mediaId: string;
}) => sanitizeHeaderValue(fileName || `memory-file-${mediaId}`);

const optionalNonNegativeInteger = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;

const assertFamilyMemberForUpload = async ({
  familyId,
  memberId,
}: {
  familyId: string;
  memberId: string;
}) => {
  const snapshot = await db
    .doc(`families/${familyId}/members/${memberId}`)
    .get();
  if (!snapshot.exists) {
    throw new HttpsError(
      "permission-denied",
      "Only family members can upload memory media.",
    );
  }
};

const createGoogleDriveUploadSession = async ({
  accessToken,
  familyId,
  fileName,
  mediaId,
  mimeType,
  postId,
  sizeBytes,
}: {
  accessToken: string;
  familyId: string;
  fileName: string;
  mediaId: string;
  mimeType: string;
  postId: string;
  sizeBytes?: number;
}) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": mimeType,
  };

  if (sizeBytes !== undefined) {
    headers["X-Upload-Content-Length"] = String(sizeBytes);
  }

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink",
    {
      body: JSON.stringify({
        appProperties: {
          familyId,
          mediaId,
          postId,
          source: "memory-original",
        },
        name: fileName,
      }),
      headers,
      method: "POST",
    },
  );

  if (!response.ok) {
    await assertGoogleJsonResponse<GoogleDriveFile>(
      response,
      "Google Drive did not start the upload.",
    );
  }

  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Google Drive did not return an upload URL.");
  }

  return {
    fileName,
    mimeType,
    provider: "googleDrive" as const,
    uploadMethod: "resumable" as const,
    uploadUrl,
  };
};

export const createOriginalMediaUploadSession =
  onCall<OriginalMediaUploadSessionRequest>(
    {
      region: storageFunctionRegion,
      secrets: [googleOauthClientSecret],
      timeoutSeconds: 30,
    },
    async (request) => {
      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "Sign in before uploading media.",
        );
      }

      try {
        const familyId = requireString(request.data.familyId, "familyId");
        const postId = requireString(request.data.postId, "postId");
        const mediaId = requireString(request.data.mediaId, "mediaId");
        const authorId = requireString(request.data.authorId, "authorId");
        const mimeType =
          optionalString(request.data.mimeType) ?? "application/octet-stream";
        const sizeBytes = optionalNonNegativeInteger(request.data.sizeBytes);
        const fileName = uploadSessionFileName({
          fileName: optionalString(request.data.fileName),
          mediaId,
        });

        await Promise.all([
          assertFamilyMemberForUpload({
            familyId,
            memberId: request.auth.uid,
          }),
          assertFamilyMemberForUpload({ familyId, memberId: authorId }),
        ]);

        const privateState = await connectedGoogleDeliveryPrivateStateForMember(
          {
            familyId,
            memberId: authorId,
          },
        );
        const refreshToken = requireString(
          privateState.refreshToken,
          "googleDelivery.refreshToken",
        );
        const accessToken = await refreshGoogleAccessToken(refreshToken);

        return createGoogleDriveUploadSession({
          accessToken,
          familyId,
          fileName,
          mediaId,
          mimeType,
          postId,
          sizeBytes,
        });
      } catch (error) {
        if (error instanceof HttpsError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to create original media upload session", {
          error: message,
        });
        throw new HttpsError("failed-precondition", message);
      }
    },
  );

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
}): Promise<UploadedDriveFile> => {
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
          source: "memory",
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
    body: buffer as unknown as BodyInit,
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
    content: buffer,
    id: fileId,
    mediaId: optionalString(media.id) ?? String(index + 1),
    mediaKind: optionalString(media.kind),
    mimeType,
    name: optionalString(driveFile.name) ?? name,
    webContentLink: optionalString(driveFile.webContentLink),
    webViewLink: optionalString(driveFile.webViewLink),
  };
};

const googleDriveOriginalStorageFromMedia = (
  media: MemoryMedia,
): GoogleDriveOriginalStorage | undefined => {
  const storage = media.originalStorage;
  if (!storage || typeof storage !== "object") {
    return undefined;
  }

  const data = storage as Record<string, unknown>;
  const fileId = optionalString(data.fileId);
  if (data.provider !== "googleDrive" || !fileId) {
    return undefined;
  }

  return {
    fileId,
    name:
      optionalString(data.name) ??
      optionalString(media.fileName) ??
      `memory-file-${fileId}`,
    provider: "googleDrive",
    webContentLink: optionalString(data.webContentLink),
    webViewLink: optionalString(data.webViewLink),
  };
};

const driveFileFromStoredOriginal = ({
  index,
  media,
  storage,
}: {
  index: number;
  media: MemoryMedia;
  storage: GoogleDriveOriginalStorage;
}): UploadedDriveFile => ({
  id: storage.fileId,
  mediaId: optionalString(media.id) ?? String(index + 1),
  mediaKind: optionalString(media.kind),
  mimeType: optionalString(media.mimeType) ?? "application/octet-stream",
  name: sanitizeHeaderValue(storage.name),
  webContentLink: storage.webContentLink,
  webViewLink:
    storage.webViewLink ??
    `https://drive.google.com/file/d/${storage.fileId}/view`,
});

const resolveMediaDriveFile = async ({
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
}) => {
  const storedOriginal = googleDriveOriginalStorageFromMedia(media);
  if (storedOriginal) {
    return driveFileFromStoredOriginal({
      index,
      media,
      storage: storedOriginal,
    });
  }

  return uploadMediaToDrive({
    accessToken,
    familyId,
    index,
    media,
    postId,
  });
};

const queryStringValue = (value: unknown) =>
  Array.isArray(value) ? optionalString(value[0]) : optionalString(value);

const requestBearerToken = (authorization: unknown) => {
  if (typeof authorization !== "string") {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
};

const wantsPlaybackSource = (value: unknown) =>
  queryStringValue(value)?.toLowerCase() === "source";

const copyDriveStreamHeaders = (
  source: Response,
  target: { set: (field: string, value: string) => void },
) => {
  for (const headerName of [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
  ]) {
    const value = source.headers.get(headerName);
    if (value) {
      target.set(headerName, value);
    }
  }
};

const maxMediaStreamChunkBytes = 2 * 1024 * 1024;

const boundedRangeHeader = (range: unknown) => {
  if (typeof range !== "string") {
    return `bytes=0-${maxMediaStreamChunkBytes - 1}`;
  }

  const match = range.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) {
    return range;
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0) {
    return range;
  }

  const requestedEnd =
    match[2].length > 0 && Number.isSafeInteger(Number(match[2]))
      ? Number(match[2])
      : undefined;
  const maxEnd = start + maxMediaStreamChunkBytes - 1;
  const end =
    requestedEnd === undefined ? maxEnd : Math.min(requestedEnd, maxEnd);

  return `bytes=${start}-${end}`;
};

const driveMediaDownloadUri = (fileId: string) =>
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId,
  )}?alt=media`;

export const streamOriginalMedia = onRequest(
  {
    region: storageFunctionRegion,
    secrets: [googleOauthClientSecret],
    timeoutSeconds: 300,
  },
  async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.set("Allow", "GET, HEAD");
      response.status(405).send("Method not allowed.");
      return;
    }

    const idToken = requestBearerToken(request.headers.authorization);
    if (!idToken) {
      response.status(401).send("Sign in before playing media.");
      return;
    }

    const familyId = queryStringValue(request.query.familyId);
    const postId = queryStringValue(request.query.postId);
    const mediaId = queryStringValue(request.query.mediaId);
    if (!familyId || !postId || !mediaId) {
      response.status(400).send("familyId, postId, and mediaId are required.");
      return;
    }

    let uid: string;
    try {
      uid = (await getAuth().verifyIdToken(idToken)).uid;
    } catch {
      response.status(401).send("Sign in before playing media.");
      return;
    }

    const [memberSnap, postSnap] = await Promise.all([
      db.doc(`families/${familyId}/members/${uid}`).get(),
      db.doc(`families/${familyId}/posts/${postId}`).get(),
    ]);

    if (!memberSnap.exists) {
      response.status(403).send("Only family members can play this media.");
      return;
    }

    if (!postSnap.exists) {
      response.status(404).send("Memory post was not found.");
      return;
    }

    const post = postSnap.data() ?? {};
    const authorId = optionalString(post.authorId);
    const media = normalizePostMedia(post.media).find(
      (item) => optionalString(item.id) === mediaId,
    );
    const originalStorage = media
      ? googleDriveOriginalStorageFromMedia(media)
      : undefined;

    if (!authorId || !media || !originalStorage) {
      response.status(404).send("Original media was not found.");
      return;
    }

    const privateState = await connectedGoogleDeliveryPrivateStateForMember({
      familyId,
      memberId: authorId,
    });
    const refreshToken = requireString(
      privateState.refreshToken,
      "googleDelivery.refreshToken",
    );
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    const driveUri = driveMediaDownloadUri(originalStorage.fileId);

    if (wantsPlaybackSource(request.query.mode)) {
      const playbackSource: OriginalMediaPlaybackSource = {
        expiresInSeconds: 3300,
        headers,
        uri: driveUri,
      };
      response.set("Cache-Control", "private, max-age=300");
      response.json(playbackSource);
      return;
    }

    const mediaKind = optionalString(media.kind);
    if (mediaKind === "video") {
      headers.Range = boundedRangeHeader(request.headers.range);
    } else {
      const range = request.headers.range;
      if (typeof range === "string") {
        headers.Range = range;
      }
    }

    const driveResponse = await fetch(driveUri, { headers });

    if (!driveResponse.ok) {
      const message = await driveResponse
        .text()
        .catch(() => "Drive did not return an error body.");
      logger.warn("Drive original media stream failed", {
        familyId,
        fileId: originalStorage.fileId,
        mediaId,
        postId,
        status: driveResponse.status,
        response: message.slice(0, 500),
      });
      copyDriveStreamHeaders(driveResponse, response);
      response
        .status(driveResponse.status)
        .send("Original media could not be streamed.");
      return;
    }

    response.status(driveResponse.status);
    response.set("Cache-Control", "private, max-age=300");
    copyDriveStreamHeaders(driveResponse, response);

    if (request.method === "HEAD") {
      await driveResponse.body?.cancel();
      response.end();
      return;
    }

    if (!driveResponse.body) {
      response.status(502).send("Drive did not return a media stream.");
      return;
    }

    const stream = Readable.fromWeb(
      driveResponse.body as Parameters<typeof Readable.fromWeb>[0],
    );
    stream.on("error", (error) => {
      logger.error("Drive original media stream interrupted", {
        error: error instanceof Error ? error.message : String(error),
        familyId,
        mediaId,
        postId,
      });
      response.destroy(error instanceof Error ? error : undefined);
    });
    stream.pipe(response);
  },
);

const shareDriveFileWithRecipient = async ({
  accessToken,
  fileId,
  recipientEmail,
}: {
  accessToken: string;
  fileId: string;
  recipientEmail: string;
}) => {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`,
    {
      body: JSON.stringify({
        emailAddress: recipientEmail,
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
  const authorId = requireString(post.authorId, "post.authorId");
  const [familySnap, privateState, authorSnap] = await Promise.all([
    db.doc(`families/${familyId}`).get(),
    connectedGoogleDeliveryPrivateStateForMember({
      familyId,
      memberId: authorId,
    }),
    db.doc(`families/${familyId}/members/${authorId}`).get(),
  ]);

  if (!familySnap.exists) {
    throw new Error("Family was not found.");
  }

  const family = familySnap.data() ?? {};
  const childEmail = requireString(family.childEmail, "childEmail");
  const childName = requireString(family.childName, "childName");
  const ccEmails = normalizeFamilyDeliveryCcEmails(family).filter(
    (email) => email.toLowerCase() !== childEmail.toLowerCase(),
  );
  const refreshToken = requireString(
    privateState.refreshToken,
    "googleDelivery.refreshToken",
  );
  const fromEmail = requireString(
    privateState.googleEmail,
    "googleDelivery.googleEmail",
  );
  const accessToken = await refreshGoogleAccessToken(refreshToken);
  const requiredDriveShareEmails = normalizeEmailRecipients([
    childEmail,
  ]).filter((email) => email.toLowerCase() !== fromEmail.toLowerCase());
  const ccDriveShareEmails = normalizeEmailRecipients(ccEmails).filter(
    (email) => email.toLowerCase() !== fromEmail.toLowerCase(),
  );
  const media = normalizePostMedia(post.media);
  const driveFiles: UploadedDriveFile[] = [];

  for (const [index, item] of media.entries()) {
    const driveFile = await resolveMediaDriveFile({
      accessToken,
      familyId,
      index,
      media: item,
      postId,
    });
    for (const recipientEmail of requiredDriveShareEmails) {
      await shareDriveFileWithRecipient({
        accessToken,
        fileId: driveFile.id,
        recipientEmail,
      });
    }
    for (const recipientEmail of ccDriveShareEmails) {
      await shareDriveFileWithRecipient({
        accessToken,
        fileId: driveFile.id,
        recipientEmail,
      }).catch((error) =>
        logger.warn("Failed to share Drive file with CC recipient", {
          error: error instanceof Error ? error.message : String(error),
          familyId,
          fileId: driveFile.id,
          postId,
        }),
      );
    }
    driveFiles.push(driveFile);
  }

  const authorName =
    optionalString(authorSnap?.data()?.displayName) ?? "Someone";
  const authorPhotoURL = optionalHttpUrl(authorSnap?.data()?.photoURL);
  const gmailMessage = await sendMemoryEmail({
    accessToken,
    authorName,
    authorPhotoURL,
    ccEmails,
    childEmail,
    childName,
    driveFiles,
    fromEmail,
    post,
  });

  const deliveredDriveFiles = driveFiles.map(
    ({
      content: _content,
      mediaKind: _mediaKind,
      mimeType: _mimeType,
      ...file
    }) => file,
  );

  return {
    driveFiles: deliveredDriveFiles,
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

      const privateRef = memberGoogleDeliveryPrivateRef({
        familyId,
        memberId: createdBy,
      });
      const [existingPrivateSnap, legacyPrivateSnap] = await Promise.all([
        privateRef.get(),
        legacyGoogleDeliveryPrivateRef(familyId).get(),
      ]);
      const existingPrivate =
        googleDeliveryPrivateStateFromSnapshot(existingPrivateSnap);
      const legacyPrivate = legacyGoogleDeliveryStateForMember({
        legacyState: googleDeliveryPrivateStateFromSnapshot(legacyPrivateSnap),
        memberId: createdBy,
      });
      const refreshToken =
        optionalString(tokenResponse.refresh_token) ??
        optionalString(existingPrivate?.refreshToken) ??
        optionalString(legacyPrivate?.refreshToken);

      if (!refreshToken) {
        throw new Error(
          "Google did not return a refresh token. Revoke Dinomay in your Google Account permissions, then connect again.",
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
          optionalString(existingPrivate?.connectedAt) ??
          optionalString(legacyPrivate?.connectedAt) ??
          now,
        updatedAt: now,
      } satisfies GoogleDeliveryConnection;

      await Promise.all([
        privateRef.set(
          {
            ...connection,
            refreshToken,
            tokenType: tokenResponse.token_type ?? "Bearer",
          },
          { merge: true },
        ),
        memberRef.set({ deliveryConnection: connection }, { merge: true }),
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

export const notifyFamilyOfPostActivity = onDocumentWritten(
  {
    database: firestoreDatabaseId,
    document: "families/{familyId}/posts/{postId}",
    region: storageFunctionRegion,
    timeoutSeconds: 60,
  },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;

    if (!before?.exists || !after?.exists) {
      return;
    }

    const familyId = requireString(event.params.familyId, "familyId");
    const postId = requireString(event.params.postId, "postId");
    const beforePost = before.data() as MemoryPost;
    const afterPost = after.data() as MemoryPost;

    if (!postActivityFieldsChanged(beforePost, afterPost)) {
      return;
    }

    const membersById = await fetchFamilyMemberSummaries(familyId);
    const notifications = buildPostActivityNotifications({
      after: afterPost,
      before: beforePost,
      familyId,
      membersById,
      postId,
    });

    if (notifications.length === 0) {
      return;
    }

    await sendMemoryActivityNotifications({
      familyId,
      memberIds: [...membersById.keys()],
      notifications,
      postId,
    });
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
