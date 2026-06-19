import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { deleteDoc, doc, setDoc } from "firebase/firestore";

import { isNotificationPermissionGranted } from "./memoryNudges";
import { getFirebaseServices } from "./firebase";

type FamilyPushTokenInput = {
  familyId: string;
  memberId: string;
};

export type FamilyPushTokenRegistrationState =
  | { status: "registered"; token: string }
  | { status: "needs-permission" | "signed-out" | "unavailable" };

const tokenDocId = (token: string) => encodeURIComponent(token);

const resolveExpoProjectId = () =>
  Constants.easConfig?.projectId ??
  Constants.expoConfig?.extra?.eas?.projectId;

const getGrantedExpoPushToken = async () => {
  const permission = await Notifications.getPermissionsAsync();

  if (!isNotificationPermissionGranted(permission)) {
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: resolveExpoProjectId(),
  });

  return token.data;
};

const pushTokenRef = ({
  familyId,
  memberId,
  token,
}: FamilyPushTokenInput & { token: string }) => {
  const services = getFirebaseServices();

  if (!services?.auth.currentUser) {
    return null;
  }

  return doc(
    services.db,
    "families",
    familyId,
    "members",
    memberId,
    "pushTokens",
    tokenDocId(token),
  );
};

export const registerFamilyPushToken = async ({
  familyId,
  memberId,
}: FamilyPushTokenInput): Promise<FamilyPushTokenRegistrationState> => {
  const services = getFirebaseServices();

  if (!services?.auth.currentUser) {
    return { status: "signed-out" };
  }

  if (services.auth.currentUser.uid !== memberId) {
    return { status: "unavailable" };
  }

  try {
    const token = await getGrantedExpoPushToken();

    if (!token) {
      return { status: "needs-permission" };
    }

    const ref = pushTokenRef({ familyId, memberId, token });
    if (!ref) {
      return { status: "signed-out" };
    }

    const now = new Date().toISOString();
    await setDoc(
      ref,
      {
        createdAt: now,
        familyId,
        memberId,
        platform: Platform.OS,
        token,
        tokenType: "expo",
        updatedAt: now,
      },
      { merge: true },
    );

    return { status: "registered", token };
  } catch (error) {
    console.warn("[MaySync] push token registration failed", {
      error: error instanceof Error ? error.message : String(error),
      familyId,
      memberId,
    });
    return { status: "unavailable" };
  }
};

export const removeFamilyPushToken = async ({
  familyId,
  memberId,
}: FamilyPushTokenInput) => {
  let token: string | null = null;

  try {
    token = await getGrantedExpoPushToken();
  } catch {
    return;
  }

  if (!token) {
    return;
  }

  const ref = pushTokenRef({ familyId, memberId, token });
  if (ref) {
    await deleteDoc(ref);
  }
};
