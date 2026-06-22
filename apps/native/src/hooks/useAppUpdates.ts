import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import * as Updates from "expo-updates";
import type { Manifest } from "expo-updates";

import {
  getAppUpdateState,
  setAppUpdateState,
  subscribeToAppUpdateState,
  type AppUpdateState,
  type AvailableUpdateInfo,
} from "../state/appUpdates";
import { getUpdatesPollInterval } from "../services/updates";

type ManifestLike = Manifest & {
  id?: string;
  createdAt?: string;
  runtimeVersion?: string;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  revisionId?: string;
  name?: string;
};

const stringValue = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const manifestToUpdateInfo = (
  manifest?: Manifest,
  downloadedAt?: string,
): AvailableUpdateInfo | undefined => {
  if (!manifest) {
    return undefined;
  }

  const manifestLike = manifest as ManifestLike;
  const extra = manifestLike.extra ?? {};
  const metadata = manifestLike.metadata ?? {};

  return {
    id:
      stringValue(manifestLike.id) ??
      stringValue(manifestLike.revisionId) ??
      stringValue(metadata.id),
    createdAt:
      stringValue(manifestLike.createdAt) ??
      stringValue(metadata.createdAt) ??
      stringValue(metadata.creationDate) ??
      null,
    runtimeVersion:
      stringValue(manifestLike.runtimeVersion) ??
      Updates.runtimeVersion ??
      null,
    channel: Updates.channel ?? null,
    gitSha: stringValue(extra.gitSha) ?? stringValue(metadata.gitSha) ?? null,
    manifestName: stringValue(manifestLike.name),
    downloadedAt,
  };
};

const isRuntimeUpdatesEnabled = !__DEV__ && Updates.isEnabled;

interface ServiceOptions {
  enabled?: boolean;
}

export const useAppUpdatesState = () =>
  useSyncExternalStore(
    subscribeToAppUpdateState,
    getAppUpdateState,
    getAppUpdateState,
  );

export const useIsAppUpdateAvailable = () =>
  useSyncExternalStore(
    subscribeToAppUpdateState,
    () => getAppUpdateState().isAvailable,
    () => getAppUpdateState().isAvailable,
  );

export const useAppUpdatesService = (options?: ServiceOptions) => {
  const { enabled = true } = options ?? {};
  const pollInterval = useMemo(() => getUpdatesPollInterval(), []);
  const updateState = useAppUpdatesState();
  const inFlightRef = useRef(false);

  const checkForUpdates = useCallback(async () => {
    if (!isRuntimeUpdatesEnabled || inFlightRef.current) {
      return { didCheck: false, isAvailable: false as const };
    }

    inFlightRef.current = true;
    const startedAt = new Date().toISOString();

    setAppUpdateState((previous) => ({
      ...previous,
      isChecking: true,
      error: null,
    }));

    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        const nextState: Partial<AppUpdateState> = {
          isChecking: false,
          isAvailable: false,
          lastCheckedAt: startedAt,
          availableUpdate: undefined,
        };
        setAppUpdateState(nextState);
        return { didCheck: true, isAvailable: false as const };
      }

      const fetched = await Updates.fetchUpdateAsync();

      if (!fetched.isNew || fetched.isRollBackToEmbedded) {
        setAppUpdateState({
          isChecking: false,
          isAvailable: false,
          lastCheckedAt: startedAt,
          availableUpdate: undefined,
        });
        return { didCheck: true, isAvailable: false as const };
      }

      const availableUpdate = manifestToUpdateInfo(
        fetched.manifest ?? result.manifest,
        new Date().toISOString(),
      );

      setAppUpdateState({
        isChecking: false,
        isAvailable: true,
        lastCheckedAt: startedAt,
        availableUpdate,
      });

      return { didCheck: true, isAvailable: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAppUpdateState({
        isChecking: false,
        error: message,
        lastCheckedAt: startedAt,
      });

      return { didCheck: false, isAvailable: false as const, error: message };
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !isRuntimeUpdatesEnabled) {
      return;
    }

    checkForUpdates();
    const interval = setInterval(() => {
      checkForUpdates();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [checkForUpdates, enabled, pollInterval]);

  return { checkForUpdates, isChecking: updateState.isChecking };
};

export const useAppUpdateActions = () => {
  const { checkForUpdates, isChecking } = useAppUpdatesService({
    enabled: false,
  });
  const updateState = useAppUpdatesState();

  const reloadUpdate = useCallback(async () => {
    if (!isRuntimeUpdatesEnabled) {
      throw new Error("Updates are only enabled in release builds.");
    }

    await Updates.reloadAsync();
  }, []);

  return { checkForUpdates, reloadUpdate, isChecking, updateState };
};

export const isRuntimeUpdateEnabled = isRuntimeUpdatesEnabled;
