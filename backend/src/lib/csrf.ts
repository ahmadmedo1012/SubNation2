import type { NextFunction, Request, Response } from "express";
import { ErrorCode, createErrorResponse } from "./errors";
import { logger } from "./logger";
import { getConfiguredOrigins } from "./origins";

/**
 * F-009 (security audit 004) — CSRF Origin/Referer check is enabled in
 * EVERY environment, not just production. Previously the middleware was
 * gated behind `NODE_ENV === "production"`, which left dev servers
 * accepting cross-origin state-changing requests; a developer running
 * realistic credentials locally and visiting a hostile origin in the
 * same browser was vulnerable.
 *
 * Resolution order for the allow-list:
 *   1. `CSRF_ALLOWED_ORIGINS` (explicit override; comma-separated).
 *   2. `APP_ORIGINS` (the existing CORS allow-list — same trust set).
 *   3. `APP_URL` (single-origin shorthand).
 *   4. Non-production fallback: localhost dev origins so `pnpm dev`
 *      keeps working without operator config. In production the
 *      fallback is empty — see the misconfiguration warning below.
 */
const isProduction = process.env.NODE_ENV === "production";

export const csrfAllowedOrigins = (() => {
  const fromExplicit = process.env.CSRF_ALLOWED_ORIGINS;
  const fromCors = getConfiguredOrigins().join(",");
  const fromAppUrl = process.env.APP_URL;
  const raw = fromExplicit || fromCors || fromAppUrl || "";
  const parsed = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (parsed.length > 0) return parsed;
  // Dev fallback only. The boot assertion below refuses to start in
  // production when this branch would have been reached.
  if (!isProduction) {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }
  return [];
})();

// ── SEC-92-01 boot assertion (round-92 B1 security audit) ────────────────────
//
// Historical context: during the Vercel→Render split, production cookies
// shipped SameSite=None (render.yaml set AUTH_COOKIE_SAMESITE=none so the
// Vercel-hosted SPA could call the API cross-site) — the browser attached
// auth_token/admin_token to ANY cross-site request, so the Origin/Referer
// gate built by createCsrfGate() below was the ONLY CSRF barrier, keyed
// off this allow-list. On today's single-origin deployment the cookie is
// SameSite=lax — the gate stays as the CSRF barrier (defense in depth):
// an empty allow-list in production would still be a silent full CSRF
// exposure on wallet/orders/admin surfaces.
//
// Env-var loss at this operator is a DEMONSTRATED failure mode (round-5:
// a Render API PUT wiped DATABASE_URL and took the deploy down), so we
// take the same fail-fast posture as SESSION_SECRET (lib/jwt.ts): boot
// aborts loudly instead of serving traffic without the gate.
// 110-F (R110 — 109-b P3): comment refreshed to the current env shape.
// Production sets APP_ORIGINS (comma-separated allow-list — the primary
// knob, see deploy/env.compose.example) plus APP_URL (single-origin
// shorthand); FRONTEND_ORIGINS / VERCEL_FRONTEND_ORIGIN remain optional
// extras folded in by lib/origins.ts (the pre-Coolify Vercel split stack
// is gone, as is the old scripts/restore_env_vars.json runbook this
// comment used to cite). This assertion only fires when they are lost.
// No secret values are logged.
//
// R136 (app.ts decomposition): this assertion moved here from app.ts's
// module body VERBATIM. app.ts imports this module at module scope, so
// `import("../app")` still evaluates the assertion and still rejects on
// the fail-fast path — the exact contract
// src/__tests__/csrf-gate.test.ts §3 pins (no test edits needed).
if (isProduction && csrfAllowedOrigins.length === 0) {
  logger.fatal(
    { category: "security", audit_finding: "SEC-92-01" },
    "CSRF allow-list is EMPTY in production — set CSRF_ALLOWED_ORIGINS (or APP_ORIGINS / APP_URL). " +
      "SameSite=None cookies require the Origin gate; refusing to boot.",
  );
  throw new Error(
    "SEC-92-01: CSRF allow-list is empty in production. Set CSRF_ALLOWED_ORIGINS, APP_ORIGINS or " +
      "APP_URL so the Origin/Referer gate can validate state-changing requests. Refusing to boot " +
      "(fail-fast, same posture as SESSION_SECRET).",
  );
}

// ── CSRF Protection for state-changing requests ───────────────────────────────
// Validate Origin/Referer headers for POST/PUT/DELETE/PATCH requests.
//
// Exported as a factory (SEC-92-01) so the exact gate production mounts is
// unit-testable without booting the whole app tree — see
// src/__tests__/csrf-gate.test.ts.
export function createCsrfGate(allowedOrigins: string[], production: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      const origin = req.headers.origin;
      const referer = req.headers.referer;

      // Skip CSRF check ONLY for endpoints where the browser legitimately omits
      // Origin/Referer:
      //   - /api/cwv: navigator.sendBeacon does not set Origin on most browsers.
      //   - /api/webhook/*: third-party callbacks (Telegram, Stripe-style) sign
      //     their bodies; Origin from a different host is expected.
      //
      // AUD103-3-F1 (r103): /api/auth/firebase/refresh is NO LONGER skipped.
      // The old justification ("rotation of an ALREADY-bound session") was
      // false — the handler at auth.ts requires only a signed Firebase ID
      // token and NO prior session, i.e. it is a session MINT with the exact
      // same shape 98-F3 closed for /api/auth/firebase/session: with
      // SameSite=None production cookies, a hostile page could POST a
      // CORS-simple form carrying the attacker's own ID token and silently
      // bind the victim's browser to the attacker's account. The SPA calls
      // refresh via fetch (firebase-auth.ts), which always sends Origin, so
      // the skip bought nothing for the legitimate client.
      //
      // 98-F3 (R98-A1 P2-3): /api/auth/firebase/session is NO LONGER skipped.
      // It is a session MINT (Set-Cookie of a fresh auth_token), so skipping
      // the gate opened a login-CSRF window: a hostile page could POST a form
      // (CORS-simple request, no preflight) carrying the attacker's own
      // Firebase ID token and silently log the victim into the ATTACKER's
      // account — the victim then tops up the wallet (correct Origin from
      // the real SPA) and deposits real money into an account the attacker
      // controls. The SPA itself always sends Origin on fetch, so the skip
      // bought nothing for the legitimate client. The mint is now gated like
      // every other mutating route (Origin/Referer allow-list + the
      // cookie-without-headers sub-rule below, which also blocks the
      // re-binding variant for already-logged-in victims).
      //
      // Login / register / forgot-password / reset-password / change-password /
      // toggle-password-login / sessions / logout / providers — ALL inside the
      // CSRF gate. SameSite cookies remain the second layer.
      const skipPaths = ["/api/cwv", "/api/webhook"];
      if (skipPaths.some((path) => req.path.startsWith(path))) {
        next();
        return;
      }

      // SEC-92-01 (round-92 B1 audit): does the request carry an
      // ambient-authority cookie? Production cookies are SameSite=None
      // (render.yaml AUTH_COOKIE_SAMESITE=none), so browsers attach
      // auth_token/admin_token to ANY cross-site request — including a
      // plain HTML <form method="POST">, which is a CORS simple request
      // (no preflight) parsed by express.urlencoded above. Origin/Referer
      // are the only client-side signals we can gate such attacks on.
      const hasAuthCookie = Boolean(req.cookies?.auth_token || req.cookies?.admin_token);

      // F-009 (security audit 004) — Origin/Referer check runs in ALL
      // environments. The allowedOrigins list is computed once at module
      // load with sensible dev defaults.
      if (allowedOrigins.length > 0) {
        // Exact-origin comparison only. The previous `startsWith(allowed)`
        // form was a bypass: an attacker origin like `https://subnation.ly
        // .evil.com` (or any subdomain-path prefix) matched the allow-list
        // entry. We normalize by parsing the URL and comparing scheme+
        // host(+port) so trailing slashes/paths on either side don't matter.
        const originAllowed = (candidate: string, allowed: string): boolean => {
          try {
            const c = new URL(candidate);
            const a = new URL(allowed);
            return c.protocol === a.protocol && c.host === a.host;
          } catch {
            return false;
          }
        };

        // SEC-92-01 (2): a cookie-authenticated state-changing request with
        // NEITHER Origin NOR Referer is the classic no-Origin form-POST
        // shape (legacy/embedded browsers omit Origin on cross-site form
        // submissions). Real browser clients always send at least one of
        // the two for same-origin SPA calls, so treat "both absent + auth
        // cookie" as hostile. Headerless non-cookie API clients are still
        // rejected by the isValid check below — unchanged F-009 behavior.
        if (hasAuthCookie && !origin && !referer) {
          logger.warn(
            { path: req.path, hasAdminCookie: Boolean(req.cookies?.admin_token) },
            "CSRF validation failed: auth cookie present but Origin and Referer both absent",
          );
          res.status(403).json(createErrorResponse("طلب غير مصرح", ErrorCode.FORBIDDEN));
          return;
        }

        const isValid =
          (origin && allowedOrigins.some((allowed) => originAllowed(origin, allowed))) ||
          (referer && allowedOrigins.some((allowed) => originAllowed(referer, allowed)));

        if (!isValid) {
          logger.warn({ origin, referer, path: req.path }, "CSRF validation failed");
          res.status(403).json(createErrorResponse("طلب غير مصرح", ErrorCode.FORBIDDEN));
          return;
        }
      } else if (production) {
        // SEC-92-01 (1) — production with no allow-list. This branch
        // previously logged and continued (fail OPEN), which — combined
        // with SameSite=None cookies — silently exposed every
        // cookie-authenticated state-changing route the moment the
        // origins env vars were lost. The boot-time assertion above now
        // aborts the process first; the runtime gate below stays fail-
        // closed as defense-in-depth for any path where the assertion
        // somehow did not run:
        //   - requests WITH an auth cookie → 403 (they carry ambient
        //     authority a cross-site form could abuse);
        //   - requests WITHOUT an auth cookie → pass with a loud operator
        //     log (no ambient authority = no CSRF surface; they must
        //     still present their own credentials at the route).
        if (hasAuthCookie) {
          logger.error(
            { path: req.path, category: "security", audit_finding: "SEC-92-01" },
            "CSRF gate CLOSED: empty allow-list in production and the request carries an auth cookie",
          );
          res.status(403).json({
            error: "طلب غير مصرح — إعداد الحماية غير مكتمل",
            code: "CSRF_CONFIG",
          });
          return;
        }
        logger.error(
          { path: req.path },
          "CSRF middleware has no allow-list in production — set CSRF_ALLOWED_ORIGINS or APP_ORIGINS",
        );
      }
    }
    next();
  };
}
