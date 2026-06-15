import { createMMKV } from "react-native-mmkv";
import type { ReactNativeAsyncStorage } from "@firebase/auth";

const appStorage = createMMKV({ id: "may.app" });
const authStorage = createMMKV({ id: "may.firebase-auth" });

export const getLocalString = (key: string) =>
  appStorage.getString(key) ?? null;

export const setLocalString = (key: string, value: string) => {
  appStorage.set(key, value);
};

export const removeLocalItem = (key: string) => {
  appStorage.remove(key);
};

export const firebaseAuthStorage: ReactNativeAsyncStorage = {
  getItem: async (key) => authStorage.getString(key) ?? null,
  removeItem: async (key) => {
    authStorage.remove(key);
  },
  setItem: async (key, value) => {
    authStorage.set(key, value);
  },
};
