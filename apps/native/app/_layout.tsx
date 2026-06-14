import { Stack } from "expo-router";
import { useEffect } from "react";
import * as SystemUI from "expo-system-ui";

const AppLayout = () => {
  useEffect(() => {
    SystemUI.setBackgroundColorAsync("#f7efe7");
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: "#f7efe7",
        },
      }}
    />
  );
};

export default AppLayout;
