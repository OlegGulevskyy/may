import type { MemoryMediaKind } from "./memory";

export type MemoryRecapPeriodKind = "week" | "month" | "year";

export type MemoryRecapStatus = "queued" | "processing" | "ready" | "failed";

export type MemoryRecapMood =
  | "tender"
  | "playful"
  | "quiet"
  | "busy"
  | "milestone"
  | "ordinary";

export type MemoryRecapMediaSnapshot = {
  id: string;
  kind: MemoryMediaKind;
  uri?: string;
  thumbnailUri?: string;
  durationMs?: number;
};

export type MemoryRecapSource = {
  id: string;
  authorId: string;
  bodyPreview?: string;
  createdAt: string;
  media: MemoryRecapMediaSnapshot[];
  transcriptPreview?: string;
};

export type MemoryRecapContributorSummary = {
  authorId: string;
  postCount: number;
};

export type MemoryRecapSectionType =
  | "opening"
  | "chapter"
  | "quote"
  | "audio"
  | "letter";

export type MemoryRecapSection = {
  id: string;
  type: MemoryRecapSectionType;
  title: string;
  body: string;
  memoryIds: string[];
  quote?: string;
};

export type MemoryRecap = {
  id: string;
  familyId: string;
  periodKind: MemoryRecapPeriodKind;
  periodStart: string;
  periodEnd: string;
  timezone?: string;
  status: MemoryRecapStatus;
  title: string;
  subtitle?: string;
  mood?: MemoryRecapMood;
  sections: MemoryRecapSection[];
  sources: MemoryRecapSource[];
  sourceMemoryIds: string[];
  contributorSummaries?: MemoryRecapContributorSummary[];
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  readyAt?: string;
  errorMessage?: string;
  notificationStatus?: "disabled" | "pending" | "sent" | "failed";
};

export type MemoryRecapRequestInput = {
  familyId: string;
  periodKind: MemoryRecapPeriodKind;
  periodStart: string;
  periodEnd: string;
  timezone?: string;
};
