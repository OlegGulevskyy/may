const { execSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const { expo } = require("./app.json");
const { version } = require("./package.json");

let gitSha = "unknown";
try {
  gitSha = execSync("git rev-parse --short HEAD").toString().trim();
} catch {
  // Git is unavailable in a few config-evaluation contexts.
}

const loadEnvFile = (fileName) => {
  const filePath = join(__dirname, fileName);
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    process.env[key] ??= value;
  }
};

loadEnvFile(".env");
loadEnvFile(".env.local");

const toIosUrlScheme = (clientId) => {
  if (!clientId?.endsWith(".apps.googleusercontent.com")) {
    return undefined;
  }

  return `com.googleusercontent.apps.${clientId.replace(
    ".apps.googleusercontent.com",
    "",
  )}`;
};

const googleServicesFile = "./google-services.json";
const googleServiceInfoFile = "./GoogleService-Info.plist";
const hasAndroidGoogleServices = existsSync(
  join(__dirname, googleServicesFile),
);
const hasIosGoogleServices = existsSync(join(__dirname, googleServiceInfoFile));
const googleIosUrlScheme =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ||
  toIosUrlScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
const iosPushMode =
  process.env.EAS_BUILD_PROFILE === "production" ? "production" : "development";
const easProjectId = expo.extra?.eas?.projectId;

const plugins = [...(expo.plugins ?? [])];
const hasNotificationsPlugin = plugins.some((plugin) =>
  Array.isArray(plugin)
    ? plugin[0] === "expo-notifications"
    : plugin === "expo-notifications",
);
const hasGooglePlugin = plugins.some((plugin) =>
  Array.isArray(plugin)
    ? plugin[0] === "@react-native-google-signin/google-signin"
    : plugin === "@react-native-google-signin/google-signin",
);

if (!hasNotificationsPlugin) {
  plugins.push(["expo-notifications", { mode: iosPushMode }]);
}

if (!hasGooglePlugin) {
  if (hasAndroidGoogleServices && hasIosGoogleServices) {
    plugins.push("@react-native-google-signin/google-signin");
  } else if (googleIosUrlScheme) {
    plugins.push([
      "@react-native-google-signin/google-signin",
      { iosUrlScheme: googleIosUrlScheme },
    ]);
  }
}

module.exports = {
  expo: {
    ...expo,
    version,
    android: {
      ...expo.android,
      ...(hasAndroidGoogleServices
        ? { googleServicesFile: googleServicesFile }
        : {}),
    },
    ios: {
      ...expo.ios,
      ...(hasIosGoogleServices
        ? { googleServicesFile: googleServiceInfoFile }
        : {}),
    },
    extra: {
      ...expo.extra,
      gitSha,
    },
    plugins,
    runtimeVersion: version,
    updates: {
      ...expo.updates,
      ...(easProjectId ? { url: `https://u.expo.dev/${easProjectId}` } : {}),
    },
  },
};
