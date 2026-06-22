import Constants from "expo-constants";

export const DEFAULT_UPDATE_POLL_INTERVAL_MS = 10 * 60 * 1000;

export const getUpdatesPollInterval = () => {
  const raw = process.env.EXPO_PUBLIC_UPDATES_POLL_MS;
  if (!raw) {
    return DEFAULT_UPDATE_POLL_INTERVAL_MS;
  }

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_UPDATE_POLL_INTERVAL_MS;
};

export const getGitSha = () =>
  typeof Constants.expoConfig?.extra?.gitSha === "string"
    ? Constants.expoConfig.extra.gitSha
    : null;

export const getNativeAppVersion = () =>
  Constants.expoConfig?.version ?? "1.0.0";

export const getNativeBuildVersion = () => {
  const iosBuildNumber = Constants.platform?.ios?.buildNumber;
  return typeof iosBuildNumber === "string" && iosBuildNumber.length > 0
    ? iosBuildNumber
    : null;
};

export const toShortHash = (value?: string | null) =>
  value ? value.slice(0, 7) : null;
