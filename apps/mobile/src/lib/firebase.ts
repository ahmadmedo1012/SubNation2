/**
 * Firebase (Google) sign-in — the native configuration gate.
 *
 * Web parity (frontend/src/lib/firebase.ts `isFirebaseAuthConfigured`,
 * R145 D7 honesty gate): the Google button renders ONLY when THIS build
 * carries the full EXPO_PUBLIC_FIREBASE_* env set — never paint a
 * button whose click dead-ends at a missing SDK.
 *
 * The transport itself is deliberately unwired this round: Google
 * sign-in on React Native needs the `firebase` JS SDK plus
 * `@react-native-google-signin/google-signin` (native SDKs + the
 * owner's Firebase console config for ly.subnation.app). Neither
 * package is in package.json yet, so this module reads env vars only —
 * no firebase import at all, and bundles without config pay nothing.
 * The login screen's Google button explains the state on press
 * (native Alert) instead of erroring. Wiring the SDK is the follow-up
 * round: initializeApp(config) → getAuth(app) → native Google
 * sign-in → getIdToken() → mintNativeSession("/api/auth/firebase/session",
 * { id_token }) — the same session-mint contract the web's
 * exchangeFirebaseIdToken rides.
 */

/** True when every required public Firebase env var is present. */
export function isFirebaseAuthConfigured(): boolean {
  return Boolean(
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY &&
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN &&
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID &&
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  );
}

/**
 * The Firebase Google ID token for the /api/auth/firebase/session mint.
 *
 * Follow-up round (firebase SDK + native Google sign-in): this will
 * initialize the app lazily, run the native sign-in, and return the ID
 * token. Until the owner's Firebase native config lands it resolves
 * null — nothing on the login screen consumes a token today, so the
 * honest null keeps the signature stable for the wiring round.
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  return null;
}
