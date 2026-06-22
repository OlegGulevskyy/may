export interface AvailableUpdateInfo {
  id?: string;
  createdAt?: string | null;
  runtimeVersion?: string | null;
  channel?: string | null;
  gitSha?: string | null;
  manifestName?: string;
  downloadedAt?: string;
}

export interface AppUpdateState {
  isChecking: boolean;
  isAvailable: boolean;
  lastCheckedAt?: string;
  error?: string | null;
  availableUpdate?: AvailableUpdateInfo;
}

export const initialUpdateState: AppUpdateState = {
  isChecking: false,
  isAvailable: false,
  lastCheckedAt: undefined,
  error: null,
  availableUpdate: undefined,
};

let appUpdateState = initialUpdateState;
const listeners = new Set<() => void>();

export const getAppUpdateState = () => appUpdateState;

export const subscribeToAppUpdateState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setAppUpdateState = (
  update:
    | Partial<AppUpdateState>
    | ((previous: AppUpdateState) => AppUpdateState),
) => {
  appUpdateState =
    typeof update === "function"
      ? update(appUpdateState)
      : {
          ...appUpdateState,
          ...update,
        };

  listeners.forEach((listener) => listener());
};
