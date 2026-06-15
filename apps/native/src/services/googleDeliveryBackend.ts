import { doc, setDoc } from "firebase/firestore";

import { createId } from "@may/core";

import { requestGoogleDeliveryServerAuthCode } from "./authBackend";
import { getFirebaseServices } from "./firebase";

export const connectGoogleDelivery = async ({
  familyId,
}: {
  familyId: string;
}) => {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error("Firebase is not configured.");
  }

  const { googleEmail, serverAuthCode } =
    await requestGoogleDeliveryServerAuthCode();
  const user = services.auth.currentUser;
  if (!user) {
    throw new Error("Sign in before continuing.");
  }

  const requestRef = doc(
    services.db,
    "families",
    familyId,
    "deliveryGrantRequests",
    createId("google_delivery_grant"),
  );
  await setDoc(requestRef, {
    createdAt: new Date().toISOString(),
    createdBy: user.uid,
    familyId,
    googleEmail,
    serverAuthCode,
  });
};
