import {
  collection,
  doc,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";

import type {
  MemoryRecap,
  MemoryRecapContributorSummary,
  MemoryRecapMediaSnapshot,
  MemoryRecapMood,
  MemoryRecapPeriodKind,
  MemoryRecapRequestInput,
  MemoryRecapSection,
  MemoryRecapSectionType,
  MemoryRecapSource,
  MemoryRecapStatus,
} from "@may/core";

import { getFirebaseServices } from "./firebase";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const normalizeOptionalString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const recapDateKey = (date: Date) =>
  date.toISOString().slice(0, 10).replace(/-/g, "");

const recapIdForPeriod = ({
  periodEnd,
  periodKind,
  periodStart,
}: {
  periodEnd: Date;
  periodKind: MemoryRecapPeriodKind;
  periodStart: Date;
}) => `${periodKind}_${recapDateKey(periodStart)}_${recapDateKey(periodEnd)}`;

const parseInputDate = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date.`);
  }
  return date;
};

const removeUndefinedFields = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );

const normalizeStatus = (value: unknown): MemoryRecapStatus =>
  value === "queued" ||
  value === "processing" ||
  value === "ready" ||
  value === "failed"
    ? value
    : "queued";

const normalizePeriodKind = (value: unknown): MemoryRecapPeriodKind =>
  value === "month" || value === "year" ? value : "week";

const normalizeMood = (value: unknown): MemoryRecapMood | undefined =>
  value === "tender" ||
  value === "playful" ||
  value === "quiet" ||
  value === "busy" ||
  value === "milestone" ||
  value === "ordinary"
    ? value
    : undefined;

const normalizeSectionType = (value: unknown): MemoryRecapSectionType =>
  value === "opening" ||
  value === "quote" ||
  value === "audio" ||
  value === "letter"
    ? value
    : "chapter";

const normalizeIsoString = (value: unknown, fallback: string) => {
  if (typeof value === "string") {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString();
  }
  return fallback;
};

const normalizeSections = (value: unknown): MemoryRecapSection[] =>
  Array.isArray(value)
    ? value
        .map((item, index): MemoryRecapSection | null => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const section = item as Record<string, unknown>;
          return {
            id: normalizeOptionalString(section.id) ?? `section_${index + 1}`,
            type: normalizeSectionType(section.type),
            title: normalizeOptionalString(section.title) ?? "A small moment",
            body: normalizeOptionalString(section.body) ?? "",
            memoryIds: Array.isArray(section.memoryIds)
              ? section.memoryIds
                  .map(normalizeOptionalString)
                  .filter((id): id is string => Boolean(id))
              : [],
            quote: normalizeOptionalString(section.quote),
          };
        })
        .filter((item): item is MemoryRecapSection => Boolean(item))
    : [];

const normalizeSourceMedia = (value: unknown): MemoryRecapMediaSnapshot[] =>
  Array.isArray(value)
    ? value
        .map((mediaItem): MemoryRecapMediaSnapshot | null => {
          if (!mediaItem || typeof mediaItem !== "object") {
            return null;
          }
          const data = mediaItem as Record<string, unknown>;
          const mediaId = normalizeOptionalString(data.id);
          const kind = normalizeOptionalString(data.kind);
          if (
            !mediaId ||
            (kind !== "image" && kind !== "video" && kind !== "audio")
          ) {
            return null;
          }
          return {
            id: mediaId,
            kind,
            uri: normalizeOptionalString(data.uri),
            thumbnailUri: normalizeOptionalString(data.thumbnailUri),
            durationMs:
              typeof data.durationMs === "number" ? data.durationMs : undefined,
          };
        })
        .filter((mediaItem): mediaItem is MemoryRecapMediaSnapshot =>
          Boolean(mediaItem),
        )
    : [];

const normalizeSources = (value: unknown): MemoryRecapSource[] =>
  Array.isArray(value)
    ? value
        .map((item): MemoryRecapSource | null => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const source = item as Record<string, unknown>;
          const id = normalizeOptionalString(source.id);
          if (!id) {
            return null;
          }
          return {
            id,
            authorId: normalizeOptionalString(source.authorId) ?? "",
            bodyPreview: normalizeOptionalString(source.bodyPreview),
            createdAt: normalizeIsoString(
              source.createdAt,
              new Date().toISOString(),
            ),
            media: normalizeSourceMedia(source.media),
            transcriptPreview: normalizeOptionalString(
              source.transcriptPreview,
            ),
          };
        })
        .filter((item): item is MemoryRecapSource => Boolean(item))
    : [];

const normalizeContributorSummaries = (
  value: unknown,
): MemoryRecapContributorSummary[] =>
  Array.isArray(value)
    ? value
        .map((item): MemoryRecapContributorSummary | null => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const summary = item as Record<string, unknown>;
          const authorId = normalizeOptionalString(summary.authorId);
          const postCount =
            typeof summary.postCount === "number" &&
            Number.isFinite(summary.postCount) &&
            summary.postCount > 0
              ? Math.floor(summary.postCount)
              : undefined;

          return authorId && postCount ? { authorId, postCount } : null;
        })
        .filter((item): item is MemoryRecapContributorSummary => Boolean(item))
    : [];

const toMemoryRecap = (
  id: string,
  familyId: string,
  data: Record<string, unknown>,
): MemoryRecap => {
  const now = new Date().toISOString();

  return {
    id,
    familyId: String(data.familyId ?? familyId),
    periodKind: normalizePeriodKind(data.periodKind),
    periodStart: normalizeIsoString(data.periodStart, now),
    periodEnd: normalizeIsoString(data.periodEnd, now),
    timezone: normalizeOptionalString(data.timezone),
    status: normalizeStatus(data.status),
    title: normalizeOptionalString(data.title) ?? "Building recap",
    subtitle: normalizeOptionalString(data.subtitle),
    mood: normalizeMood(data.mood),
    sections: normalizeSections(data.sections),
    sources: normalizeSources(data.sources),
    sourceMemoryIds: Array.isArray(data.sourceMemoryIds)
      ? data.sourceMemoryIds
          .map(normalizeOptionalString)
          .filter((sourceId): sourceId is string => Boolean(sourceId))
      : [],
    contributorSummaries: normalizeContributorSummaries(
      data.contributorSummaries,
    ),
    requestedBy: normalizeOptionalString(data.requestedBy) ?? "",
    createdAt: normalizeIsoString(data.createdAt, now),
    updatedAt: normalizeIsoString(data.updatedAt, now),
    readyAt:
      data.readyAt === undefined
        ? undefined
        : normalizeIsoString(data.readyAt, now),
    errorMessage: normalizeOptionalString(data.errorMessage),
    notificationStatus:
      data.notificationStatus === "pending" ||
      data.notificationStatus === "sent" ||
      data.notificationStatus === "failed" ||
      data.notificationStatus === "disabled"
        ? data.notificationStatus
        : undefined,
  };
};

export const subscribeToFamilyRecaps = ({
  familyId,
  onError,
  onRecaps,
}: {
  familyId: string;
  onError: (message: string) => void;
  onRecaps: (recaps: MemoryRecap[]) => void;
}): Unsubscribe | null => {
  const services = getFirebaseServices();
  if (!services?.auth.currentUser) {
    return null;
  }

  return onSnapshot(
    query(
      collection(services.db, "families", familyId, "recaps"),
      orderBy("periodStart", "desc"),
      queryLimit(36),
    ),
    (snapshot) => {
      onRecaps(
        snapshot.docs.map((doc) =>
          toMemoryRecap(
            doc.id,
            familyId,
            doc.data() as Record<string, unknown>,
          ),
        ),
      );
    },
    (error) => onError(getErrorMessage(error)),
  );
};

export const requestFamilyRecap = async (
  input: MemoryRecapRequestInput,
): Promise<{ recapId: string; status: MemoryRecapStatus }> => {
  const services = getFirebaseServices();
  const currentUser = services?.auth.currentUser;
  if (!services || !currentUser) {
    throw new Error("Sign in before making recaps.");
  }

  const periodStart = parseInputDate(input.periodStart, "periodStart");
  const periodEnd = parseInputDate(input.periodEnd, "periodEnd");
  const recapId = recapIdForPeriod({
    periodEnd,
    periodKind: input.periodKind,
    periodStart,
  });
  const requestId = `${recapId}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  await setDoc(
    doc(services.db, "families", input.familyId, "recapRequests", requestId),
    removeUndefinedFields({
      createdAt: now,
      familyId: input.familyId,
      periodEnd: periodEnd.toISOString(),
      periodKind: input.periodKind,
      periodStart: periodStart.toISOString(),
      recapId,
      requestedBy: currentUser.uid,
      status: "queued",
      timezone: input.timezone,
    }),
  );

  return { recapId, status: "queued" };
};
