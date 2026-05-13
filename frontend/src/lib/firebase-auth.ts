import type { Auth, User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export interface FirebaseSessionResponse {
  token: string;
  user?: unknown;
  provider?: string;
  is_new_user?: boolean;
  needs_phone?: boolean;
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
  const res = await fetch("/api/auth/firebase/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken, referral_code: referralCode || undefined }),
  });
  const data = (await res.json()) as FirebaseSessionResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "فشل إنشاء جلسة آمنة");
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
  const res = await fetch("/api/auth/firebase/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// Setup automatic token refresh listener
export async function setupFirebaseTokenRefresh(onTokenRefresh: (token: string) => void) {
  const auth = await getFirebaseAuth();
  if (!auth) return () => {};

  const { onIdTokenChanged } = await import("firebase/auth");

  const unsubscribe = onIdTokenChanged(auth, async (user: User | null) => {
    if (!user) return;

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
      // Only log non-network errors to avoid noise during network issues
      if (!(err instanceof TypeError && err.message.includes("network"))) {
        console.error("Failed to refresh Firebase session:", err);
      }
    }
  });

  return unsubscribe;
}
