/**
 * Global admin-session-expiry handler — 93-C6 / F-07 (A5 S-3, round-93).
 *
 * Problem: the httpOnly admin cookie can expire MID-WORK. App.tsx's
 * guard only validates /api/admin/session on mount/token-change, so
 * every page fetch after expiry returns 401 «جلسة الإدارة منتهية» while
 * the UI keeps telling the operator to RETRY a permanently
 * unauthenticated request (orders.tsx: "فشل تنفيذ العملية، حاول مرة
 * أخرى") — and money actions look "failed" when they were simply
 * unauthenticated.
 *
 * This module is the single choke point both fetch layers route
 * through:
 *
 *   - customFetch (shared/api-client-react): useAdminHeaders registers
 *     `handleAdminUnauthorized` as its 401 callback once, so every
 *     generated-client query/mutation (orders/topups/users/stats…)
 *     covers automatically.
 *   - Raw fetch() call sites in admin pages check
 *     `isAdminUnauthorized(res, url)` in their error paths — or, since
 *     R122 (A2-P2), ride the `adminFetch` / `adminFetchJson` wrappers
 *     below, which bake that check (plus the ok-guard + safe error-body
 *     parse) into one helper so the ~30 raw sites cannot drift again.
 *
 * On the FIRST admin-API 401 while a session is believed active it:
 *   1. toasts «انتهت الجلسة — سجّل دخولك مجددًا» once (15 s dedupe —
 *      parallel queries fail together on expiry; one toast, not six),
 *   2. clears the in-memory admin token via the callback
 *      useAdminHeaders installs (pages with `enabled: !!adminToken`
 *      stop refetching → no 401 storm). 97-F5 (R97-A4 §6 / F-04 — P2):
 *      that callback is AuthProvider's `setAdminToken(null)`, which now
 *      ALSO REMOVES every /api/admin* + admin-alerts* query from the
 *      TanStack cache — the expired admin's PII (user phone numbers,
 *      order buyer data) must not survive into the next admin's login
 *      on the same browser (removal, not invalidation, so the next
 *      admin never even flashes it while a refetch is in flight),
 *   3. soft-navigates to /admin/login?redirect=<current> — the wouter
 *      v3 SPA path (history.pushState + the router's own event), so
 *      Sonner's toast survives the navigation and unsaved form state
 *      is left untouched on the unmounted page.
 *
 * It deliberately does NOT fire for:
 *   - storefront /api/auth/* 401s (out of scope — user sessions are
 *     C5's domain),
 *   - admin login/probe/session endpoints (wrong password is 401 on
 *     /api/admin/login; App.tsx already owns /api/admin/session),
 *   - 401s while no admin session is believed active (logged-out use
 *     of an admin page — the per-page token guards handle that).
 */

import { toast } from "@/hooks/use-toast";
// R122 (A2-P2): adminFetchJson maps the backend error envelope
// (`code`/`error`) to its Arabic message exactly like every converted
// call site did inline — errors.ts has no imports back into this
// module, so the dependency is acyclic.
import { getErrorMessage } from "@/lib/errors";

/** Arabic toast copy for the session-expired redirect. */
export const ADMIN_SESSION_EXPIRED_MESSAGE = "انتهت الجلسة — سجّل دخولك مجددًا";

/**
 * Suppress repeated handling within this window. On expiry, every
 * active admin query + poll fails with 401 in a burst; the first one
 * redirects and the rest must be no-ops (they still return `true` so
 * callers know the failure was "handled" and skip their own toasts).
 */
const DEDUPE_WINDOW_MS = 15_000;

/** Admin API requests that must never trigger the redirect. */
const AUTH_EXEMPT_PREFIXES = [
  "/api/admin/login", // wrong password → 401 is the login form's business
  "/api/admin/probe", // 200-always hydration probe
  "/api/admin/session", // App.tsx's own guard owns this 401
];

function isAdminApiUrl(url: string): boolean {
  if (url.includes("://")) {
    // Absolute URL (Expo base-URL deployments): the path segment still
    // decides. Cheap containment check is fine — there are no other
    // admin-API shapes in this app.
    // R122 (A2-P2): the admin coupon surface lives at /api/coupons/admin
    // (requireAdmin + requirePermission("finance"), backend
    // routes/coupons.ts) — OUTSIDE the /api/admin/ tree the old check
    // only recognized, so a coupon-page 401 could never reach the
    // global handler. The storefront /api/coupons/validate stays public
    // (prefix-precise match, not a /api/coupons/ blanket).
    return url.includes("/api/admin/") || url.includes("/api/coupons/admin");
  }
  if (url.startsWith("/api/coupons/admin")) return true;
  if (!url.startsWith("/api/admin/")) return false;
  return !AUTH_EXEMPT_PREFIXES.some((p) => url.startsWith(p));
}

// ── Module state (mirrored from React by useAdminHeaders) ─────────────────
let adminSessionActive = false;
let clearAdminSession: (() => void) | null = null;
let lastHandledAt = 0;

/**
 * Keep the module's view of "an admin session exists" in sync with the
 * AuthProvider, and register the state-clearing callback. Called from
 * useAdminHeaders' effect — the ONE hook every admin page already
 * calls, so the mirror never goes stale.
 */
export function setAdminSessionMirror(active: boolean, clear: (() => void) | null): void {
  adminSessionActive = active;
  clearAdminSession = clear;
  if (!active) clearAdminSession = null;
}

/**
 * SPA navigation to the login page carrying the current location for a
 * post-login return trip.
 *
 * wouter v3 monkey-patches history.pushState to dispatch a `pushState`
 * event its <Router/> subscribes to — this is exactly the path its own
 * module-level navigate() takes. The extra popstate dispatch is
 * belt-and-braces (idempotent re-render of the same location) in case
 * a future wouter drops the patch. The hard-assign fallback covers
 * exotic embedding contexts.
 */
function navigateToAdminLogin(): void {
  const current = window.location.pathname + window.location.search;
  const target = `/admin/login?redirect=${encodeURIComponent(current)}`;
  try {
    window.history.pushState(window.history.state, "", target);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  } catch {
    window.location.assign(target);
  }
}

/**
 * Central 401 handler. Returns `true` when the failure belongs to an
 * expired admin session (callers should treat the request as handled:
 * toast + redirect are already in flight, so their own generic-error
 * toast would be noise). Returns `false` for every other 401 shape —
 * the caller's normal error path applies.
 */
export function handleAdminUnauthorized(url: string): boolean {
  if (!isAdminApiUrl(url)) return false;
  const now = Date.now();
  // Inside the dedupe window the burst of parallel failures that
  // follows an expiry (every active query + poll 401s at once) must
  // stay "handled" even though the session flag below already
  // flipped — otherwise each caller would layer its own generic
  // error toast on top of the session-expired toast.
  if (now - lastHandledAt < DEDUPE_WINDOW_MS) return true;
  if (!adminSessionActive) return false;
  lastHandledAt = now;
  adminSessionActive = false;

  toast({
    title: ADMIN_SESSION_EXPIRED_MESSAGE,
    variant: "destructive",
    duration: 6000,
  });
  try {
    clearAdminSession?.();
  } catch {
    // Never let a consumer's cleanup throw break the redirect.
  }
  navigateToAdminLogin();
  return true;
}

/**
 * Convenience for raw-fetch call sites: routes a 401 response through
 * the global handler. Usage inside a mutation's try block:
 *
 *   if (isAdminUnauthorized(res, url)) return; // redirect + toast fired
 *   if (!res.ok) throw new Error(getErrorMessage(body) || "خطأ");
 */
export function isAdminUnauthorized(res: { status: number }, url: string): boolean {
  if (res.status !== 401) return false;
  return handleAdminUnauthorized(url);
}

// ── R122 (A2-P2): the raw-fetch wrappers ────────────────────────────

/**
 * R122 (A2-P2): thrown by adminFetch/adminFetchJson when a 401 was an
 * expired admin session (the global toast + redirect have ALREADY
 * fired). Callers' catch blocks recognize it and stay quiet —
 * `if (err instanceof AdminSessionExpiredError) return;` — instead of
 * layering their own generic «فشلت العملية» toast on top of the
 * session-expired toast (the retry-loop noise class the audit found on
 * 8 of 20 pages).
 */
export class AdminSessionExpiredError extends Error {
  constructor() {
    super(ADMIN_SESSION_EXPIRED_MESSAGE);
    this.name = "AdminSessionExpiredError";
  }
}

/**
 * R122 (A2-P2): session-aware raw fetch for admin pages — `fetch()` +
 * the global 401 handler, returning the Response untouched otherwise.
 * For call sites that need custom status/body handling (207 partial
 * success, Array.isArray guards, empty-body tolerance): everything on
 * the 200 path behaves exactly as before.
 *
 * A 401 that belongs to an expired session throws AdminSessionExpiredError
 * AFTER the global handler has toasted + redirected — callers return
 * quietly from their catch on that sentinel.
 */
export async function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 401 && handleAdminUnauthorized(url)) {
    throw new AdminSessionExpiredError();
  }
  return res;
}

/**
 * R122 (A2-P2): fetch + ok-guard + safe error-body parse in one — the
 * common admin-page shape (`if (!r.ok) throw new
 * Error(getErrorMessage(body) || fallback)` then `r.json()`). A
 * non-JSON error body (502 HTML) no longer throws an English
 * SyntaxError into an Arabic toast (the coupons.tsx class the audit
 * called out): the parse is guarded and the fallback carries the
 * status. A non-JSON SUCCESS body still throws (the strict queryFn
 * contract — a garbage 200 must land in the error state, never render
 * as an empty list).
 */
export async function adminFetchJson<T>(
  url: string,
  init?: RequestInit,
  opts: { fallbackError?: string } = {},
): Promise<T> {
  const res = await adminFetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    throw new Error(
      getErrorMessage(body) || opts.fallbackError || `فشلت العملية (HTTP ${res.status})`,
    );
  }
  return (await res.json()) as T;
}

/** Test-only: reset module state between cases. */
export function __resetAdminSessionForTests(): void {
  adminSessionActive = false;
  clearAdminSession = null;
  lastHandledAt = 0;
}
