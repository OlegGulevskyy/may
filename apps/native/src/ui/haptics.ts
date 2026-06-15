import * as Haptics from "expo-haptics";

/**
 * A light selection tick for taps (tab bar, primary buttons). Failures are
 * swallowed so the app stays happy on the simulator or before the native
 * module has been linked into a fresh dev-client build.
 */
export function tapFeedback() {
  try {
    Haptics.selectionAsync().catch(() => undefined);
  } catch {
    // Native haptics module unavailable — ignore.
  }
}
