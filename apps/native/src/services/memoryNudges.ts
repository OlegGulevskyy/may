import * as Notifications from "expo-notifications";

import { getLocalString, removeLocalItem, setLocalString } from "./storage";

export const memoryNudgePrompts = [
  "Pause here and send {childName} exactly what this moment feels like.",
  "Take one photo from where you are right now for {childName}.",
  "Record a quick voice note so {childName} can hear this moment in your voice.",
  "Look around. What tiny detail should {childName} see from right now?",
  "Send {childName} the view in front of you before it changes.",
  "Capture the sound around you right now for {childName}.",
  "Write one sentence about what is happening around you this minute.",
  "Show {childName} your current table, street, room, or sky.",
  "Send a tiny proof-of-life from wherever you are right now.",
  "What are your hands doing right now? Save it for {childName}.",
  "Snap the ordinary thing closest to you and tell {childName} why it is there.",
  "Send {childName} your current mood in one photo or one sentence.",
  "Capture the light, noise, or mess around you right now.",
  "Take ten seconds and leave {childName} a memory from this exact place.",
  "What would {childName} notice if they were beside you right now?",
  "Send a quick hello from the middle of what you are doing.",
  "Freeze this minute for {childName}: photo, voice, or one honest line.",
  "What is happening in front of you right now? Put it on the wall.",
  "Save the current background of your life for {childName}.",
  "Take a no-perfecting-needed snapshot for {childName} right now.",
  "Record the room tone, the street noise, or your voice for {childName}.",
  "Show {childName} the small thing you are about to walk away from.",
  "Send one real, unpolished piece of right now.",
  "Before this moment moves on, leave {childName} a tiny now-memory.",
] as const;

export const memoryNudgeCadenceDays = [1, 2, 3, 4, 7] as const;

export type MemoryNudgeCadenceDays = (typeof memoryNudgeCadenceDays)[number];

export type MemoryNudgeSettings = {
  cadenceDays: MemoryNudgeCadenceDays;
  enabled: boolean;
  endHour: number;
  endMinute: number;
  startHour: number;
  startMinute: number;
  updatedAt: string;
};

export type MemoryNudgeScheduleState =
  | {
      scheduledCount: number;
      status: "scheduled";
      nextNotificationAt?: string;
    }
  | { status: "denied" | "needs-permission" | "off" | "unavailable" }
  | { message: string; status: "error" };

type MemoryNudgeIdentity = {
  childName: string;
  familyId: string;
  memberId: string;
};

type ScheduledNudgeRecord = {
  identifier: string;
  triggerAt: string;
};

const scheduleHorizonDays = 56;
const minMinutesBeforeFirstNudge = 5;

export const defaultMemoryNudgeSettings: MemoryNudgeSettings = {
  cadenceDays: 2,
  enabled: false,
  endHour: 21,
  endMinute: 0,
  startHour: 8,
  startMinute: 0,
  updatedAt: new Date(0).toISOString(),
};

export const loadMemoryNudgeSettings = (
  familyId: string,
  memberId: string,
): MemoryNudgeSettings => {
  const stored = getLocalString(memoryNudgeSettingsKey(familyId, memberId));

  if (!stored) {
    return defaultMemoryNudgeSettings;
  }

  try {
    return normalizeMemoryNudgeSettings(JSON.parse(stored));
  } catch {
    return defaultMemoryNudgeSettings;
  }
};

export const saveMemoryNudgeSettings = (
  familyId: string,
  memberId: string,
  settings: MemoryNudgeSettings,
) => {
  setLocalString(
    memoryNudgeSettingsKey(familyId, memberId),
    JSON.stringify(normalizeMemoryNudgeSettings(settings)),
  );
};

export const requestMemoryNudgePermission = () =>
  Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true,
    },
  });

export const synchronizeMemoryNudgeSchedule = async ({
  childName,
  familyId,
  memberId,
  settings,
}: MemoryNudgeIdentity & {
  settings: MemoryNudgeSettings;
}): Promise<MemoryNudgeScheduleState> => {
  const normalizedSettings = normalizeMemoryNudgeSettings(settings);
  const identity = { childName, familyId, memberId };

  if (!normalizedSettings.enabled) {
    await cancelMemoryNudgeNotifications(identity);
    return { status: "off" };
  }

  try {
    const permission = await Notifications.getPermissionsAsync();

    if (!isNotificationPermissionGranted(permission)) {
      await cancelMemoryNudgeNotifications(identity);
      return {
        status: permission.status === "denied" ? "denied" : "needs-permission",
      };
    }

    await cancelMemoryNudgeNotifications(identity);

    const nudgeRequests = buildUpcomingNudgeRequests({
      childName,
      familyId,
      memberId,
      settings: normalizedSettings,
    });
    const scheduledRecords: ScheduledNudgeRecord[] = [];

    for (const request of nudgeRequests) {
      await Notifications.scheduleNotificationAsync(request);
      scheduledRecords.push({
        identifier: request.identifier,
        triggerAt: request.triggerAt.toISOString(),
      });
    }

    saveScheduledNudgeRecords(familyId, memberId, scheduledRecords);

    return {
      nextNotificationAt: scheduledRecords[0]?.triggerAt,
      scheduledCount: scheduledRecords.length,
      status: "scheduled",
    };
  } catch (error) {
    return {
      message: getErrorMessage(error),
      status: isNotificationUnavailableError(error) ? "unavailable" : "error",
    };
  }
};

export const formatMemoryNudgeCadence = (
  cadenceDays: MemoryNudgeCadenceDays,
) => {
  switch (cadenceDays) {
    case 1:
      return "Every day";
    case 2:
      return "Every 2nd day";
    case 3:
      return "Every 3rd day";
    case 4:
      return "Every 4th day";
    case 7:
      return "Once a week";
  }
};

export const formatMemoryNudgeWindow = ({
  endHour,
  endMinute,
  startHour,
  startMinute,
}: Pick<
  MemoryNudgeSettings,
  "endHour" | "endMinute" | "startHour" | "startMinute"
>) => `${formatTime(startHour, startMinute)}-${formatTime(endHour, endMinute)}`;

export const formatMemoryNudgeSummary = (settings: MemoryNudgeSettings) =>
  settings.enabled
    ? `${formatMemoryNudgeCadence(settings.cadenceDays)}, ${formatMemoryNudgeWindow(settings)}`
    : "Off";

export const normalizeMemoryNudgeSettings = (
  value: Partial<MemoryNudgeSettings> | unknown,
): MemoryNudgeSettings => {
  const data =
    value && typeof value === "object"
      ? (value as Partial<MemoryNudgeSettings>)
      : {};
  const startHour = normalizeHour(data.startHour, 8);
  const startMinute = normalizeMinute(data.startMinute, 0);
  let endHour = normalizeHour(data.endHour, 21);
  let endMinute = normalizeMinute(data.endMinute, 0);
  const cadenceDays = memoryNudgeCadenceDays.includes(
    data.cadenceDays as MemoryNudgeCadenceDays,
  )
    ? (data.cadenceDays as MemoryNudgeCadenceDays)
    : defaultMemoryNudgeSettings.cadenceDays;
  if (endHour * 60 + endMinute < startHour * 60 + startMinute) {
    endHour = startHour;
    endMinute = startMinute;
  }

  return {
    cadenceDays,
    enabled: data.enabled === true,
    endHour,
    endMinute,
    startHour,
    startMinute,
    updatedAt:
      typeof data.updatedAt === "string"
        ? data.updatedAt
        : new Date().toISOString(),
  };
};

export const isNotificationPermissionGranted = (
  permission: Notifications.NotificationPermissionsStatus,
) =>
  permission.granted ||
  permission.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
  permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
  permission.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;

const buildUpcomingNudgeRequests = ({
  childName,
  familyId,
  memberId,
  settings,
}: MemoryNudgeIdentity & {
  settings: MemoryNudgeSettings;
}) => {
  const now = new Date();
  const startOfToday = new Date(now);
  const requests: Array<{
    identifier: string;
    content: Notifications.NotificationContentInput;
    trigger: Notifications.NotificationTriggerInput;
    triggerAt: Date;
  }> = [];

  startOfToday.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset < scheduleHorizonDays; dayOffset += 1) {
    const date = new Date(startOfToday);
    date.setDate(startOfToday.getDate() + dayOffset);

    if (!shouldNudgeOnDate(date, settings.cadenceDays)) {
      continue;
    }

    const triggerAt = withRandomTimeInWindow(date, settings, now);

    if (!triggerAt) {
      continue;
    }

    const prompt = pickRandomPrompt(childName);
    const triggerDateKey = triggerAt.toISOString().slice(0, 10);

    requests.push({
      content: {
        body: prompt,
        data: {
          familyId,
          memberId,
          type: "memory-nudge",
        },
        sound: "default",
        title: `A memory for ${childName}`,
      },
      identifier: `${notificationIdentifierPrefix(familyId, memberId)}${triggerDateKey}`,
      trigger: {
        date: triggerAt,
        type: Notifications.SchedulableTriggerInputTypes.DATE,
      },
      triggerAt,
    });
  }

  return requests;
};

const cancelMemoryNudgeNotifications = async ({
  familyId,
  memberId,
}: MemoryNudgeIdentity) => {
  const storedRecords = loadScheduledNudgeRecords(familyId, memberId);
  const identifiers = new Set(storedRecords.map((record) => record.identifier));
  const prefix = notificationIdentifierPrefix(familyId, memberId);

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const request of scheduled) {
      if (request.identifier.startsWith(prefix)) {
        identifiers.add(request.identifier);
      }
    }
  } catch {
    // Stored identifiers are enough for normal cancellation; this fallback keeps
    // disable/reschedule best-effort if the platform cannot list pending items.
  }

  await Promise.all(
    [...identifiers].map((identifier) =>
      Notifications.cancelScheduledNotificationAsync(identifier).catch(
        () => undefined,
      ),
    ),
  );
  removeLocalItem(memoryNudgeScheduledKey(familyId, memberId));
};

const shouldNudgeOnDate = (date: Date, cadenceDays: MemoryNudgeCadenceDays) => {
  if (cadenceDays === 1) {
    return true;
  }

  const mondayBasedDayOfWeek = (date.getDay() + 6) % 7;
  return mondayBasedDayOfWeek % cadenceDays === 0;
};

const withRandomTimeInWindow = (
  date: Date,
  settings: MemoryNudgeSettings,
  now: Date,
) => {
  let startMinutes = settings.startHour * 60 + settings.startMinute;
  const endMinutes = Math.min(
    settings.endHour * 60 + settings.endMinute,
    23 * 60 + 59,
  );

  if (isSameDay(date, now)) {
    startMinutes = Math.max(
      startMinutes,
      now.getHours() * 60 + now.getMinutes() + minMinutesBeforeFirstNudge,
    );
  }

  if (startMinutes > endMinutes) {
    return null;
  }

  const minuteOfDay =
    startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes + 1));
  const triggerAt = new Date(date);

  triggerAt.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);

  return triggerAt;
};

const pickRandomPrompt = (childName: string) =>
  memoryNudgePrompts[
    Math.floor(Math.random() * memoryNudgePrompts.length)
  ]!.replace(/\{childName\}/g, childName);

const loadScheduledNudgeRecords = (familyId: string, memberId: string) => {
  const stored = getLocalString(memoryNudgeScheduledKey(familyId, memberId));

  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (record): record is ScheduledNudgeRecord =>
        record &&
        typeof record === "object" &&
        typeof record.identifier === "string" &&
        typeof record.triggerAt === "string",
    );
  } catch {
    return [];
  }
};

const saveScheduledNudgeRecords = (
  familyId: string,
  memberId: string,
  records: ScheduledNudgeRecord[],
) => {
  setLocalString(
    memoryNudgeScheduledKey(familyId, memberId),
    JSON.stringify(records),
  );
};

const memoryNudgeSettingsKey = (familyId: string, memberId: string) =>
  `may.memory-nudge.${familyId}.${memberId}.settings.v1`;

const memoryNudgeScheduledKey = (familyId: string, memberId: string) =>
  `may.memory-nudge.${familyId}.${memberId}.scheduled.v1`;

const notificationIdentifierPrefix = (familyId: string, memberId: string) =>
  `may-memory-nudge-${sanitizeIdentifierPart(familyId)}-${sanitizeIdentifierPart(
    memberId,
  )}-`;

const sanitizeIdentifierPart = (value: string) =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

const normalizeHour = (value: unknown, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(23, Math.floor(value)));
};

const normalizeMinute = (value: unknown, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(59, Math.floor(value)));
};

const formatTime = (hour: number, minute: number) => {
  const normalizedHour = normalizeHour(hour, 0);
  const normalizedMinute = normalizeMinute(minute, 0);
  const minuteText =
    normalizedMinute === 0
      ? ""
      : `:${String(normalizedMinute).padStart(2, "0")}`;

  if (normalizedHour === 0) {
    return `12${minuteText} AM`;
  }

  if (normalizedHour < 12) {
    return `${normalizedHour}${minuteText} AM`;
  }

  if (normalizedHour === 12) {
    return `12${minuteText} PM`;
  }

  return `${normalizedHour - 12}${minuteText} PM`;
};

const isSameDay = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

const isNotificationUnavailableError = (error: unknown) =>
  getErrorMessage(error).toLowerCase().includes("unavailable");

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
