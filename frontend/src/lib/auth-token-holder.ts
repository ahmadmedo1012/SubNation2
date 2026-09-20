/**
 * Module-level holder for the CURRENT user JWT.
 *
 * Round-3 (8-f §1 — auth-header architecture fix): before this, 26 orval
 * call sites hand-built `Authorization: Bearer ${token ?? ""}` headers
 * (18 of them shipping an empty Bearer when logged out), and the boot
 * probe sent the `__cookie_session__` sentinel as a fake Bearer.
 * `customFetch`'s `setAuthTokenGetter()` hook existed for exactly this
 * and was never called.
 *
 * Now `main.tsx` registers ONE getter backed by this holder, and
 * `AuthProvider` keeps the holder in sync with the session token.
 * Call-site headers are still honored when they carry a REAL token
 * (customFetch only overrides empty/absent headers), so per-site
 * overrides remain possible during the migration to the getter.
 *
 * The cookie-session sentinel is filtered here: when the app runs on
 * cookie auth (no in-memory JWT yet), requests must carry NO bearer
 * header — the httpOnly cookie speaks for itself.
 *
 * 98-F3 (R98 backend round): the session-mint routes no longer return
 * the raw JWT in the body — they return the sentinel string, which the
 * sign-in flows store here via setToken. The filter below therefore
 * applies to EVERY session now (boot probe and real sign-ins alike):
 * the holder never emits a bearer for a cookie-authenticated session.
 * This is the exact parity the admin surface landed in R97-02.
 */

let currentUserToken: string | null = null;

const COOKIE_AUTH_SENTINEL = "__cookie_session__";

export function setUserAuthToken(token: string | null): void {
  currentUserToken = token;
}

export function getUserAuthToken(): string | null {
  if (!currentUserToken || currentUserToken === COOKIE_AUTH_SENTINEL) return null;
  return currentUserToken;
}
