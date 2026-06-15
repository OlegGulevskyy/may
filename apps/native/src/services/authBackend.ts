import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  type User,
} from "@firebase/auth";

import { GOOGLE_DELIVERY_SCOPES } from "@may/core";

import { getFirebaseServices } from "./firebase";

type GoogleSignInModule =
  typeof import("@react-native-google-signin/google-signin");

declare const require: {
  (moduleName: "@react-native-google-signin/google-signin"): GoogleSignInModule;
};

export type AuthUser = {
  id: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
};

const toAuthUser = (user: User): AuthUser => ({
  id: user.uid,
  displayName: user.displayName,
  email: user.email,
  photoURL: user.photoURL,
});

const env = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

let googleSignInModule: GoogleSignInModule | null = null;
let googleSignInConfigKey: string | null = null;

const BASE_GOOGLE_SIGN_IN_SCOPES = ["email", "profile"];
const GOOGLE_DELIVERY_SIGN_IN_SCOPES = [
  ...BASE_GOOGLE_SIGN_IN_SCOPES,
  ...GOOGLE_DELIVERY_SCOPES,
];

const loadGoogleSignInModule = () => {
  try {
    googleSignInModule ??= require("@react-native-google-signin/google-signin");
  } catch (error) {
    googleSignInModule = null;
    throw new Error(
      `Google sign-in native module is not available. Rebuild and run the app as a development build instead of Expo Go. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }

  return googleSignInModule;
};

const getRequiredGoogleWebClientId = () => {
  const webClientId = env?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      "Google sign-in is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in apps/native/.env.local, then rebuild the native app.",
    );
  }
  return webClientId;
};

const configureGoogleSignIn = async ({
  forceCodeForRefreshToken,
  offlineAccess,
  scopes = BASE_GOOGLE_SIGN_IN_SCOPES,
}: {
  forceCodeForRefreshToken?: boolean;
  offlineAccess?: boolean;
  scopes?: string[];
} = {}) => {
  const { GoogleSignin } = loadGoogleSignInModule();
  const iosClientId = env?.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const webClientId = getRequiredGoogleWebClientId();
  const configKey = JSON.stringify({
    forceCodeForRefreshToken: Boolean(forceCodeForRefreshToken),
    iosClientId,
    offlineAccess: Boolean(offlineAccess),
    scopes,
    webClientId,
  });

  if (googleSignInConfigKey === configKey) {
    return;
  }

  GoogleSignin.configure({
    forceCodeForRefreshToken,
    iosClientId,
    offlineAccess,
    scopes,
    webClientId,
  });
  googleSignInConfigKey = configKey;
};

const toGoogleSignInErrorMessage = (
  error: unknown,
  { isErrorWithCode, statusCodes }: GoogleSignInModule,
) => {
  if (!isErrorWithCode(error)) {
    return error instanceof Error ? error.message : "Google sign-in failed.";
  }

  switch (error.code) {
    case statusCodes.IN_PROGRESS:
      return "Google sign-in is already in progress.";
    case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
      return "Google Play Services is unavailable or needs to be updated.";
    case statusCodes.SIGN_IN_CANCELLED:
      return "Google sign-in was cancelled.";
    default:
      return error.message;
  }
};

export const subscribeToAuthUser = ({
  onError,
  onUser,
}: {
  onError: (message: string) => void;
  onUser: (user: AuthUser | null) => void;
}) => {
  const services = getFirebaseServices();
  if (!services) {
    onUser(null);
    return () => undefined;
  }

  return onAuthStateChanged(
    services.auth,
    (user) => onUser(user ? toAuthUser(user) : null),
    (error) => onError(error.message),
  );
};

export const signInWithGoogleCredential = async ({
  accessToken,
  idToken,
}: {
  accessToken?: string;
  idToken: string;
}) => {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error("Firebase is not configured.");
  }

  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  await signInWithCredential(services.auth, credential);
};

export const signInWithGoogle = async () => {
  await configureGoogleSignIn();

  const googleSignInModule = loadGoogleSignInModule();
  const { GoogleSignin, isSuccessResponse } = googleSignInModule;

  let idToken: string | null = null;
  try {
    await GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });

    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      throw new Error("Google sign-in was cancelled.");
    }
    idToken = response.data.idToken;
  } catch (error) {
    throw new Error(toGoogleSignInErrorMessage(error, googleSignInModule));
  }

  if (!idToken) {
    throw new Error(
      "Google sign-in did not return an ID token. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and make sure Google is enabled in Firebase Auth.",
    );
  }

  await signInWithGoogleCredential({ idToken });
};

export const requestGoogleDeliveryServerAuthCode = async () => {
  await configureGoogleSignIn({
    offlineAccess: true,
    scopes: GOOGLE_DELIVERY_SIGN_IN_SCOPES,
  });

  const googleSignInModule = loadGoogleSignInModule();
  const { GoogleSignin, isSuccessResponse } = googleSignInModule;

  try {
    await GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });

    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      throw new Error("Google permission request was cancelled.");
    }

    const { serverAuthCode, user } = response.data;
    if (!serverAuthCode) {
      throw new Error(
        "Google did not return a server authorization code. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and make sure offline access is enabled for this OAuth client.",
      );
    }

    return {
      googleEmail: user.email,
      serverAuthCode,
    };
  } catch (error) {
    throw new Error(toGoogleSignInErrorMessage(error, googleSignInModule));
  }
};

export const signOutCurrentUser = async () => {
  const services = getFirebaseServices();
  if (!services) {
    return;
  }

  await signOut(services.auth);
  let googleSignInModule: GoogleSignInModule | undefined;
  try {
    googleSignInModule = loadGoogleSignInModule();
  } catch {
    googleSignInModule = undefined;
  }
  await googleSignInModule?.GoogleSignin.signOut().catch(() => undefined);
};
