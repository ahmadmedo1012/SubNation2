import type { Auth, User } from "firebase/auth";
import { getFirebaseAuth } from "./firebase";
import { getApiBaseUrl as resolveApiBaseUrl } from "./api-config";

export interface FirebaseSessionResponse {
  token: string;
  user?: unknown;
  provider?: string;
  is_new_user?: boolean;
  needs_phone?: boolean;
}

/** Get the API base URL (handles split deployments where frontend != backend) */
function getApiBaseUrl(): string {
  return resolveApiBaseUrl();
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

/**
 * F-003 (security audit 004) — typed error for the account-link
 * consent flow. The backend returns a 409 with
 * `{ reason: "link_consent_required", link_token, candidate_hint }`
 * when a fresh Firebase identity matches exactly one existing
 * SubNation user. The caller (AuthProviders) catches this, renders a
 * confirmation modal naming the masked candidate, and on confirm
 * re-calls `exchangeFirebaseIdToken` with the same id_token plus
 * `linkConsentToken` set to the value from the 409 body. The backend
 * consumes the token (one-shot via Redis GETDEL) and commits the
 * link.
 */
export interface LinkConsentCandidateHint {
  maskedEmail: string | null;
  maskedPhone: string | null;
}

export class FirebaseLinkConsentRequiredError extends Error {
  readonly name = "FirebaseLinkConsentRequiredError";
  constructor(
    public readonly linkToken: string,
    public readonly candidateHint: LinkConsentCandidateHint,
  ) {
    super("Account-link confirmation required");
  }
}

export async function exchangeFirebaseIdToken(
  idToken: string,
  referralCode?: string,
  /**
   * F-003 — pass the value from a previous 409 response's `link_token`
   * field on the second call (after user confirms in the modal).
   * Omitted on the first call.
   */
  linkConsentToken?: string,
) {
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
    body: JSON.stringify({
      id_token: idToken,
      referral_code: referralCode || undefined,
      link_consent_token: linkConsentToken || undefined,
    }),
  });
  const data = (await res.json()) as FirebaseSessionResponse & {
    error?: string;
    reason?: string;
    link_token?: string;
    candidate_hint?: LinkConsentCandidateHint;
  };

  // F-003 — 409 with reason="link_consent_required" is the explicit
  // consent gate. Surface a typed error so the caller can render the
  // modal without inspecting status codes itself.
  if (res.status === 409 && data.reason === "link_consent_required" && data.link_token) {
    throw new FirebaseLinkConsentRequiredError(
      data.link_token,
      data.candidate_hint ?? { maskedEmail: null, maskedPhone: null },
    );
  }

  if (!res.ok) throw new Error(data.error ?? "فشل إنشاء جلسة آمنة");
  // Tell the auth listener to skip the immediate post-sign-in onIdTokenChanged
  // event so it doesn't race this just-created session with a refresh call.
  suppressNextTokenRefresh();
  return data;
}

export async function exchangeCurrentFirebaseUser(
  referralCode?: string,
  /** F-003 — same forwarding contract as exchangeFirebaseIdToken. */
  linkConsentToken?: string,
) {
  const auth = await requireFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("لم يتم إكمال تسجيل الدخول");
  const idToken = await user.getIdToken();
  return exchangeFirebaseIdToken(idToken, referralCode, linkConsentToken);
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

// Circuit breaker: after N consecutive refresh failures, back off for a longer
// period to avoid hammering a broken backend. Resets on first successful refresh.
let consecutiveFailures = 0;
const CIRCUIT_BREAK_THRESHOLD = 3;
const CIRCUIT_BREAK_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
let circuitBreakUntil = 0;

/** Call this immediately after a successful exchange to prevent the listener
 *  from racing the just-created session by re-calling /refresh. */
export function suppressNextTokenRefresh() {
  suppressNextRefresh = true;
  lastRefreshTime = Date.now();
  // A fresh exchange means the bridge is healthy — reset the circuit breaker.
  consecutiveFailures = 0;
  circuitBreakUntil = 0;
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

    // Circuit breaker: if backend has been failing, back off for 5 minutes
    // before trying again. This prevents an infinite refresh loop when the
    // backend session bridge is broken (e.g. schema drift, DB outage).
    const now = Date.now();
    if (circuitBreakUntil > now) {
      return;
    }

    // Debounce rapid refreshes
    if (now - lastRefreshTime < REFRESH_COOLDOWN_MS) {
      return;
    }
    lastRefreshTime = now;

    try {
      // R104 (AG7-12): NOT forced — onIdTokenChanged already fires when
      // the SDK rotated the token itself; forcing here made every
      // rotation a double round-trip to Google (a cached read suffices
      // inside this listener). The explicit force-refresh path stays in
      // the manual exchange/refresh entry points where a FRESH token is
      // genuinely required.
      const idToken = await user.getIdToken();
      const session = await refreshFirebaseSession(idToken);
      onTokenRefresh(session.token);
      // Success — reset failure counter.
      consecutiveFailures = 0;
      circuitBreakUntil = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD) {
        circuitBreakUntil = Date.now() + CIRCUIT_BREAK_BACKOFF_MS;
        console.warn(
          `Firebase refresh failed ${consecutiveFailures} times. ` +
            `Backing off for ${CIRCUIT_BREAK_BACKOFF_MS / 1000}s.`,
        );
      }
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
