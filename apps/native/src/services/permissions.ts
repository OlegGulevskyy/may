import { Linking } from "react-native";
import {
  AudioModule,
  type PermissionResponse as AudioPermissionResponse,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";

export type AppPermissionId =
  | "camera"
  | "microphone"
  | "notifications"
  | "photoLibrary";

export type AppPermissionStatus =
  | "denied"
  | "granted"
  | "limited"
  | "undetermined"
  | "unavailable";

export type AppPermissionSummary = {
  canAskAgain: boolean;
  id: AppPermissionId;
  label: string;
  status: AppPermissionStatus;
};

const permissionLabels: Record<AppPermissionId, string> = {
  camera: "Camera",
  microphone: "Audio recording",
  notifications: "Notifications",
  photoLibrary: "Photo library",
};

export const getAppPermissionSummaries = async () => {
  const [notifications, microphone, photoLibrary, camera] = await Promise.all([
    getNotificationPermissionSummary(),
    getMicrophonePermissionSummary(),
    getPhotoLibraryPermissionSummary(),
    getCameraPermissionSummary(),
  ]);

  return [notifications, microphone, photoLibrary, camera];
};

export const requestAppPermission = async (id: AppPermissionId) => {
  switch (id) {
    case "camera":
      return normalizePermission({
        id,
        response: await ImagePicker.requestCameraPermissionsAsync(),
      });
    case "microphone":
      return normalizePermission({
        id,
        response: await AudioModule.requestRecordingPermissionsAsync(),
      });
    case "notifications":
      return normalizePermission({
        id,
        response: await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: false,
            allowSound: true,
          },
        }),
      });
    case "photoLibrary":
      return normalizePermission({
        id,
        response: await ImagePicker.requestMediaLibraryPermissionsAsync(),
      });
  }
};

export const openAppPermissionSettings = () => Linking.openSettings();

export const permissionStatusLabel = (status: AppPermissionStatus) => {
  switch (status) {
    case "denied":
      return "Denied";
    case "granted":
      return "Granted";
    case "limited":
      return "Limited";
    case "undetermined":
      return "Not asked";
    case "unavailable":
      return "Unavailable";
  }
};

export const permissionNeedsSystemSettings = ({
  canAskAgain,
  status,
}: Pick<AppPermissionSummary, "canAskAgain" | "status">) =>
  status === "granted" ||
  status === "limited" ||
  status === "unavailable" ||
  (status === "denied" && !canAskAgain);

const getNotificationPermissionSummary = async () =>
  normalizePermission({
    id: "notifications",
    response: await Notifications.getPermissionsAsync(),
  });

const getMicrophonePermissionSummary = async () =>
  normalizePermission({
    id: "microphone",
    response: await AudioModule.getRecordingPermissionsAsync(),
  });

const getPhotoLibraryPermissionSummary = async () =>
  normalizePermission({
    id: "photoLibrary",
    response: await ImagePicker.getMediaLibraryPermissionsAsync(),
  });

const getCameraPermissionSummary = async () =>
  normalizePermission({
    id: "camera",
    response: await ImagePicker.getCameraPermissionsAsync(),
  });

const normalizePermission = ({
  id,
  response,
}: {
  id: AppPermissionId;
  response:
    | AudioPermissionResponse
    | ImagePicker.CameraPermissionResponse
    | ImagePicker.MediaLibraryPermissionResponse
    | Notifications.NotificationPermissionsStatus;
}): AppPermissionSummary => ({
  canAskAgain: response.canAskAgain,
  id,
  label: permissionLabels[id],
  status: normalizePermissionStatus(response),
});

const normalizePermissionStatus = (
  response:
    | AudioPermissionResponse
    | ImagePicker.CameraPermissionResponse
    | ImagePicker.MediaLibraryPermissionResponse
    | Notifications.NotificationPermissionsStatus,
): AppPermissionStatus => {
  if (
    "accessPrivileges" in response &&
    response.accessPrivileges === "limited"
  ) {
    return "limited";
  }

  if (response.granted) {
    return "granted";
  }

  if (response.status === "denied") {
    return "denied";
  }

  if (response.status === "undetermined") {
    return "undetermined";
  }

  return "unavailable";
};
