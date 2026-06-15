import { Stack } from "expo-router";
import { useEffect } from "react";
import * as SystemUI from "expo-system-ui";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppStateProvider } from "../src/state/AppState";

const AppLayout = () => {
  useEffect(() => {
    SystemUI.setBackgroundColorAsync("#f7efe7");
  }, []);

  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
            contentStyle: {
              backgroundColor: "#f7efe7",
            },
          }}
        />
      </AppStateProvider>
    </SafeAreaProvider>
  );
};

export default AppLayout;
