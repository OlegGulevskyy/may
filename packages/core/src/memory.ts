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
  width?: number;
  height?: number;
};

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

export const createMemoryPost = ({
  familyId,
  authorId,
  body,
  media,
}: NewMemoryPostInput): MemoryPost => {
  const now = new Date().toISOString();

  return {
    id: createId("post"),
    familyId,
    authorId,
    body: body.trim(),
    media,
    comments: [],
    reactions: {},
    status: "local",
    createdAt: now,
    updatedAt: now,
  };
};

export const isPostReadyForDelivery = (post: MemoryPost) =>
  post.status === "stored" && (post.body.length > 0 || post.media.length > 0);
