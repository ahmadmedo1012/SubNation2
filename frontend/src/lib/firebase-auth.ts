import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

export interface FirebaseSessionResponse {
  token: string;
  user?: unknown;
  provider?: string;
  is_new_user?: boolean;
  needs_phone?: boolean;
}

export function requireFirebaseAuth(): Auth {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("تسجيل الدخول عبر Firebase غير مفعّل حالياً");
  return auth;
}

export async function signInWithFirebaseGoogle() {
  const auth = requireFirebaseAuth();
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
  const auth = requireFirebaseAuth();
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
  const auth = requireFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("لم يتم تسجيل الدخول");
  const idToken = await user.getIdToken(true); // Force refresh
  return refreshFirebaseSession(idToken);
}

export async function resetFirebaseAuth() {
  const auth = getFirebaseAuth();
  if (auth) await signOut(auth);
}

// Setup automatic token refresh listener
export function setupFirebaseTokenRefresh(onTokenRefresh: (token: string) => void) {
  const auth = getFirebaseAuth();
  if (!auth) return () => {};

  const unsubscribe = onIdTokenChanged(auth, async (user) => {
    if (user) {
      try {
        const idToken = await user.getIdToken(true); // Force refresh
        const session = await refreshFirebaseSession(idToken);
        onTokenRefresh(session.token);
      } catch (err) {
        console.error("Failed to refresh Firebase session:", err);
      }
    }
  });

  return unsubscribe;
}
