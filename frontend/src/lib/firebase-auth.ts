import type { Auth, User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export interface FirebaseSessionResponse {
  token: string;
  user?: unknown;
  provider?: string;
  is_new_user?: boolean;
  needs_phone?: boolean;
}

/** Get the API base URL (handles split deployments where frontend != backend) */
function getApiBaseUrl(): string {
  const base = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  return base;
}

export async function requireFirebaseAuth(): Promise<Auth> {
  const auth = await getFirebaseAuth();
  if (!auth) throw new Error("تسجيل الدخول عبر Firebase غير مفعّل حالياً");
  return auth;
}

export async function signInWithFirebaseGoogle() {
  const auth = await requireFirebaseAuth();
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");
  return signInWithPopup(auth, provider);
}

export async function exchangeFirebaseIdToken(idToken: string, referralCode?: string) {
  // Guard: a real Firebase ID token is a 3-segment JWT, typically 900+ chars.
  // If the popup communication was broken by CSP/COOP, getIdToken() may return
  // a garbage/empty string. Fail fast with a clear error instead of a confusing 400.
  if (!idToken || idToken.length < 100) {
    throw new Error(
      "لم تكتمل عملية تسجيل الدخول. يبدو أن النافذة المنبثقة أُغلقت قبل الانتهاء. حاول مرة أخرى.",
    );
  }

  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/auth/firebase/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id_token: idToken, referral_code: referralCode || undefined }),
  });
  const data = (await res.json()) as FirebaseSessionResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "فشل إنشاء جلسة آمنة");
  // Tell the auth listener to skip the immediate post-sign-in onIdTokenChanged
  // event so it doesn't race this just-created session with a refresh call.
  suppressNextTokenRefresh();
  return data;
}

export async function exchangeCurrentFirebaseUser(referralCode?: string) {
  const auth = await requireFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("لم يتم إكمال تسجيل الدخول");
  const idToken = await user.getIdToken();
  return exchangeFirebaseIdToken(idToken, referralCode);
}

export async function refreshFirebaseSession(idToken: string) {
  const base = getApiBaseUrl();
  const res = await fetch(`${base}/api/auth/firebase/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id_token: idToken }),
  });
  const data = (await res.json()) as { token: string; user: unknown; error?: string };
  if (!res.ok) throw new Error(data.error ?? "فشل تجديد الجلسة");
  return data;
}

export async function refreshCurrentFirebaseSession() {
  const auth = await requireFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("لم يتم تسجيل الدخول");
  const idToken = await user.getIdToken(true); // Force refresh
  return refreshFirebaseSession(idToken);
}

export async function resetFirebaseAuth() {
  const auth = await getFirebaseAuth();
  if (auth) {
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
  }
}

// Store for tracking refresh state across component instances
let lastRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 30000; // 30 second cooldown to prevent rapid refreshes
let suppressNextRefresh = false;

/** Call this immediately after a successful exchange to prevent the listener
 *  from racing the just-created session by re-calling /refresh. */
export function suppressNextTokenRefresh() {
  suppressNextRefresh = true;
  lastRefreshTime = Date.now();
}

// Setup automatic token refresh listener
export async function setupFirebaseTokenRefresh(onTokenRefresh: (token: string) => void) {
  const auth = await getFirebaseAuth();
  if (!auth) return () => {};

  const { onIdTokenChanged } = await import("firebase/auth");

  const unsubscribe = onIdTokenChanged(auth, async (user: User | null) => {
    if (!user) return;

    // Skip the very next event after a fresh sign-in to avoid a refresh race
    // (the session was just created — no need to immediately refresh it).
    if (suppressNextRefresh) {
      suppressNextRefresh = false;
      lastRefreshTime = Date.now();
      return;
    }

    // Debounce rapid refreshes
    const now = Date.now();
    if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) {
      return;
    }
    lastRefreshTime = now;

    try {
      const idToken = await user.getIdToken(true); // Force refresh
      const session = await refreshFirebaseSession(idToken);
      onTokenRefresh(session.token);
    } catch (err) {
      // Suppress noisy errors when the user simply hasn't completed the
      // session exchange yet (transient 401 on first popup-success event).
      if (err instanceof Error && err.message.includes("فشل تجديد الجلسة")) {
        // Session bridge not yet established — quiet log.
        return;
      }
      if (!(err instanceof TypeError && err.message.includes("network"))) {
        console.error("Failed to refresh Firebase session:", err);
      }
    }
  });

  return unsubscribe;
}
