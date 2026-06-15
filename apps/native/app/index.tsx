import { Redirect } from "expo-router";

import { useAppState } from "../src/state/AppState";
import { Wall } from "../src/screens/Wall";
import { SplashScreen } from "../src/ui/Splash";

export default function Home() {
  const { authStatus, hydrated, isReady, isRestoringSession } = useAppState();

  if (!hydrated || authStatus === "loading" || isRestoringSession) {
    return <SplashScreen />;
  }

  if (authStatus === "signed-out") {
    return <Redirect href="/login" />;
  }

  if (!isReady) {
    return <Redirect href="/welcome" />;
  }

  return <Wall />;
}
