import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseOptions,
} from "firebase/app";
import * as FirebaseAuth from "@firebase/auth";
import type { Persistence, ReactNativeAsyncStorage } from "@firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

import { nativeEnv } from "./env";
import { firebaseAuthStorage } from "./storage";

const firebaseConfig: FirebaseOptions = {
  apiKey: nativeEnv.firebaseApiKey,
  authDomain: nativeEnv.firebaseAuthDomain,
  projectId: nativeEnv.firebaseProjectId,
  storageBucket: nativeEnv.firebaseStorageBucket,
  messagingSenderId: nativeEnv.firebaseMessagingSenderId,
  appId: nativeEnv.firebaseAppId,
};

const firestoreDatabaseId = nativeEnv.firestoreDatabaseId;
const functionsRegion = "us-east1";
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
    functions: getFunctions(app, functionsRegion),
    storage: getStorage(app),
  };
};
