import { useCallback, useEffect, useMemo, useState } from "react";

import {
  defaultMemoryNudgeSettings,
  isNotificationPermissionGranted,
  loadMemoryNudgeSettings,
  normalizeMemoryNudgeSettings,
  requestMemoryNudgePermission,
  saveMemoryNudgeSettings,
  synchronizeMemoryNudgeSchedule,
  type MemoryNudgeScheduleState,
  type MemoryNudgeSettings,
} from "../services/memoryNudges";

export function useMemoryNudges({
  childName,
  familyId,
  memberId,
}: {
  childName: string;
  familyId: string;
  memberId: string;
}) {
  const settingsKey = useMemo(
    () => `${familyId}:${memberId}`,
    [familyId, memberId],
  );
  const [settings, setSettings] = useState<MemoryNudgeSettings>(
    defaultMemoryNudgeSettings,
  );
  const [loadedSettingsKey, setLoadedSettingsKey] = useState<string | null>(
    null,
  );
  const [scheduleState, setScheduleState] = useState<MemoryNudgeScheduleState>({
    status: "off",
  });
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    const storedSettings = loadMemoryNudgeSettings(familyId, memberId);
    setSettings(storedSettings);
    setLoadedSettingsKey(settingsKey);
  }, [familyId, memberId, settingsKey]);

  useEffect(() => {
    if (loadedSettingsKey !== settingsKey) {
      return;
    }

    let cancelled = false;

    synchronizeMemoryNudgeSchedule({
      childName,
      familyId,
      memberId,
      settings,
    }).then((nextState) => {
      if (!cancelled) {
        setScheduleState(nextState);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [childName, familyId, loadedSettingsKey, memberId, settings, settingsKey]);

  const persistSettings = useCallback(
    (nextSettings: MemoryNudgeSettings) => {
      const normalized = normalizeMemoryNudgeSettings({
        ...nextSettings,
        updatedAt: new Date().toISOString(),
      });

      saveMemoryNudgeSettings(familyId, memberId, normalized);
      setSettings(normalized);

      return normalized;
    },
    [familyId, memberId],
  );

  const updateMemoryNudgeSettings = useCallback(
    async (patch: Partial<MemoryNudgeSettings>) => {
      persistSettings({ ...settings, ...patch });
    },
    [persistSettings, settings],
  );

  const setMemoryNudgesEnabled = useCallback(
    async (enabled: boolean) => {
      setIsBusy(true);

      try {
        if (!enabled) {
          persistSettings({ ...settings, enabled: false });
          return true;
        }

        const permission = await requestMemoryNudgePermission();

        if (!isNotificationPermissionGranted(permission)) {
          setScheduleState({
            status:
              permission.status === "denied" ? "denied" : "needs-permission",
          });
          return false;
        }

        persistSettings({ ...settings, enabled: true });
        return true;
      } finally {
        setIsBusy(false);
      }
    },
    [persistSettings, settings],
  );

  const refreshMemoryNudgeSchedule = useCallback(async () => {
    setIsBusy(true);
    try {
      setScheduleState(
        await synchronizeMemoryNudgeSchedule({
          childName,
          familyId,
          memberId,
          settings,
        }),
      );
    } finally {
      setIsBusy(false);
    }
  }, [childName, familyId, memberId, settings]);

  return {
    isMemoryNudgeBusy: isBusy,
    memoryNudgeScheduleState: scheduleState,
    memoryNudgeSettings: settings,
    refreshMemoryNudgeSchedule,
    setMemoryNudgesEnabled,
    updateMemoryNudgeSettings,
  };
}
