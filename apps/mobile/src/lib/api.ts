import {
  addUnauthorizedHandler,
  setAuthTokenGetter,
  setBaseUrl,
  type ApiError,
} from "@workspace/api-client-native";

import { getStoredToken } from "./auth-store";

/**
 * SubNation mobile API bootstrap.
 *
 * Three native-client facts from the platform contract (shared/api-spec
 * openapi.yaml + backend/src/lib/csrf.ts):
 *
 * 1. CSRF: every POST/PUT/PATCH/DELETE under /api requires an Origin or
 *    Referer header that matches the deployment allow-list — INCLUDING
 *    Bearer-authenticated non-browser clients ("Non-browser clients must
 *    therefore send a browser-like Origin header on mutations"). We send
 *    `Origin: https://subnation.ly` on every API-origin request.
 *
 * 2. Auth: the native session is the 30-day HS256 JWT minted into the
 *    `auth_token` Set-Cookie header. We capture it at mint time (see
 *    lib/auth-store.ts), store it in SecureStore, and present it as a
 *    Bearer token via the shared client's auth-token getter.
 *
 * 3. The backend's CORS gate passes Origin-less requests; we always send
 *    Origin anyway because the CSRF gate demands it on mutations.
 */

const DEFAULT_API_URL = "https://subnation.ly";

/**
 * API origin — the base URL for every request (and the CSRF Origin value).
 * Normalized once at module load (review R7-a P3): a trailing-slash
 * EXPO_PUBLIC_API_URL would otherwise silently kill the Origin shim's
 * `target.startsWith(`${API_URL}/`)` match (and emit `//api/…` URLs) —
 * every mutation would 403 on the CSRF gate.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");

/** Absolute URL for an /api path. */
export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// ---------------------------------------------------------------------------
// CSRF Origin shim: wrap global fetch so every request to the API origin
// carries the allow-listed Origin header. The shared generated client calls
// the global fetch (customFetch), and this is the one place all requests
// (generated hooks, mint calls, socket polling) funnel through.
// ---------------------------------------------------------------------------

const PATCHED = Symbol.for("subnation.fetchPatched");
type PatchedFetch = typeof globalThis.fetch & { [PATCHED]?: true };

function withOriginHeader(input: RequestInfo | URL, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("origin")) {
    headers.set("origin", API_URL);
  }
  return { ...init, headers };
}

function installOriginShim(): void {
  const current = globalThis.fetch as PatchedFetch;
  if (current?.[PATCHED]) return;

  const patched: PatchedFetch = (input, init) => {
    let target: string;
    if (typeof input === "string") target = input;
    else if (input instanceof URL) target = input.toString();
    else target = input.url;

    if (target.startsWith(`${API_URL}/`) || target === API_URL) {
      return current(input, withOriginHeader(input, init));
    }
    return current(input, init);
  };
  patched[PATCHED] = true;
  globalThis.fetch = patched;
}

// ---------------------------------------------------------------------------
// Session-expiry observers: the shared client fires its additive 401 list;
// we skip /api/auth/* (login failures are handled by their own screens)
// and forward genuine session deaths to whoever registered (AuthProvider).
// ---------------------------------------------------------------------------

type SessionExpiredHandler = () => void;
const sessionExpiredHandlers = new Set<SessionExpiredHandler>();

export function addSessionExpiredHandler(handler: SessionExpiredHandler): () => void {
  sessionExpiredHandlers.add(handler);
  return () => sessionExpiredHandlers.delete(handler);
}

function isAuthSurface(url: string): boolean {
  return url.includes("/api/auth/") || url.includes("/api/admin/login");
}

addUnauthorizedHandler((info) => {
  if (isAuthSurface(info.url)) return;
  for (const handler of sessionExpiredHandlers) {
    try {
      handler();
    } catch {
      // An observer must never break the request pipeline.
    }
  }
});

// ---------------------------------------------------------------------------
// Bootstrap (idempotent; imported for side effects once from the root layout)
// ---------------------------------------------------------------------------

let bootstrapped = false;

export function bootstrapApiClient(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  installOriginShim();
  setBaseUrl(API_URL);
  setAuthTokenGetter(() => getStoredToken());
}

/** Extract an ApiError's status/code for UI branching (409 replay, etc.). */
export function apiErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "status" in error) {
    const data = (error as ApiError).data as { code?: string } | null;
    return data?.code ?? null;
  }
  return null;
}
