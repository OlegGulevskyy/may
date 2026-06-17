/**
 * The id of a {@link FamilyMember} (see `./family`). Posts, comments, and
 * reactions are all attributed to a member by id so the wall can stay in sync
 * with whoever has actually joined a given family.
 */
export type MemoryAuthorId = string;

export type MemoryMediaKind = "image" | "video" | "audio";

export type MemoryDeliveryStatus =
  | "local"
  | "queued"
  | "synced"
  | "uploading"
  | "stored"
  | "emailing"
  | "delivered"
  | "failed";

export type MemoryMedia = {
  id: string;
  kind: MemoryMediaKind;
  uri: string;
  thumbnailUri?: string;
  storagePath?: string;
  thumbnailStoragePath?: string;
  fileName?: string;
  mimeType?: string;
  durationMs?: number;
  waveformPeaks?: number[];
  width?: number;
  height?: number;
};

export type MemoryRichTextMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type MemoryRichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: MemoryRichTextNode[];
  marks?: MemoryRichTextMark[];
  text?: string;
};

export type MemoryRichTextDocument = {
  type: "doc";
  content?: MemoryRichTextNode[];
};

export type MemoryContentImageMap = Record<string, string>;

export type MemoryComment = {
  id: string;
  authorId: MemoryAuthorId;
  body: string;
  createdAt: string;
};

export type MemoryPost = {
  id: string;
  familyId: string;
  authorId: MemoryAuthorId;
  body: string;
  content?: MemoryRichTextDocument;
  contentImageMap?: MemoryContentImageMap;
  media: MemoryMedia[];
  comments: MemoryComment[];
  reactions: Record<string, MemoryAuthorId[]>;
  status: MemoryDeliveryStatus;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  errorMessage?: string;
};

export type NewMemoryPostInput = {
  familyId: string;
  authorId: MemoryAuthorId;
  body: string;
  content?: MemoryRichTextDocument;
  contentImageMap?: MemoryContentImageMap;
  media: MemoryMedia[];
};

export const DELIVERY_LABELS: Record<MemoryDeliveryStatus, string> = {
  local: "Saved locally",
  queued: "Waiting to sync",
  synced: "Saved to Firebase",
  uploading: "Uploading media",
  stored: "Stored in Drive queue",
  emailing: "Sending email",
  delivered: "Delivered to Gmail",
  failed: "Needs retry",
};

export const createId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

const textNode = (text: string): MemoryRichTextNode => ({
  text,
  type: "text",
});

export const richTextDocumentFromPlainText = (
  value: string,
): MemoryRichTextDocument => {
  const lines = value.split(/\r?\n/);
  const content =
    lines.length > 0
      ? lines.map((line) => ({
          content: line.length > 0 ? [textNode(line)] : undefined,
          type: "paragraph",
        }))
      : [{ type: "paragraph" }];

  return {
    content,
    type: "doc",
  };
};

export const isMemoryRichTextDocument = (
  value: unknown,
): value is MemoryRichTextDocument =>
  Boolean(
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "doc",
  );

export const richTextPlainText = (content?: MemoryRichTextDocument): string => {
  if (!content?.content) {
    return "";
  }

  const visit = (node: MemoryRichTextNode): string => {
    if (typeof node.text === "string") {
      return node.text;
    }

    const children = node.content?.map(visit).join("") ?? "";

    switch (node.type) {
      case "hardBreak":
        return "\n";
      case "paragraph":
      case "heading":
      case "blockquote":
        return children ? `${children}\n` : "\n";
      case "listItem":
        return children;
      case "bulletList":
      case "orderedList":
        return children ? `${children}\n` : "";
      case "image":
        return "";
      default:
        return children;
    }
  };

  return content.content.map(visit).join("").trim();
};

export const richTextImageSources = (
  content?: MemoryRichTextDocument,
): string[] => {
  const sources: string[] = [];

  const visit = (node: MemoryRichTextNode) => {
    const source = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    if (node.type === "image" && source) {
      sources.push(source);
    }
    node.content?.forEach(visit);
  };

  content?.content?.forEach(visit);
  return sources;
};

export const hasRichTextContent = (content?: MemoryRichTextDocument) =>
  Boolean(richTextPlainText(content)) ||
  richTextImageSources(content).length > 0;

export const createMemoryPost = ({
  familyId,
  authorId,
  body,
  content,
  contentImageMap,
  media,
}: NewMemoryPostInput): MemoryPost => {
  const now = new Date().toISOString();
  const fallbackBody = richTextPlainText(content);

  return {
    id: createId("post"),
    familyId,
    authorId,
    body: body.trim() || fallbackBody,
    content,
    contentImageMap,
    media,
    comments: [],
    reactions: {},
    status: "local",
    createdAt: now,
    updatedAt: now,
  };
};

export const isPostReadyForDelivery = (post: MemoryPost) =>
  post.status === "stored" &&
  (post.body.length > 0 ||
    hasRichTextContent(post.content) ||
    post.media.length > 0);
