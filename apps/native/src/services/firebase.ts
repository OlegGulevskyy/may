import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseOptions,
} from "firebase/app";
import * as FirebaseAuth from "@firebase/auth";
import type { Persistence, ReactNativeAsyncStorage } from "@firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

import { firebaseAuthStorage } from "./storage";

const env = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

const firebaseConfig: FirebaseOptions = {
  apiKey: env?.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env?.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env?.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: env?.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env?.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env?.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const firestoreDatabaseId =
  env?.EXPO_PUBLIC_FIRESTORE_DATABASE_ID || "may-default";
const reactNativeAuth = FirebaseAuth as typeof FirebaseAuth & {
  getReactNativePersistence: (storage: ReactNativeAsyncStorage) => Persistence;
};

export const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.appId,
);

export const getFirebaseServices = () => {
  if (!hasFirebaseConfig) {
    return null;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  let auth;

  try {
    auth = FirebaseAuth.initializeAuth(app, {
      persistence:
        reactNativeAuth.getReactNativePersistence(firebaseAuthStorage),
    });
  } catch {
    auth = FirebaseAuth.getAuth(app);
  }

  return {
    app,
    auth,
    db: getFirestore(app, firestoreDatabaseId),
    firestoreDatabaseId,
    storage: getStorage(app),
  };
};
