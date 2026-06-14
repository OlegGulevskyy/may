import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseOptions,
} from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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

  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
  };
};
