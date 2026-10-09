/**
 * Telegram login-callback CSRF gate (R126-L9 split, A3 plan E).
 *
 * Extracted verbatim from routes/auth-settings.ts — the B1-1 (R111)
 * fail-closed same-origin gate applied to the session-MINT shape of
 * GET /api/auth/telegram/callback. Byte-move: the route banner above
 * the endpoint (verdict rules + upgrade path) stays with the route;
 * the allow-list resolution + the predicate live here so they are
 * unit-testable without standing up Express. routes/auth-settings.ts
 * re-exports `isTelegramCallbackSameOrigin` so existing test imports
 * keep resolving.
 */
import { getConfiguredOrigins } from "./origins";

export const TELEGRAM_CALLBACK_CSRF_ERROR = "csrf_blocked";

/** B1-1: resolve the same allow-list shape app.ts's CSRF gate uses. */
export function telegramCallbackAllowedOrigins(): string[] {
  const explicit = process.env.CSRF_ALLOWED_ORIGINS;
  const fromCors = getConfiguredOrigins();
  const raw = explicit ?? (fromCors.length > 0 ? fromCors.join(",") : (process.env.APP_URL ?? ""));
  const parsed = raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (parsed.length > 0) return parsed;
  // Non-production fallback mirrors app.ts's dev defaults so local
  // round-trips keep working; production boots fail-fast on an empty
  // CSRF allow-list long before this branch could weaken anything.
  if (process.env.NODE_ENV !== "production") {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }
  return [];
}

/** B1-1: same-origin predicate for the session-mint shape of the callback. */
export function isTelegramCallbackSameOrigin(
  headers: { "sec-fetch-site"?: unknown; referer?: unknown },
  allowedOrigins: string[],
): boolean {
  // Express types header values as string | string[] | undefined — accept
  // any of those and normalize to the first string (browsers never send
  // these as arrays; the normalization is purely type-safe).
  const header = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return null;
  };
  const secFetchSite = header(headers["sec-fetch-site"]);
  if (secFetchSite !== null && secFetchSite.length > 0) {
    return secFetchSite === "same-origin";
  }
  const referer = header(headers["referer"]);
  if (referer !== null && referer.length > 0 && allowedOrigins.length > 0) {
    // Exact-origin comparison only (F-009 discipline): parse both sides
    // and compare protocol+host — never string prefixes.
    return allowedOrigins.some((allowed) => {
      try {
        const r = new URL(referer);
        const a = new URL(allowed);
        return r.protocol === a.protocol && r.host === a.host;
      } catch {
        return false;
      }
    });
  }
  // No modern header AND no Referer (or no allow-list to check against):
  // fail closed — see the verdict rules in routes/auth-settings.ts.
  return false;
}
