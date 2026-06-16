import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { createElement, type ReactNode } from "react";
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
  content?: unknown;
  contentImageMap?: unknown;
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

type UploadedDriveFile = DeliveredDriveFile & {
  content: Buffer;
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
  content,
  contentImageMap,
  inlineImages,
  linkedFiles,
  post,
}: {
  authorName: string;
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
          h("span", { style: emailStyles.avatar }, authorInitial(authorName)),
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
  driveFiles: UploadedDriveFile[];
  fromEmail: string;
  post: MemoryPost;
}) => {
  const subject = `A memory for ${childName}`;
  const content = normalizeRichTextDocument(post.content);
  const contentImageMap = normalizeContentImageMap(post.contentImageMap);
  const inlineMediaIds = contentImageMediaIds({
    content,
    contentImageMap,
    media: normalizePostMedia(post.media),
  });
  const inlineImages: InlineEmailImage[] = driveFiles
    .filter(
      (file) =>
        inlineMediaIds.has(file.mediaId) &&
        file.mediaKind === "image" &&
        file.mimeType.startsWith("image/"),
    )
    .map((file) => ({
      cid: `${file.mediaId.replace(/[^a-zA-Z0-9_.-]/g, "") || "image"}@memory`,
      content: file.content,
      fileName: file.name,
      mediaId: file.mediaId,
      mimeType: file.mimeType,
    }));
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
    content,
    contentImageMap,
    inlineImages,
    linkedFiles,
    post,
  });
  const rawMessage = buildGmailMimeMessage({
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
  childEmail,
  fromEmail,
  fromName,
  html,
  inlineImages,
  subject,
  text,
}: {
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
  const driveFiles: UploadedDriveFile[] = [];

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
