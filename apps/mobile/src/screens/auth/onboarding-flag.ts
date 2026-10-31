import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local onboarding-completion flag.
 *
 * The web flips the server-side `onboarded_at` flag via
 * POST /api/auth/onboarding/complete; that operation is NOT in the
 * generated API client (checked: no `onboarding` operation exists in
 * @workspace/api-client-native), so per the task contract the native
 * onboarding screen makes NO API call. This local flag is the
 * substitute: the login router and the onboarding bounce gate read it
 * so a user who completed the native welcome once is not routed back
 * into it on every future sign-in (per-install; the server flag stays
 * the authoritative signal once the operation reaches the client).
 */

const ONBOARDING_SEEN_KEY = "subnation.onboarding_seen";

/** Mark the onboarding welcome as completed on this install. */
export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "1");
  } catch {
    // Persistence failure must never block leaving the welcome screen.
  }
}

/** True when this install already completed the onboarding welcome. */
export async function hasOnboardingBeenSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)) === "1";
  } catch {
    return false;
  }
}
