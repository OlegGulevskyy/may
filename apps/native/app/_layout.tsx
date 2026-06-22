import { Stack, useRootNavigationState, useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import type { NotificationResponse } from "expo-notifications";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "../src/state/AppState";
import {
  MemoryWallProvider,
  useMemoryWallContext,
} from "../src/state/MemoryWallProvider";
import { useAppUpdatesService } from "../src/hooks/useAppUpdates";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const AppLayout = () => {
  useAppUpdatesService();

  useEffect(() => {
    SystemUI.setBackgroundColorAsync("#f7efe7");
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppStateProvider>
          <MemoryWallProvider>
            <NotificationResponseRouter />
            <Stack
              screenOptions={{
                headerShown: false,
                animation: "slide_from_right",
                contentStyle: {
                  backgroundColor: "#f7efe7",
                },
              }}
            />
          </MemoryWallProvider>
        </AppStateProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default AppLayout;

const notificationDataType = (response: NotificationResponse) => {
  const type = response.notification.request.content.data?.type;
  return typeof type === "string" ? type : null;
};

const notificationResponseKey = (response: NotificationResponse) => {
  const data = response.notification.request.content.data;
  const type = typeof data?.type === "string" ? data.type : "";
  const postId = typeof data?.postId === "string" ? data.postId : "";

  return [
    response.notification.request.identifier,
    response.actionIdentifier,
    type,
    postId,
  ].join(":");
};

function NotificationResponseRouter() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const { refreshPosts } = useMemoryWallContext();
  const handledResponseKeys = useRef(new Set<string>());

  const handleResponse = useCallback(
    (response: NotificationResponse | null | undefined) => {
      if (
        !response ||
        response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER ||
        !rootNavigationState?.key
      ) {
        return;
      }

      const key = notificationResponseKey(response);
      if (handledResponseKeys.current.has(key)) {
        return;
      }
      handledResponseKeys.current.add(key);

      const type = notificationDataType(response);
      if (type === "memory-nudge") {
        router.push("/compose");
        return;
      }

      if (type === "comment" || type === "like") {
        router.replace("/");
        refreshPosts();
      }
    },
    [refreshPosts, rootNavigationState?.key, router],
  );

  useEffect(() => {
    if (!rootNavigationState?.key) {
      return;
    }

    handleResponse(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
  }, [handleResponse, rootNavigationState?.key]);

  useEffect(() => {
    if (!rootNavigationState?.key) {
      return;
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleResponse(response);
        Notifications.clearLastNotificationResponse();
      },
    );

    return () => subscription.remove();
  }, [handleResponse, rootNavigationState?.key]);

  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
